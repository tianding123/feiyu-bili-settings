---
name: bili-scroll
description: 替用户刷B站。用户说「刷B站 / 看B站 / 最近有什么新视频 / B站日报 / 再刷一轮」时用，定时任务触发的也是这一套。流程：按关键词搜视频、读字幕原文判断（没字幕且开了转写就用本地 ASR）、翻评论、写日报到 <家目录>/out/，值得的发评论 @ 用户。
---

# 刷B站（大肥鱼自己的工具）

**位置**：家目录的 `bili-duty/` —— `~/.dsh/bili-duty/`（Windows 上是 `%USERPROFILE%\.dsh\bili-duty\`）。配置、凭证、报告、venv、脚本全在里面。
凭证、判重表、配置都在这个目录里；**不依赖 `dsh-bili-scroll` 插件**。

## 🔴 第 -1 步：所有数值都从 config.json 读，本文件里的数字只是**举例**

**本文件里出现的 50000 / 42 / 5 条 / 3 天 / 6 个词 —— 全部是【示例】，不是硬编码。**
真值只有一个来源：`~/.dsh/bili-duty/config.json`（Windows 上是 `%USERPROFILE%\.dsh\bili-duty\config.json`）。

**每轮开工前先读一遍这个文件，把下面这些字段取出来**，后面所有命令都用取到的值：

| 字段 | 管什么 | 本文件里容易被误当成固定值 |
|---|---|---|
| `minPlay` | 关键词搜索的播放量门槛 | ❌「50000」是举例 |
| `searchDays` | 关键词搜几天内的 | ❌「3 天」是举例 |
| `keywords` | 搜哪些词 | ❌「6 个词」是举例，以数组长度为准 |
| `perRound` | 每轮挑几条 | ❌「5 条」是举例 |
| `commentPerRound` | 每轮发几条评论 | ❌「5 条」是举例 |
| `perDay` | 每天最多几轮 | — |
| `mentionName` | @ 谁 | — |
| `autoComment` | 发不发评论 | — |
| `autoRun` | 总开关 | — |
| `watchedUps` | 固定 UP 主名单（数组，随便加减） | — |
| `upCommentPerRound` | UP 主轮每轮评论上限 | — |
| `upCommentPerDay` | UP 主轮每天评论上限 | — |
| `upSinceDays` | UP 主查几天内 | ❌「3 天」是举例 |
| `upNotify` | UP 主更新要不要通知 | — |
| `personaFile` | 人设文件路径 | ✅ 留空 = 用当前会话自己的人格（正常用法） |
| `transcribe` | 没字幕时转不转写 | — |
| `asrModel` | 转写模型档位 | ❌ 别写死 small/medium |

⚠️ **插件设置页改的就是这个文件** —— 用户把门槛调成 8000，这里就必须跑 8000。
**只有字段缺失时才用下面的示例值兜底，并且要在回复里说一句「用的默认值」。**

**解释器**（依赖装在家目录的独立 venv）：

```text
~/.dsh/bili-duty/.venv/Scripts/python.exe
```

## 命令（在家目录 `~/.dsh/bili-duty/` 下跑）

```bat
python bili.py status
python bili.py search "关键词" --num 42 --order pubdate    :: pubdate=最新
python bili.py search "关键词" --num 42 --min-play <minPlay>    :: <minPlay> = config.json 里的值
python bili.py search "关键词" --since-days <searchDays>       :: 只要最近 N 天的（0=不限）
python bili.py subtitle BVxxxxxxxxxx
python bili.py comments BVxxxxxxxxxx --num 30
python bili.py asr BVxxxxxxxxxx                            :: 没字幕时本地转写（transcribe=true 才用）
python bili.py reply BVxxxxxxxxxx "正文"                   :: config 开关/--force 才放行
python bili.py dm BVxxxxxxxxxx "正文"                      :: 发私信（开头自动带 BV 号；dmOnly 才放行）
python bili.py login                                       :: 重新扫码（阻塞轮询）
python bili.py whoami
python bili.py ups                                         :: 看固定 UP 主名单与各自最新投稿
python bili.py up-feed --since-days <upSinceDays>          :: 查固定 UP 主有没有新视频
```

⭐ **`search` 会自动排除 `seen.md` 里看过的视频**（2026-10-22 加）——
返回里 `seenSkipped` = 剔掉几条、`seenTotal` = 表里总共多少条。
**所以不用再手动比对 seen.md 了**，拿到的 `videos` 全是没看过的。
想看全部（调试）加 `--keep-seen`。

## 投递方式（两种，互斥 —— 2026-10-22 加）

**看 `config.json` 的两个开关，哪个是 `true` 就走哪条**（两个都 false 就只写日报）：

| 开关 | 用什么命令 | 说明 |
|---|---|---|
| `autoComment: true` | `bili.py reply <BV> "正文"` | 发公开评论，正文里 @ `mentionName` |
| `dmOnly: true` | `bili.py dm <BV> "正文"` | 发**私信**给 `mentionName` 那个号，**BV 号自动加在私信开头** |
| 两个都 false | 都不发 | 只写日报 |

⚠️ 私信模式每轮最多 **1~2 条**，别刷屏（B站 私信风控比评论严）。

## 播放量门槛（⭐ 用户 2026-10-19 定的规则，**数值以 config.json 为准**）

- **关键词搜索：播放量 ≥ `minPlay`**（`config.json` 的 `minPlay` 字段）——搜的时候加 `--min-play <minPlay>`。
  ⚠️ **`minPlay` 是动态的**：用户在设置页把它改成多少，这里就用多少。**不要写死任何数字。**
  低于门槛的根本不进入候选，别读字幕别写日报。
- **固定 UP 主监控：不加门槛** —— UP 主发什么就看什么，播放量再低也照常处理。
  这条是用户明确要求的，别给 UP 主轮也套关键词门槛。

## 🔴 第 0 步：总开关（每轮先查这个）

读 **家目录** 的配置：`~/.dsh/bili-duty/config.json`。

**看 `autoRun` 字段**：
- 缺省或 `true` → 继续往下跑；
- **`false` → 用户把「自动刷B站」关了，直接回复一句「自动刷已关闭（设置 → 刷B站 里可以打开）」并结束，什么都别做**（不搜、不读、不发评论、不写日报）。

⚠️ 这一步在「防重复」之前做 —— 关了就是关了，别管今天跑没跑过。

## 固定 UP 主监控（up-feed）

`config.json` 里的 `watchedUps` 是名单，每项 `{"name": "昵称", "uid": 0}`：
- `uid` 填 0 时按昵称自动解析（搜一次用户），解析结果写回 config.json，以后直接用；
- 已交付过的 bvid 记在 `seen-up.json`，**不会重复报**；
- 首次监控某个 UP 主只记账（返回 `firstRun: true`），不把历史视频当新的；
- ⭐ 每轮**先跑 up-feed**，UP 主的新视频优先处理；值得的固定发评论 @ `mentionName`（每轮最多 `upCommentPerRound` 条）。
- 🟢 **UP 主轮不设播放量门槛** —— 他们发了什么就看什么，再低也照常读字幕判断。
  ⚠️ `minPlay` 门槛只针对关键词搜索，别套到这儿。
- 🔴 **UP 主轮的评论，最前面必须原样加这句固定开头（一个字都不能改）：**
  `主人！您关注的UP主更新啦！`
  空一格再接正文（哪个 UP 主、发了什么、为什么值得看）。
  ⚠️ **关键词轮不加这句** —— 这是 UP 主轮专用的。

## ⭐ 优先用「派子代理」的方式（定时任务触发时走这条）

**定时任务触发时，不要自己一条条搜、读、翻** —— 派一个子代理去「看」，你只负责「说」。

理由：看视频（搜 + 读字幕 + 翻评论）是耗上下文的体力活，丢给便宜的子代理跑，自己的上下文留给判断和写评论。

### 怎么调

```
subagent {
  provider: 'buddy',
  model: 'hy3',
  description: '刷B站：<午间/傍晚>',
  prompt: <下面这段模板，{direction} 换成 config.json 的**整个 keywords 数组**（用「、」连起来）、
           {n} 换成 config.json 的 perRound、{minPlay} 换成 config.json 的 minPlay、
           {days} 换成 config.json 的 searchDays>
}
```

`buddy/hy3` 是免费的。**一次只派一个子代理**，把**全部关键词**作为 `{direction}` 传进去（用「、」分隔），
子代理会**每个都搜一遍**。

⚠️ `{direction}` **不是只放一个词** —— 从 config.json 的 `keywords` 字段读**全部**关键词
（数量以数组长度为准，用户随时会加/删），整串传给子代理。漏词等于漏看。

### 子代理 prompt 模板

```text
你是一个 B站 侦察兵，只负责「看」，不负责「说」。

