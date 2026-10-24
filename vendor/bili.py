#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
bili.py —— 大肥鱼自己的刷B站命令行（独立于 dsh-bili-scroll 插件）
============================================================================
直接 import 同目录的 mcp_server.py（源自 vendor/bilibili-mcp，MIT，作者 AGI_Ananas），
把它那套 async 函数当库调 —— 不跑 MCP 协议，也不需要 dsh 插件活着。

用法（用家目录那个独立 venv 的 python 跑，依赖都装在那儿）：
  python bili.py whoami
  python bili.py search "关键词" --num 10 --order pubdate
  python bili.py subtitle BV1xxxxxxxxx
  python bili.py comments BV1xxxxxxxxx --num 30
  python bili.py video-info BV1xxxxxxxxx
  python bili.py danmaku BV1xxxxxxxxx --num 100
  python bili.py reply BV1xxxxxxxxx "正文" [--rpid 123] [--root 0] [--force]
  python bili.py login [--timeout 180]
  python bili.py asr BV1xxxxxxxxx [--model small] [-o out.txt]
  python bili.py status
  python bili.py ups                       # 看固定 UP 主名单与各自最新投稿
  python bili.py up-feed [--since-days 3]  # 查这些 UP 主有没有新视频（JSON）

凭证：同目录的 bili_credential.json（从插件家目录拷来的，4 个字段）
配置：同目录的 config.json；判重表 seen.md；报告写 out/YYYY-MM-DD.md
============================================================================
"""
import argparse
import asyncio
import base64
import contextlib
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

BASE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

import mcp_server as core  # noqa: E402

CFG_FILE = BASE / "config.json"
HOME_CFG_FILE = Path.home() / ".dsh" / "bili-duty" / "config.json"
STATE_FILE = BASE / "state.json"
SEEN_FILE = BASE / "seen.md"
OUT_DIR = BASE / "out"


# ═══════════════════════════════════════════════════════════════════════
# 2026-10-25 加：跨平台文件锁（防并发写冲突）
#
# 为什么：seen.md / state.json / config.json 都是「读-改-写」。
#   同一台机器上两个宿主（桌面版 + web 版）、或者定时任务和手动跑同时进行时，
#   后写的会把先写的覆盖掉 —— 丢记录 ⇒ 重复刷视频、重复发评论。
#
# 为什么用 mkdir 而不是 msvcrt.locking / fcntl.flock：
#   后两个在 Windows 和 Linux 上语义不同（Windows 要求锁住至少 1 字节、解锁必须同偏移），
#   跨平台容易出坑。而 os.mkdir 在所有平台上都是**原子**的 ——
#   成功 = 抢到了锁，FileExistsError = 别人占着。
#
# 僵尸锁：持锁进程崩了不会自己 rmdir，所以超过 LOCK_STALE_SEC 秒的锁直接抢过来重建，
#   否则一次崩溃就会永久锁死。
# ═══════════════════════════════════════════════════════════════════════
LOCK_STALE_SEC = 180.0


@contextlib.contextmanager
def file_lock(target, timeout: float = 10.0):
    """对 target 文件加独占锁。

    yield 一个 bool：True = 抢到了，False = 等超时了（调用方自己决定要不要硬写）。
    用法：
        with file_lock(SEEN_FILE) as got:
            if got:
                SEEN_FILE.write_text(...)
    """
    lock_dir = Path(str(target) + ".lockdir")
    start = time.time()
    got = False
    while time.time() - start < timeout:
        try:
            os.mkdir(lock_dir)
            got = True
            break
        except FileExistsError:
            # 僵尸锁回收：持锁的人崩了，目录不会自己消失
            try:
                if time.time() - lock_dir.stat().st_mtime > LOCK_STALE_SEC:
                    try:
                        lock_dir.rmdir()
                    except Exception:
                        pass
                    continue
            except Exception:
                pass
            time.sleep(0.05)
        except Exception:
            break
    try:
        yield got
    finally:
        if got:
            try:
                lock_dir.rmdir()
            except Exception:
                pass


def _load_seen_bvs(days: int = 0):
    """从 seen.md 里提取所有【看过】的 BV 号。

    ⭐ 2026-10-22 加（用户要求）：发现重复的就直接不看这条视频 ——
       不读字幕、不写报告、不发评论。以前只是 SKILL.md 里写「读 seen.md 判重」，
       靠模型自觉；现在在 search 这一层硬拦。
    ⭐ 2026-10-22 再改（用户要求）：只认近 days 天的记录，days<=0 表示全认。
       以前全文扫、永不清理 —— 文件只涨不跌，一个月前看过的也永久跳过。
       「天数」直接绑 config.json 的 searchDays（UP 主轮不参与，它有独立配额）。
    ⚠️ 用正则扫，不依赖表格格式（本机和云端的表格式曾经不一样）。
    ⚠️ 没日期的行照样算进判重（多是说明/引用，影响很小）。
    """
    try:
        text = SEEN_FILE.read_text(encoding="utf-8", errors="replace")
    except Exception:
        return set()

    if not days or days <= 0:
        return set(re.findall(r"BV[0-9A-Za-z]{10}", text))

    from datetime import date, timedelta
    cutoff = (date.today() - timedelta(days=days)).isoformat()   # 例：2026-10-19

    out = set()
    for line in text.splitlines():
        m = re.search(r"(20\d{2}-\d{2}-\d{2})", line)
        if m:
            # 有日期 → 只认近 days 天
            if m.group(1) >= cutoff:
                out |= set(re.findall(r"BV[0-9A-Za-z]{10}", line))
        else:
            # 没日期 → 无法判断，保守保留
            out |= set(re.findall(r"BV[0-9A-Za-z]{10}", line))
    return out


def _trim_seen(days: int) -> int:
    """删掉 seen.md 里超过 days 天的【带日期记录行】，返回删了几行。

    ⭐ 2026-10-22 加（用户要求）：防止 seen.md 无限增长。
    · 只动「- YYYY-MM-DD | ...」这种记录行
    · 说明文字 / 命令 / 表头 / section 标题（## 2026-10-15）原样保留
    · days<=0 时不动（关掉清理）
    """
    if not days or days <= 0:
        return 0
    # 2026-10-25：整个「读-过滤-写」都在锁内，否则两个进程会互相覆盖
    with file_lock(SEEN_FILE) as got:
        if not got:
            return 0
        try:
            text = SEEN_FILE.read_text(encoding="utf-8", errors="replace")
        except Exception:
            return 0

        from datetime import date, timedelta
        cutoff = (date.today() - timedelta(days=days)).isoformat()

        rec = re.compile(r"^\s*[-*]?\s*(\d{4}-\d{2}-\d{2})\s*\|")
        kept = []
        removed = 0
        for line in text.split("\n"):
            m = rec.match(line)
            if m and m.group(1) < cutoff:
                removed += 1
                continue
            kept.append(line)

        if removed > 0:
            try:
                SEEN_FILE.write_text("\n".join(kept), encoding="utf-8")
            except Exception:
                return 0
        return removed


async def _load_blocked_ups():
    """从 config.json 读「屏蔽的 UP 主」名单。

    ⭐ 2026-10-22 加（用户要求）：搜索结果里作者对上这些人的，直接跳过这条视频。
    返回 ({mids}, {names}) —— 有 uid 就按 uid 比（准），没 uid 才退化到按名字比。

    ⭐ 2026-10-22 补（用户指出「改昵称会失效」）：跟「特别关注」一个待遇 ——
       只填了昵称、没填 uid 的，这里**当场解析一次 uid 并写回 config**，
       以后就按 uid 比，他改昵称也不影响。
    """
    try:
        cfg_path = _cfg_file()
        raw = json.loads(cfg_path.read_text(encoding="utf-8"))
    except Exception:
        return set(), set()

    ups = raw.get("blockedUps")
    if not isinstance(ups, list) or not ups:
        return set(), set()

    changed = False
    mids = set()
    names = set()

    for i, u in enumerate(ups):
        if isinstance(u, dict):
            n = str(u.get("name") or "").strip()
            try:
                m = int(u.get("uid") or u.get("mid") or 0)
            except (TypeError, ValueError):
                m = 0
        else:
            n = str(u or "").strip()
            m = 0

        # 有昵称、没 uid → 解析一次（只在这一种情况下才碰网络）
        if n and m <= 0:
            try:
                cred = core.load_credential()
                found = await resolve_uid(cred, n) if cred else None
            except Exception:
                found = None
            if found and found.get("uid"):
                m = int(found["uid"])
                new_name = str(found.get("name") or n).strip() or n
                ups[i] = {"name": new_name, "uid": m}
                changed = True

        if m > 0:
            mids.add(m)
        elif n:
            names.add(n)

    if changed:
        # 2026-10-25：加锁，防两个进程同时改 config.json 互相覆盖
        with file_lock(cfg_path) as got:
            if not got:
                return
            try:
                raw["blockedUps"] = ups
                cfg_path.write_text(
                    json.dumps(raw, ensure_ascii=False, indent=2) + "\n",
                    encoding="utf-8",
                )
            except Exception:
                pass

    return mids, names


def _cfg_file():
    """配置优先读家目录那份（设置页「刷B站」写的就是它），没有才退回脚本目录这份。"""
    try:
        if HOME_CFG_FILE.exists():
            return HOME_CFG_FILE
    except Exception:
        pass
    return CFG_FILE

DEFAULTS = {
    "perDay": 10,
    "keywords": ["DeepSeek Harness", "DSH 插件", "dsh 教程", "meow-memory"],
    "autoComment": False,
    "mentionName": "",
    "commentPerRound": 1,
    "transcribe": False,
    "asrModel": "small",
    # 默认就指向家目录（换机器也对）；设置页装了转写依赖后会写死成真实路径
    "asrPython": str(Path.home() / ".dsh" / "bili-duty" / ".venv-asr" / "Scripts" / "python.exe"),
    "hfCache": str(Path.home() / ".dsh" / "bili-duty" / ".hf-cache"),
}


def load_cfg():
    data = {}
    try:
        data = json.loads(_cfg_file().read_text(encoding="utf-8"))
    except Exception:
        pass
    cfg = dict(DEFAULTS)
    cfg.update({k: v for k, v in data.items() if v is not None})
    return cfg


def emit(value):
    print(value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2))


def in_window(now: datetime, start: str, end: str) -> bool:
    hm = now.strftime("%H:%M")
    if start <= end:
        return start <= hm < end
    return hm >= start or hm < end


def day_key() -> str:
    return datetime.now().strftime("%Y-%m-%d")


# ───────────────────────── 子命令 ─────────────────────────

async def cmd_whoami(_args):
    """真正查登录态：nav 接口的 isLogin 才是权威判据。
    ⚠️ 实测：core.bili_check_credential 打的是「按 uid 查用户资料」，
       那个接口是公开的、不校验登录 —— 拿一个假 Cookie 照样返回昵称，
       于是它一直在骗人说「凭证有效」。别再用它判断登录。
    """
    from bilibili_api.utils.network import Api
    cred = core.load_credential()
    if not cred:
        emit({"logged_in": False, "message": "没有凭证文件"})
        return 1
    try:
        api = Api(url="https://api.bilibili.com/x/web-interface/nav", method="GET",
                  verify=True, credential=cred)
        res = await api.result
        # ⚠️ 2026-10-18 修：bilibili_api 的 Api.result 会把 data 层**摊平到顶层**，
        #    所以 isLogin / mid / level_info 直接在 res 上，不在 res["data"] 里。
        #    之前只读 res["data"] ⇒ 永远拿到 None，把已登录误判成未登录。
        #    这里两种结构都认，别再写死一层。
        d = res.get("data") if isinstance(res.get("data"), dict) else res
        ok = bool(d.get("isLogin"))
        level = (d.get("level_info") or {}).get("current_level")
        name = d.get("uname") or ""
        # nav 不给昵称时补一次（get_user_info 是公开接口，仅用于显示名字，不用于判断登录）
        if ok and not name:
            try:
                from bilibili_api import user as bili_user
                info = await bili_user.User(uid=int(d.get("mid") or cred.dedeuserid),
                                            credential=cred).get_user_info()
                name = info.get("name") or ""
                if level is None:
                    level = info.get("level")
            except Exception:
                pass
        emit({
            "logged_in": ok,
            "uid": d.get("mid") or cred.dedeuserid,
            "username": name,
            "level": level,
            "message": "凭证有效" if ok else "未登录（读得动 ≠ 登录有效；写操作会被 -101 拒）",
        })
        return 0 if ok else 1
    except Exception as e:
        emit({"logged_in": False, "message": f"nav 接口报错：{e}"})
        return 1


async def cmd_search(args):
    if args.order not in ("totalrank", "click", "pubdate", "dm"):
        raise SystemExit("--order 只能是 totalrank / click / pubdate / dm")
    raw = await core.bili_search(keyword=args.keyword, num=args.num, order=args.order)

    min_play = int(getattr(args, "min_play", 0) or 0)
    since_days = int(getattr(args, "since_days", 0) or 0)
    keep_seen = bool(getattr(args, "keep_seen", False))

    # ⭐ 2026-10-22（用户要求）：按 searchDays 清掉过龄记录，防止 seen.md 无限增长。
    #    只在正常搜索时清（--keep-seen 是调试用的，不动文件）。
    trim_days = 0
    if not keep_seen:
        try:
            trim_days = int(load_cfg().get("searchDays") or 0)
        except Exception:
            trim_days = 0
        if trim_days > 0:
            try:
                _trim_seen(trim_days)
            except Exception:
                pass

    # 三个过滤都没开 → 原样返回
    if min_play <= 0 and since_days <= 0 and keep_seen:
        emit(raw)
        return

    try:
        data = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        emit(raw)
        return
    if not isinstance(data, dict) or not isinstance(data.get("videos"), list):
        emit(data)
        return

    before = len(data["videos"])

    # ⭐ 2026-10-22（用户要求）：看过的视频直接跳过 —— 不读字幕、不写报告、不发评论。
    #    以前只在 SKILL.md 里叫模型自己比对 seen.md，靠自觉；这里改成硬拦。
    if not keep_seen:
        seen = _load_seen_bvs(trim_days)
        if seen:
            kept = [v for v in data["videos"] if str(v.get("bvid") or "") not in seen]
            data["seenSkipped"] = len(data["videos"]) - len(kept)
            data["seenTotal"] = len(seen)
            data["videos"] = kept

    # ⭐ 2026-10-22（用户要求）：屏蔽的 UP 主 —— 作者对上就直接跳过这条视频
    blk_mids, blk_names = await _load_blocked_ups()
    if blk_mids or blk_names:
        kept = []
        for v in data["videos"]:
            try:
                vmid = int(v.get("mid") or 0)
            except (TypeError, ValueError):
                vmid = 0
            author = str(v.get("author") or "").strip()
            if (vmid > 0 and vmid in blk_mids) or (author and author in blk_names):
                continue
            kept.append(v)
        data["blockedSkipped"] = len(data["videos"]) - len(kept)
        data["blockedTotal"] = len(blk_mids) + len(blk_names)
        data["videos"] = kept

    if min_play > 0:
        data["videos"] = [v for v in data["videos"] if int(v.get("play") or 0) >= min_play]
        data["minPlay"] = min_play

    if since_days > 0:
        now = time.time()
        kept = []
        for v in data["videos"]:
            # 不同接口字段名不一样，挨个试
            t = v.get("created") or v.get("pubdate") or v.get("pubDate") or 0
            try:
                t = float(t)
            except (TypeError, ValueError):
                t = 0
            if t <= 0 or (now - t) <= since_days * 86400:
                kept.append(v)
        data["videos"] = kept
        data["sinceDays"] = since_days

    data["count"] = len(data["videos"])
    data["filteredOut"] = before - len(data["videos"])
    emit(data)


async def cmd_subtitle(args):
    emit(await core.bili_subtitle(bvid=args.bvid))


async def cmd_comments(args):
    emit(await core.bili_comments(bvid=args.bvid, num=args.num))


async def cmd_danmaku(args):
    emit(await core.bili_danmaku(bvid=args.bvid, num=args.num))


async def cmd_video_info(args):
    emit(await core.bili_video_info(bvid=args.bvid))


async def cmd_reply(args):
    cfg = load_cfg()
    mention = str(cfg.get("mentionName") or "").strip()
    if not args.force and not (cfg.get("autoComment") and mention):
        emit({
            "ok": False,
            "blocked": True,
            "hint": "要发评论得同时满足两条：config.json 里 autoComment=true 且填了 mentionName；"
                    "或者本人当场让你发时加 --force。",
        })
        return 2
    # ⚠️ 2026-10-18 修：以前直接把 core.bili_reply 的返回 print 出来 ——
    #    而 bili_reply 失败时返回的是 {"success": false, "error": ...}，
    #    调用方一眼看不出失败（那次真发出去的是 -101 账号未登录，却被报成「成功」）。
    #    现在：先发，再按 success 字段判真假，失败给非零退出码。
    raw = await core.bili_reply(
        bvid=args.bvid, text=args.text, rpid=args.rpid, root=args.root,
    )
    try:
        res = json.loads(raw) if isinstance(raw, str) else raw
    except Exception:
        res = {"raw": raw}
    if res.get("success"):
        emit({"ok": True, "bvid": args.bvid, "message": "评论已发送成功"})
        return 0
    emit({
        "ok": False,
        "bvid": args.bvid,
        "error": res.get("error") or res,
        "hint": "这次评论没发出去。若报 -101 账号未登录 ⇒ 凭证只能读不能写，需要重新扫码或检查账号状态。",
    })
    return 1


async def cmd_dm(args):
    """发 B站私信（⭐ 开头自动带视频的 BV 号 —— 用户 2026-10-22 明确要求）。

    走 bilibili_api.session.send_msg，接口是 api.vc.bilibili.com/web_im/v1/web_im/send_msg。
    """
    cfg = load_cfg()
    if not cfg.get("dmOnly"):
        emit({
            "ok": False,
            "blocked": True,
            "hint": "私信模式没开：设置 → 刷B站 → 呼叫主人 → 打开「仅私信不评论」",
        })
        return 2

    bvid = str(getattr(args, "bvid", "") or "").strip()
    if not bvid:
        emit({"ok": False, "error": "必须给 bvid —— 私信开头要带视频的 BV 号"})
        return 2

    # 收件人：--uid 优先；没有就按 config 里的 mentionName 解析
    to_uid = int(getattr(args, "uid", 0) or 0)
    if to_uid <= 0:
        who = str(cfg.get("mentionName") or "").strip()
        if not who:
            emit({"ok": False, "error": "没填收件人：config 里 mentionName 是空的，也没传 --uid"})
            return 2
        try:
            cred0 = core.load_credential()
            found = await resolve_uid(cred0, who) if cred0 else None
        except Exception:
            found = None
        if not found or not found.get("uid"):
            emit({
                "ok": False,
                "error": "按昵称「%s」查不到 uid，请用 --uid 直接指定" % who,
            })
            return 2
        to_uid = int(found["uid"])

    # 正文：开头必须是 BV 号（只加一次，避免重复）
    body = str(args.text or "").strip()
    if not body:
        emit({"ok": False, "error": "正文是空的"})
        return 2
    if not body.startswith(bvid):
        body = "%s %s" % (bvid, body)

    try:
        from bilibili_api.session import send_msg, EventType as SessionEventType
    except Exception as e:
        emit({"ok": False, "error": "当前 bilibili_api 版本没有 send_msg：%s" % e})
        return 2

    cred = core.load_credential()
    if not cred:
        emit({"ok": False, "error": "未登录"})
        return 4

    try:
        res = await send_msg(cred, to_uid, SessionEventType.TEXT, body)
    except Exception as e:
        emit({"ok": False, "to": to_uid, "bvid": bvid, "error": "发送异常：%s" % e})
        return 1

    code = (res or {}).get("code")
    if code == 0:
        emit({
            "ok": True,
            "to": to_uid,
            "bvid": bvid,
            "message": "私信已发送",
            "preview": body[:80],
        })
        return 0

    emit({
        "ok": False,
        "to": to_uid,
        "bvid": bvid,
        "code": code,
        "error": (res or {}).get("message") or res,
        "hint": "常见原因：对方设了「只收关注者的私信」/ 被拉黑 / 发太频繁被风控。",
    })
    return 1


async def cmd_login(args):
    first = json.loads(await core.bili_login())
    if first.get("status") == "already_logged_in":
        emit(first)
        return 0
    img = first.get("qrcode_image", "")
    if img.startswith("data:image"):
        raw = base64.b64decode(img.split(",", 1)[1])
        png = BASE / "qrcode_login.png"
        png.write_bytes(raw)
        first["qrcode_file"] = str(png)
        first.pop("qrcode_image", None)
    emit(first)
    print("\n二维码已存成 PNG：%s" % (BASE / "qrcode_login.png"), file=sys.stderr)
    print("用 B站 App 扫码（选「记住我 / 长期登录」），然后等本命令轮询……", file=sys.stderr)

    deadline = datetime.now().timestamp() + args.timeout
    while datetime.now().timestamp() < deadline:
        await asyncio.sleep(2)
        st = json.loads(await core.bili_login_check())
        status = st.get("status")
        print("  status=%s %s" % (status, st.get("message", "")), file=sys.stderr)
        if status in ("done", "timeout"):
            emit(st)
            return 0 if status == "done" else 3
    emit({"status": "timeout", "message": "等了 %ss 还没确认，二维码可能过期了，重跑 login" % args.timeout})
    return 3


async def cmd_status(_args):
    cfg = load_cfg()
    st = {}
    try:
        st = json.loads(STATE_FILE.read_text(encoding="utf-8"))
    except Exception:
        pass
    now = datetime.now()
    today = day_key()
    # ⚠️ 别用 core.bili_check_credential 判断登录（它不校验，见 cmd_whoami 注释）
    # ⚠️ Api.result 会把 data 摊平到顶层，别只读 rr["data"]（同 cmd_whoami 的坑）
    login_info = {"logged_in": False, "username": "", "uid": ""}
    try:
        from bilibili_api.utils.network import Api
        c = core.load_credential()
        if c:
            api = Api(url="https://api.bilibili.com/x/web-interface/nav", method="GET",
                      verify=True, credential=c)
            rr = await api.result
            dd = rr.get("data") if isinstance(rr.get("data"), dict) else rr
            login_info = {"logged_in": bool(dd.get("isLogin")),
                          "username": dd.get("uname") or "",
                          "uid": str(dd.get("mid") or c.dedeuserid or "")}
    except Exception:
        pass
    emit({
        "today": today,
        "ranToday": st.get("count", 0) if st.get("day") == today else 0,
        "perDay": cfg.get("perDay"),
        "windows": {
            "noon": {"start": "12:00", "end": "14:00", "opening": in_window(now, "12:00", "14:00")},
            "night": {"start": "18:00", "end": "09:00", "opening": in_window(now, "18:00", "09:00")},
        },
        "autoComment": bool(cfg.get("autoComment")),
        "mentionName": cfg.get("mentionName") or "",
        "transcribe": bool(cfg.get("transcribe")),
        "keywords": cfg.get("keywords"),
        "watchedUps": [e.get("name") for e in (cfg.get("watchedUps") or [])],
        "loggedIn": login_info["logged_in"],
        "username": login_info["username"],
        "home": str(BASE),
        "report": str(OUT_DIR / (today + ".md")),
    })


def cmd_asr(args):
    cfg = load_cfg()
    py = Path(str(cfg.get("asrPython") or ""))
    script = BASE / "asr.py"
    if not py.exists():
        raise SystemExit("ASR 的 venv 不在了：%s（需要重装 faster-whisper / yt-dlp）" % py)
    env = dict(os.environ)
    env.setdefault("HF_HOME", str(cfg.get("hfCache") or (BASE / ".hf-cache")))
    cmd = [str(py), str(script), args.target]
    if args.model:
        cmd += ["--model", args.model]
    if args.out:
        cmd += ["-o", args.out]
    return subprocess.call(cmd, env=env)


# ───────────────────────── 固定 UP 主监控 ─────────────────────────
# 配置里 watchedUps 每项：{"name": "昵称", "uid": 12345}
# uid 留空时按 name 搜一次用户、取第一条，并写回 config.json（只写一次，之后省事）。
# 「新」的判据：视频 bvid 不在 seen-up.json 里（这个文件记每个 UP 主已经交付过的 bvid）。

UP_FILE = BASE / "seen-up.json"


def load_up_state() -> dict:
    try:
        return json.loads(UP_FILE.read_text(encoding="utf-8"))
    except Exception:
        return {}


def save_up_state(state: dict) -> None:
    # 2026-10-25：加锁，防两个进程同时写 seen-up.json 互相覆盖
    with file_lock(UP_FILE) as got:
        if not got:
            return
        UP_FILE.write_text(json.dumps(state, ensure_ascii=False, indent=2), encoding="utf-8")


async def resolve_uid(cred, name: str) -> dict | None:
    """按昵称搜用户名，返回 {uid, name} 或 None"""
    from bilibili_api import search
    try:
        result = await search.search_by_type(
            keyword=name,
            search_type=search.SearchObjectType.USER,
            page=1,
        )
    except Exception:
        return None
    for item in (result.get("result") or []):
        uname = str(item.get("uname") or "").strip()
        if uname == name or name in uname:
            return {"uid": int(item.get("mid") or item.get("uid") or 0), "name": uname}
    items = result.get("result") or []
    if items:
        it = items[0]
        return {"uid": int(it.get("mid") or it.get("uid") or 0), "name": str(it.get("uname") or name)}
    return None


async def fetch_up_latest(cred, uid: int, ps: int = 10) -> list:
    """拿某个 UP 主最新的投稿列表（按发布时间倒序）"""
    from bilibili_api import user as bili_user
    u = bili_user.User(uid=uid, credential=cred)
    data = await u.get_videos(ps=ps, order=bili_user.VideoOrder.PUBDATE)
    out = []
    for v in (data.get("list") or {}).get("vlist") or []:
        out.append({
            "bvid": v.get("bvid", ""),
            "title": v.get("title", ""),
            "created": int(v.get("created") or 0),
            "play": v.get("play", 0),
            "length": v.get("length", ""),
            "desc": (v.get("description") or "")[:200],
        })
    return out


async def cmd_up_feed(args):
    cfg = load_cfg()
    cred = core.load_credential()
    if not cred:
        emit({"ok": False, "error": "未登录"})
        return 4
    watched = cfg.get("watchedUps") or []
    # ⭐ 2026-10-25 加：屏蔽名单在 UP 主轮也要生效。
    #   以前只在 cmd_search 里过滤，导致「既屏蔽又关注同一个人」时 up-feed 照报 —— 自相矛盾。
    blk_mids, blk_names = await _load_blocked_ups()
    blocked_here = 0
    if blk_mids or blk_names:
        kept_ups = []
        for u in watched:
            uid = int(u.get("uid") or 0)
            nm = str(u.get("name") or "").strip()
            if (uid > 0 and uid in blk_mids) or (nm and nm in blk_names):
                blocked_here += 1
                continue
            kept_ups.append(u)
        watched = kept_ups
    if not watched:
        emit({"ok": True, "watchedUps": [], "blockedSkipped": blocked_here,
              "message": "固定 UP 主名单为空（或全被屏蔽名单挡住了）"})
        return 0

    state = load_up_state()
    since_days = int(args.since_days)
    now = datetime.now().timestamp()
    resolved_cfg_changed = False
    all_new = []

    for ent in watched:
        name = str(ent.get("name") or "").strip()
        uid = int(ent.get("uid") or 0)
        if not name and not uid:
            continue
        if not uid:
            found = await resolve_uid(cred, name)
            if not found or not found.get("uid"):
                all_new.append({"up": name, "error": "按昵称找不到这个 UP 主，请手动填 uid"})
                continue
            uid = found["uid"]
            ent["uid"] = uid
            if found.get("name"):
                ent["name"] = found["name"]
            resolved_cfg_changed = True
            name = ent["name"]

        key = str(uid)
        seen = set(state.get(key) or [])
        first_run = key not in state
        try:
            vids = await fetch_up_latest(cred, uid)
        except Exception as e:
            all_new.append({"up": name, "uid": uid, "error": f"拉取投稿失败：{e}"})
            continue

        fresh = []
        for v in vids:
            if v["bvid"] in seen:
                continue
            if since_days > 0 and v["created"] and (now - v["created"]) > since_days * 86400:
                continue
            fresh.append(v)

        # ⭐ 首次监控这个 UP 时，不把历史视频全当「新」，只记下现有 bvid
        if first_run:
            state[key] = [v["bvid"] for v in vids]
            all_new.append({"up": name, "uid": uid, "firstRun": True,
                            "note": "首次监控，已记下现有 %d 条，之后只报新的" % len(vids)})
            continue

        if fresh:
            # 立刻记账，避免同一批被报两遍
            state[key] = list(seen | {v["bvid"] for v in fresh})[-200:]
            for v in fresh:
                all_new.append({
                    "up": name, "uid": uid,
                    "bvid": v["bvid"], "title": v["title"],
                    "url": "https://www.bilibili.com/video/" + v["bvid"],
                    "created": datetime.fromtimestamp(v["created"]).strftime("%Y-%m-%d %H:%M") if v["created"] else "",
                    "play": v["play"], "length": v["length"], "desc": v["desc"],
                })
        else:
            state.setdefault(key, list(seen))

    save_up_state(state)
    if resolved_cfg_changed:
        cfg_path = _cfg_file()
        # 2026-10-25：整个「读-改-写」都在锁内
        with file_lock(cfg_path) as got:
            if got:
                data = {}
                try:
                    data = json.loads(cfg_path.read_text(encoding="utf-8"))
                except Exception:
                    pass
                data["watchedUps"] = watched
                cfg_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

    emit({"ok": True, "sinceDays": since_days, "count": len([x for x in all_new if x.get("bvid")]), "items": all_new})
    return 0


async def cmd_mark_seen(args):
    """把「看过的视频」记进 seen.md —— 加锁、批量、自动防重复。

    ⭐ 2026-10-25 加（用户要求「彻底解决」）：
    以前是模型直接用文件工具改 seen.md，那条路绕过了 bili.py 的所有锁 ——
    等于「读一遍、自己加、再整篇覆盖回去」，两个任务同时跑就互相擦。
    现在统一走这个命令：整段「读-判重-追加-写回」都在 file_lock 内。

    用法：
      bili.py mark-seen --bv BV1xxx --title "标题" [--note "一句结论"] [--date 2026-10-25]
      bili.py mark-seen --items '[{"bv":"BV1xx","title":"...","note":"..."}]'
    """
    from datetime import date as _date

    items = []
    if getattr(args, "items", None):
        try:
            raw = json.loads(args.items)
        except Exception as e:
            emit({"ok": False, "error": "items 不是合法 JSON：" + str(e)})
            return 1
        if isinstance(raw, dict):
            raw = [raw]
        for it in (raw or []):
            if isinstance(it, dict) and it.get("bv"):
                items.append({
                    "bv": str(it["bv"]).strip(),
                    "title": str(it.get("title") or "").strip(),
                    "note": str(it.get("note") or "").strip(),
                    "date": str(it.get("date") or "").strip(),
                })
    elif getattr(args, "bv", None):
        items.append({
            "bv": str(args.bv).strip(),
            "title": str(getattr(args, "title", "") or "").strip(),
            "note": str(getattr(args, "note", "") or "").strip(),
            "date": str(getattr(args, "date", "") or "").strip(),
        })

    if not items:
        emit({"ok": False, "error": "没有要记的内容（用 --bv 或 --items）"})
        return 1

    today = _date.today().isoformat()
    added, skipped = [], []

    with file_lock(SEEN_FILE) as got:
        if not got:
            emit({"ok": False, "error": "等锁超时：另一个任务正在写 seen.md，稍后重试"})
            return 1
        try:
            text = SEEN_FILE.read_text(encoding="utf-8", errors="replace")
        except Exception:
            text = "# 判重表（看过的都记这儿）\n"

        # 已在表里的 BV —— 用和判重同一套正则，保证口径一致
        existing = set(re.findall(r"BV[0-9A-Za-z]{10}", text))

        lines = []
        for it in items:
            bv = it["bv"]
            if not re.fullmatch(r"BV[0-9A-Za-z]{10}", bv):
                skipped.append({"bv": bv, "why": "BV 号格式不对"})
                continue
            if bv in existing:
                skipped.append({"bv": bv, "why": "表里已有"})
                continue
            existing.add(bv)
            d = it["date"] or today
            line = "- %s | %s | %s" % (d, bv, it["title"] or "（无标题）")
            if it["note"]:
                line += " | " + it["note"]
            lines.append(line)
            added.append(bv)

        if lines:
            if not text.endswith("\n"):
                text += "\n"
            SEEN_FILE.write_text(text + "\n".join(lines) + "\n", encoding="utf-8")

    emit({"ok": True, "added": added, "skipped": skipped, "file": str(SEEN_FILE)})
    return 0


async def cmd_ups(_args):
    """看名单 + 各自最新一条（不写状态，纯展示）"""
    cfg = load_cfg()
    cred = core.load_credential()
    if not cred:
        emit({"ok": False, "error": "未登录"})
        return 4
    out = []
    for ent in (cfg.get("watchedUps") or []):
        name = str(ent.get("name") or "").strip()
        uid = int(ent.get("uid") or 0)
        row = {"name": name, "uid": uid}
        if not uid and name:
            found = await resolve_uid(cred, name)
            if found:
                row["uid"] = found["uid"]
                row["resolvedName"] = found["name"]
        if row["uid"]:
            try:
                vids = await fetch_up_latest(cred, row["uid"], ps=3)
                row["latest"] = vids
            except Exception as e:
                row["error"] = str(e)
        out.append(row)
    emit({"ok": True, "watchedUps": out, "stateFile": str(UP_FILE)})
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description="大肥鱼的刷B站 CLI")
    sub = ap.add_subparsers(dest="cmd", required=True)

    sub.add_parser("whoami", help="看登录的是谁、凭证是否有效").set_defaults(func=cmd_whoami)
    sub.add_parser("status", help="看今天的额度/窗口/登录状态").set_defaults(func=cmd_status)

    p = sub.add_parser("search", help="搜视频")
    p.add_argument("keyword")
    p.add_argument("--num", type=int, default=10)
    p.add_argument("--order", default="totalrank", help="totalrank / click / pubdate / dm")
    p.add_argument("--min-play", type=int, default=0,
                   help="只要播放量 >= 这个数的（0=不限）。关键词轮默认传 50000")
    p.add_argument("--since-days", type=int, default=3,
                   help="只看最近几天的（0=不限）。默认 3，跟 config.json 的 searchDays 对齐")
    p.add_argument("--keep-seen", action="store_true",
                   help="保留看过的视频（默认会按 seen.md 排除掉，调试时才用）")
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("subtitle", help="取 AI 字幕全文")
    p.add_argument("bvid")
    p.set_defaults(func=cmd_subtitle)

    p = sub.add_parser("comments", help="取热门评论")
    p.add_argument("bvid")
    p.add_argument("--num", type=int, default=30)
    p.set_defaults(func=cmd_comments)

    p = sub.add_parser("danmaku", help="取弹幕")
    p.add_argument("bvid")
    p.add_argument("--num", type=int, default=100)
    p.set_defaults(func=cmd_danmaku)

    p = sub.add_parser("video-info", help="视频详情")
    p.add_argument("bvid")
    p.set_defaults(func=cmd_video_info)

    p = sub.add_parser("reply", help="发评论（有安全闸）")
    p.add_argument("bvid")
    p.add_argument("text")
    p.add_argument("--rpid", type=int, default=0)
    p.add_argument("--root", type=int, default=0)
    p.add_argument("--force", action="store_true", help="本人当场让你发的")
    p.set_defaults(func=cmd_reply)

    p = sub.add_parser("dm", help="发 B站私信（开头自动带 BV 号）")
    p.add_argument("bvid", help="视频 BV 号（会原样放在私信开头）")
    p.add_argument("text", help="正文（BV 号会自动加在最前面）")
    p.add_argument("--uid", type=int, default=0,
                   help="收件人 uid；不填就用 config.json 的 mentionName 解析")
    p.set_defaults(func=cmd_dm)

    p = sub.add_parser("login", help="扫码登录（阻塞轮询）")
    p.add_argument("--timeout", type=int, default=180)
    p.set_defaults(func=cmd_login)

    p = sub.add_parser("asr", help="没字幕时本地转写")
    p.add_argument("target")
    p.add_argument("--model", default="")
    p.add_argument("-o", "--out", default="")
    p.set_defaults(func=cmd_asr)

    sub.add_parser("ups", help="看固定 UP 主名单与各自最新投稿").set_defaults(func=cmd_ups)

    # ⭐ 2026-10-25 加：把看过的视频记进 seen.md（走锁，别让模型直接改文件）
    p = sub.add_parser("mark-seen", help="把看过的视频记进 seen.md（加锁、防重复）")
    p.add_argument("--bv", default="", help="单个 BV 号")
    p.add_argument("--title", default="", help="标题")
    p.add_argument("--note", default="", help="一句结论")
    p.add_argument("--date", default="", help="日期 YYYY-MM-DD，默认今天")
    p.add_argument("--items", default="", help='批量：JSON 数组 [{"bv","title","note","date"}]')
    p.set_defaults(func=cmd_mark_seen)

    p = sub.add_parser("up-feed", help="查固定 UP 主有没有新视频")
    p.add_argument("--since-days", type=int, default=3, help="只看最近几天的（0=不限）")
    p.set_defaults(func=cmd_up_feed)

    args = ap.parse_args()
    func = args.func
    if asyncio.iscoroutinefunction(func):
        return asyncio.run(func(args)) or 0
    return func(args) or 0


if __name__ == "__main__":
    raise SystemExit(main())