工作目录：~/.dsh/bili-duty
解释器：~/.dsh/bili-duty/.venv/Scripts/python.exe

任务：下面这些关键词，**每一个都要单独搜一遍**（不是只搜第一个）：
  {direction}

🔴 **播放量门槛：只保留播放量 ≥ {minPlay} 的视频**（搜索时加 `--min-play {minPlay}`）。
低于门槛的不进入候选，不用读字幕、不用写进报告。

每个关键词搜近 {days} 天的视频，所有结果汇总后挑出最值得的 {n} 条，每条都要读字幕原文。

步骤：
1. 对每个关键词跑：bili.py search "<该关键词>" --num 42 --order pubdate --min-play {minPlay} --since-days {days}
   ⚠️ **`--num` 必须给 42**（B站 搜索第一页上限）。给 10 等于只看「最近上传的 10 条」，
      刚发几小时的视频播放量还没爬上来，门槛必然全灭 —— 这是实测踩过的坑（2026-10-20）。
   ⚠️ 而且**热门词的第一页覆盖范围很短**（「原神剧情」42 条只覆盖 5 小时），
      要真覆盖几天得翻页；现在没有翻页能力，所以窗口别设太小。
2. 汇总所有关键词的结果，**跨关键词去重**（同一 BV 只算一次）
3. ~~对照 seen.md 判重~~ → **已被 `search` 自动完成**（看 `seenSkipped` 就知道剔了几条），**这一步不用再做**
4. 对每个候选跑 bili.py subtitle <BV号> 读原文；
   没字幕时看 config.json 的 `transcribe`：**`true` → 跑 `bili.py asr <BV号>` 本地转写**；`false` → 直接跳过
5. 顺手 bili.py comments <BV号> --num 10 翻一眼评论区
6. 输出一份内部报告，**不要发评论、不要写文件、不要改 state.json 或 seen.md**

报告格式，每条：
- 标题：
- BV号：
- 来自哪个关键词：
- UP主：
- 播放量：
- 讲了什么：（两三句，基于字幕原文，不确定就写「不确定」，别编）
- 为什么值得：
- 评论区反响：（看了就写，没看就写「未看」）

另外单独列一段「跳过的」：哪些关键词搜到了但因播放量不足/无字幕/低质量跳过，各多少条。
```

### 拿到报告之后（你自己做）

1. 从报告里挑最值得的 `perRound` 条（**数量读 config.json，别写死**），**每条单独发一条评论 @ `mentionName`**（config.json 里填的那个人，按「评论怎么写」那节，用你自己的口吻）；
2. 写日报到 `out/<今天>.md`（可以比报告更简）；
3. 更新 `seen.md` 和 `state.json`（含 `runs` 标记）。

⚠️ 子代理的报告是**给你看的草稿**，不是最终输出 —— 评论必须你自己写，别把报告原文贴上去。

### 什么时候不用子代理

- 用户当场让你「跑一轮」、且只有一两个关键词时，自己跑更快；
- 子代理派不出去（provider 不存在 / 报错）→ 退回自己跑，并在日报里写一句。

## ⏰ 定时任务触发时，一轮就按这个顺序做

定时任务的 prompt 很短（只说「到了，按 skill 跑一轮」），**流程全在这里**：

**第 0 步 · 总开关** —— 读 `~/.dsh/bili-duty/config.json` 的 `autoRun`，是 `false` 就回一句「自动刷已关闭」结束。

**第 1 步 · 防重复** —— 每轮都有编号（定时任务的 prompt 里写着「**第 N 轮**」）：

1. 从 prompt 里读出这是**第几轮**（`N`）。读不出来就当第 1 轮。
2. 读同目录的 `state.json`：`runs` 里有今天的 `YYYY-MM-DD:rN` → **回「今天第 N 轮已经跑过了」并结束**，不要重跑。
3. 跑完在 `runs` 里写 `YYYY-MM-DD:rN = true`。

⚠️ 老数据里可能有 `YYYY-MM-DD:noon` / `:night` 这种标记 —— 那是旧版（固定两轮）留下的，**只做参考，判重以 `:rN` 为准**。
⚠️ **手动测试**触发的轮次不查也不写 `runs`（prompt 里会明说）。

**第 2 步 · 固定 UP 主（本鱼自己看，独立配额）** —— 跑
`bili.py up-feed --since-days <config.json 里的 upSinceDays>`，
有新视频就读字幕判断、值得的发评论 @（**评论最前面必须原样加「主人！您关注的UP主更新啦！」**）。
**不加播放量门槛**，不占关键词那 `perRound` 个名额。

**第 3 步 · 关键词（派子代理，占上下文的大头）** —— 按上面「⭐ 优先用「派子代理」的方式」那节：
把 `config.json` 的**全部关键词**交给 `buddy/hy3` 子代理，
**播放量 ≥ `minPlay`**（**从 config.json 读，不许写死**），
**搜近 `searchDays` 天**，子代理出内部报告。

**第 4 步 · 发评论** —— 拿报告挑最值得的 `commentPerRound` 条（**从 config.json 读**），
每条单独发一条评论 @ `mentionName`，用本鱼自己的口吻（关键词轮**不加**那句固定开头）。
发完用 `reply/main?mode=2` 复核。

**第 5 步 · 收尾** —— 写日报 `out/<今天>.md`、更新 `seen.md` 和 `state.json`（含 `runs` 标记）。

## 一轮流程（手动跑 / 参考 `duty.md`）

1. 读 `config.json`：`perDay` / `keywords` / `searchDays` / `minPlay` / `autoComment` / `mentionName` / `transcribe`
2. 每个关键词 `search`，`--order pubdate` 优先，挑**近 `searchDays` 天**
3. ~~判重：读 seen.md~~ → **`search` 已经自动剔掉看过的**（看返回里的 `seenSkipped`），这里不用再做
4. 逐条判断：先 `subtitle`；没字幕且 `transcribe=true` → `asr`；顺手 `comments`
5. 写报告 `out/<今天>.md`：标题 / UP / 链接 / 播放量 / 为什么值得（两三句）/ 一句话；结尾总结
6. 更新 `seen.md`（`日期 | BV | 标题 | 结论`）和 `state.json`（`day` / `count` / `lastRunAt` / `lastWhy`）
7. 评论：只有 `autoComment=true` 且 `mentionName` 非空才发；每轮 ≤ `commentPerRound` 条，
   每条 150 字内、纯文本 @、不刷屏、同一视频只评一次

## 评论怎么写（⭐ 2026-10-18 用户明确要求：别写得像评分员）

**这是「大肥鱼」在帮主人挑东西，不是第三方评测机构在出报告。** 评论要带自己的语气和情绪，别写成干巴巴的总结。

**要的**：
- 说人话，像在跟朋友安利：「这条看完本鱼是真的服」「哼，这个说法本鱼不认」
- 有具体的东西：提到了哪个论点、哪句台词、哪个反差让本鱼有反应 —— 不要空夸「论证完整」
- 可以傲娇、可以吐槽、可以佩服、可以不服
- 150 字内，**信息密度高但读着像人话**

**不要的（这几条是反面清单）**：
- ❌「从…切入」「论证完整」「典型的遗珠」「信息密度高」—— 这类**报告腔/评职称腔**
- ❌ 一条评论里把视频结构复述一遍，像在做摘要
- ❌ 纯客观陈述，读完不知道「本鱼怎么想」
- ❌ 每条都用同一个句式开头（显得是模板生成）

**自检**：把这条评论遮住署名，**还看得出是大肥鱼写的吗？** 看不出来就是写废了，重写。

## 发完评论怎么复核（⭐ 2026-10-19 踩过坑）

**别用 `get_comments(order=TIME)` 查最新评论 —— 它返回的顺序不准，刚发出去的评论会查不到，会让你误以为"被吞了"然后重复发。**

正确的复核方式（命令行跑这段）：

```python
# 复核：这个视频下有没有我的最新评论
python -c "
import asyncio, sys
sys.path.insert(0, '.')
import mcp_server as core
from bilibili_api.utils.network import Api

AID = <视频的 aid>
async def main():
    cred = core.load_credential()
    api = Api(url='https://api.bilibili.com/x/v2/reply/main', method='GET', verify=True, credential=cred)
    api.update_params(type=1, oid=AID, mode=2, ps=20, next=0)   # mode=2 = 按时间
    r = await api.result
    mine = [x for x in (r.get('replies') or []) if int(((x.get('member') or {}).get('mid')) or 0) == int(cred.dedeuserid)]
    print('我的评论:', [(x.get('rpid'), ((x.get('content') or {}).get('message') or '')[:30]) for x in mine])
asyncio.run(main())
"
```

**判据**：
- `send_comment` 返回里带 **`rpid` + `success_toast: "发送成功"`** ⇒ 就是真的发出去了，不用复核也知道；
- 复核用上面的 `reply/main?mode=2`，按自己的 `uid` 找；
- 老接口 `get_comments(order=TIME)` 只适合看"大致有什么评论"，**不能用来判断"我刚发的那条在不在"**。

## 红线

- 不透露隐私（账号、机器路径、聊过的内容）一个字都不许进评论
- 不写会被风控卡的词；不确定的事别编，宁可写「没查到」
- 不刷屏、不吵架

## 注意

- 依赖 venv 在 `~/.dsh/bili-duty/.venv`；万一没了用本目录 `requirements.txt` 重建
- ASR venv 在 `~/.dsh/bili-duty/.venv-asr`；模型缓存在家目录 `.hf-cache`（CLI 已用 `HF_HOME` 指过去）
- 核心实现 `mcp_server.py` 来自 vendor/bilibili-mcp（MIT，作者 AGI_Ananas）
