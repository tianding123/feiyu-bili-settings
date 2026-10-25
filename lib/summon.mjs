/**
 * summon.mjs —— 回应召唤：后台轮询 B站 @ 消息，有召唤就唤醒 agent
 *
 * ⭐ 2026-10-25 新建。
 *
 * 为什么是轮询：B站 的 @ 通知没有推送接口（Web 端也是每 30 秒问一次），
 * 所以只能我们自己定时问。好处是：问的时候不调模型 —— 只有真来了召唤，
 * 才 followup 叫醒 agent，所以常驻成本 ≈ 0 token。
 *
 * 设计要点：
 *   · 只在 respondSummon=true 时才跑
 *   · 名单里（summonMasters）的人：一律回，不看频率
 *   · 名单外的人：要 summonAcceptOthers=true，且受 summonRateLimit 限制（每 10 分钟）
 *   · 已处理过的 rpid 记在 summon-seen.json，不重复叫醒
 *   · 全程 try/catch —— 这里挂了绝不能影响 DSH 本体
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn } from 'node:child_process'

const SOURCE_KIND = 'plugin:feiyu-bili-settings'
const WINDOW_MS = 10 * 60 * 1000 // 名单外的频率窗口：10 分钟
const MAX_SEEN = 200

function dutyDir() {
  return join(homedir(), '.dsh', 'bili-duty')
}

function cfgPath() {
  return join(dutyDir(), 'config.json')
}

function seenPath() {
  return join(dutyDir(), 'summon-seen.json')
}

function readCfg() {
  try {
    return JSON.parse(readFileSync(cfgPath(), 'utf8'))
  } catch {
    return {}
  }
}

function loadSeen() {
  try {
    const d = JSON.parse(readFileSync(seenPath(), 'utf8'))
    return {
      ids: Array.isArray(d.ids) ? d.ids : [],
      rateHits: Array.isArray(d.rateHits) ? d.rateHits : [],
    }
  } catch {
    return { ids: [], rateHits: [] }
  }
}

function saveSeen(state) {
  try {
    mkdirSync(dutyDir(), { recursive: true })
    const ids = state.ids.slice(-MAX_SEEN)
    writeFileSync(seenPath(), JSON.stringify({ ids, rateHits: state.rateHits }, null, 0), 'utf8')
  } catch {
    /* 存不下就算了，下次可能重复叫醒一次，无伤 */
  }
}

/** 找 bili-duty 的 python 解释器（Windows / Linux 两套路径都试） */
function pythonPath() {
  const base = dutyDir()
  const win = join(base, '.venv', 'Scripts', 'python.exe')
  const nix = join(base, '.venv', 'bin', 'python')
  if (existsSync(win)) return win
  if (existsSync(nix)) return nix
  return ''
}

/** 跑 bili.py，拿 stdout 的 JSON */
function runBili(args, timeoutMs = 40000) {
  return new Promise((resolve) => {
    const py = pythonPath()
    if (!py) {
      resolve({ ok: false, error: '找不到 .venv 里的 python' })
      return
    }
    const script = join(dutyDir(), 'bili.py')
    if (!existsSync(script)) {
      resolve({ ok: false, error: '找不到 bili.py' })
      return
    }
    let out = ''
    let err = ''
    let done = false
    let child
    try {
      child = spawn(py, [script, ...args], {
        cwd: dutyDir(),
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
      })
    } catch (e) {
      resolve({ ok: false, error: String(e && e.message ? e.message : e) })
      return
    }
    const timer = setTimeout(() => {
      if (done) return
      done = true
      try { child.kill() } catch {}
      resolve({ ok: false, error: '超时' })
    }, timeoutMs)
    child.stdout?.setEncoding?.('utf8')
    child.stderr?.setEncoding?.('utf8')
    child.stdout?.on?.('data', (d) => { out += d })
    child.stderr?.on?.('data', (d) => { err += d })
    child.on('error', (e) => {
      if (done) return
      done = true
      clearTimeout(timer)
      resolve({ ok: false, error: String(e && e.message ? e.message : e) })
    })
    child.on('close', () => {
      if (done) return
      done = true
      clearTimeout(timer)
      try {
        const d = JSON.parse(out.trim() || '{}')
        resolve(d)
      } catch {
        resolve({ ok: false, error: '输出不是 JSON: ' + (out.slice(0, 200) || err.slice(0, 200)) })
      }
    })
  })
}

/**
 * 轮询一次。ctx 用来拿 agents 服务。
 * 返回一个「报告对象」，给诊断日志用（也方便手动调测试）。
 */
/**
 * ⭐ 2026-10-25 加：查「我自己发的评论有新回复吗」。
 *
 * 为什么要这个：B站 的 @ 通知只收「一级评论里手动 @」，
 * 不收「回复你时前缀里带的 @」。但用户直觉就是：
 * 在你回复底下回你，你当然该看到。所以要自己去查。
 *
 * 成本控制：只查 my-replies.json 里最近 24 小时发的评论（上限 200 条）。
 */
async function pollMyReplies() {
  const res = await runBili(['my-replies', '--hours', '24'])
  if (!res || res.ok === false) return []
  const list = Array.isArray(res.items) ? res.items : []
  if (!list.length) return []

  const out = []
  for (const it of list) {
    const r = await runBili(['replies-to', '--bvid', it.bvid, '--rpid', String(it.rpid), '--hours', '2'])
    if (!r || r.ok === false) continue
    for (const s of (r.items || [])) {
      if (s.is_mine) continue
      out.push({
        mid: s.mid,
        name: s.name,
        bvid: it.bvid,
        rpid: s.rpid,
        root: it.rpid,
        text: s.text,
        source_content: s.text,
        from_reply: true,
      })
    }
  }
  return out
}


/**
 * ⭐ 2026-10-25 加：查「名单内的人发的私信」。
 *
 * 只看 summonMasters 里的人（是主人）。陌生人的私信一律不回。
 */
async function pollDms() {
  const res = await runBili(['dms', '--hours', '24'])
  if (!res || res.ok === false) return []
  const list = Array.isArray(res.items) ? res.items : []
  const out = []
  for (const it of list) {
    out.push({
      mid: it.mid,
      name: (it.mid === '37459266' ? '绝区拾叁' : it.name) || ('mid ' + it.mid),
      bvid: '',
      rpid: 0,
      root: 0,
      text: it.last_text || '',
      source_content: it.last_text || '',
      from_dm: true,
      dm_ts: it.ts || 0,
    })
  }
  return out
}


export async function pollSummonOnce(ctx, opts = {}) {
  const report = { ran: false, reason: '', fresh: 0, woken: 0, skipped: [] }

  const cfg = readCfg()
  if (!cfg.respondSummon) {
    report.reason = 'respondSummon=false'
    return report
  }
  report.ran = true

  const masters = new Set(
    (Array.isArray(cfg.summonMasters) ? cfg.summonMasters : [])
      .map((u) => String((u && (u.mid ?? u.uid)) ?? '').trim())
      .filter(Boolean),
  )
  const acceptOthers = !!cfg.summonAcceptOthers
  const rateLimit = Math.max(1, Number(cfg.summonRateLimit) || 3)

  const res = await runBili(['mentions', '--limit', '20'])
  const atItems = (res && res.ok !== false && Array.isArray(res.items)) ? res.items : []
  if (!res || res.ok === false) {
    report.reason = 'mentions 失败: ' + String((res && res.error) || '未知')
  }

  // ⭐ 2026-10-25：再加一路 —— 「我的评论有新回复」
  const replyItems = await pollMyReplies()
  const dmItems = await pollDms()
  report.fromAt = atItems.length
  report.fromReply = replyItems.length
  report.fromDm = dmItems.length
  const items = atItems.concat(replyItems).concat(dmItems)

  const state = loadSeen()
  const seenSet = new Set(state.ids.map(String))
  const now = Date.now()

  // 清理旧的频率命中记录（只看最近 10 分钟）
  const recentHits = state.rateHits
    .map((h) => ({ t: Number(h && h.t) || 0 }))
    .filter((h) => now - h.t < WINDOW_MS)

  const fresh = []
  for (const it of items) {
    const rpid = String(it.rpid || 0)
    const key = it.from_dm
      ? 'd:' + String(it.mid || '') + ':' + String(it.dm_ts || '')
      : (rpid && rpid !== '0' ? 'r:' + rpid : 'm:' + String(it.mid || '') + ':' + String(it.text || '').slice(0, 40))
    if (seenSet.has(key)) {
      report.skipped.push('已处理:' + key)
      continue
    }
    const mid = String(it.mid || '').trim()
    const isMaster = masters.has(mid)

    if (!isMaster && !acceptOthers) {
      seenSet.add(key)
      report.skipped.push('名单外且不接受:' + mid)
      continue
    }
    if (!it.bvid && !it.from_dm) {
      seenSet.add(key)
      report.skipped.push('没有 BV 号:' + key)
      continue
    }
    // 名单外的人要走频率闸
    if (!isMaster) {
      if (recentHits.length >= rateLimit) {
        seenSet.add(key)
        report.skipped.push('超过频率上限(' + rateLimit + '/10min)')
        continue
      }
      recentHits.push({ t: now })
    }
    fresh.push({ ...it, key, isMaster })
  }

  report.fresh = fresh.length
  if (!fresh.length) {
    saveSeen({ ids: [...seenSet].slice(-MAX_SEEN), rateHits: recentHits })
    return report
  }

  // 找目标 agent：严格按 config.scheduleSessionId（和刷B站用同一个会话）
  const agentsSvc = typeof ctx?.get === 'function' ? ctx.get('agents') : undefined
  const all = (agentsSvc && typeof agentsSvc.list === 'function') ? agentsSvc.list() : []
  report.alive = all.map((a) => String(a && a.id))
  const wantId = String(cfg.scheduleSessionId || '').trim()
  report.wantId = wantId
  let target = undefined
  if (wantId) {
    target = all.find((a) => String(a && a.id) === wantId)
    if (!target && cfg.summonFallbackAny) {
      // ⭐ 2026-10-25 加：目标会话不在线时，如果开了 summonFallbackAny，
      //   就回退到第一个活着的 root 会话（避免本机永远唤不醒）。
      //   默认关；本机调试时可以手动打开。
      const roots = (agentsSvc && typeof agentsSvc.roots === 'function') ? agentsSvc.roots() : []
      target = roots && roots.length ? roots[0] : all[0]
      if (target) {
        report.fallbackFrom = wantId
        report.fallbackTo = String(target.id || '')
      }
    }
    if (!target) {
      // 目标会话不在线且没开回退 → 宁可这轮不干活，
      // 也不能把消息塞进别的会话。
      report.reason = '目标会话不在线: ' + wantId
      saveSeen({ ids: [...seenSet].slice(-MAX_SEEN), rateHits: recentHits })
      return report
    }
  } else {
    if (agentsSvc && typeof agentsSvc.roots === 'function') {
      const roots = agentsSvc.roots()
      target = roots && roots.length ? roots[0] : undefined
    }
    if (!target) target = all[0]
  }

  if (!target || typeof target.followup !== 'function') {
    report.reason = '没有可唤醒的 agent（目标 ' + (wantId || '未指定') + '，存活 ' + all.length + ' 个）'
    saveSeen({ ids: [...seenSet].slice(-MAX_SEEN), rateHits: recentHits })
    return report
  }
  report.targetId = String(target.id || '')

  // 动态 import —— 拿不到就退化成手写结构（尽量不影响启动）
  let createUserMessage
  try {
    const mod = await import('@deepseek-ai/dsh-llm')
    createUserMessage = mod.createUserMessage
  } catch {
    createUserMessage = undefined
  }

  const make = (text) => {
    if (typeof createUserMessage === 'function') {
      return createUserMessage({ content: [{ type: 'text', text }], source: { kind: SOURCE_KIND } })
    }
    return {
      role: 'user',
      content: [{ type: 'text', text }],
      source: { kind: SOURCE_KIND },
    }
  }

  for (const it of fresh) {
    const lines = [
      '【B站有人召唤你】',
      '谁：' + (it.name || '') + '（mid ' + (it.mid || '') + '）' + (it.isMaster ? '【名单内·无限制】' : '【名单外】'),
      '视频：' + it.bvid,
      '视频标题：' + String(it.text || '').slice(0, 120),
      '要回复的评论 rpid：' + (it.rpid || 0),
      '楼层根评论 root：' + (it.root || 0),
      '他说：' + String(it.source_content || it.text || '').slice(0, 300),
    ]
    lines.push('')
    lines.push('⭐ 怎么处理：你自己判断，别套模板。')
    lines.push('他可能是让你总结/评价这个视频，也可能只是随口跟你聊两句 —— 看他到底说了什么。')
    lines.push('· 跟视频内容有关的（总结、评价、解读）：先读字幕 bili.py subtitle ' + it.bvid + '，再回')
    lines.push('· 只是闲聊 / 问别的：直接回，不用读视频')
    lines.push('· 拿不准：先按他的话直答，别硬往「总结视频」上套')
    lines.push('')
    if (it.isMaster) {
      lines.push('⭐ 说话对象：主人 —— 按平时那样回，可以叫「主人」、可以撒点娇。')
    } else {
      lines.push('⭐ 说话对象：陌生人 —— 客气，但保持距离：')
      lines.push('   · 不叫「主人」、不卖萌、不「本鱼本鱼」地撒娇')
      lines.push('   · 不问私事、不套近乎、不当朋友处')
      lines.push('   · 干净、客气、就事论事；对方问什么答什么，答完就收')
    }
    lines.push('')
    if (it.from_dm) {
      lines.push('回复命令：bili.py dm-reply "正文" --uid ' + (it.mid || 0))
      lines.push('（这是私信，不要用 reply；dm-reply 不带 BV 号）')
    } else {
      lines.push('回复命令：bili.py reply ' + it.bvid + ' "正文" --rpid ' + (it.rpid || 0) + ' --root ' + (it.root || 0))
    }
    lines.push('150 字以内；别写「本鱼认」这类话。')
    try {
      target.followup(make(lines.join('\n')))
      seenSet.add(it.key)
      report.woken += 1
      report.skipped.push('已唤醒:' + it.key)
    } catch (e) {
      report.skipped.push('followup 失败:' + String(e && e.message ? e.message : e))
    }
  }

  saveSeen({ ids: [...seenSet].slice(-MAX_SEEN), rateHits: recentHits })
  return report
}

/** 起一个常驻定时器。返回 stop()。 */
export function startSummonWatcher(ctx, log, intervalMs = 60000) {
  let busy = false
  let busySince = 0
  let round = 0

  const tick = async () => {
    // 2026-10-25 修：busy 加超时逃逸，3 分钟强制放行，防永久卡死
    if (busy && Date.now() - busySince < 180000) return
    busy = true
    busySince = Date.now()
    try {
      const r = await pollSummonOnce(ctx)
      round += 1

      // 每 30 轮（约 30 分钟）写一行心跳，方便确认 watcher 还活着
      if (round % 30 === 0) {
        log(
          '[summon] heartbeat round=' + round +
          ' at=' + (r.fromAt === undefined ? '?' : r.fromAt) +
          ' reply=' + (r.fromReply === undefined ? '?' : r.fromReply) +
          ' dm=' + (r.fromDm === undefined ? '?' : r.fromDm) +
          (r.ran ? '' : ' (未运行:' + (r.reason || '') + ')'),
        )
      }

      if (r.ran && (r.fresh || r.woken || r.reason)) {
        log(
          '[summon] fresh=' + r.fresh + ' woken=' + r.woken +
          ' at=' + (r.fromAt === undefined ? '?' : r.fromAt) +
          ' reply=' + (r.fromReply === undefined ? '?' : r.fromReply) +
          ' dm=' + (r.fromDm === undefined ? '?' : r.fromDm) +
          (r.fallbackFrom ? ' fallback=' + r.fallbackFrom + '->' + r.fallbackTo : '') +
          (r.reason ? ' reason=' + r.reason : '') +
          (r.skipped.length ? ' skipped=' + r.skipped.slice(0, 5).join('|') : ''),
        )
      }
    } catch (e) {
      log('[summon] 异常: ' + String(e && e.message ? e.message : e))
    } finally {
      busy = false
    }
  }

  const timer = setInterval(() => { void tick() }, intervalMs)
  // 2026-10-25 修：不再调 timer.unref() ——
  //   unref 让定时器"不阻止进程退出"，但在 DSH 宿主里实测会导致
  //   定时器长时间不触发（云上 14:28 之后 7 分钟一轮都没跑）。
  //   清理靠 ctx.effect 里的 stopWatcher，不会漏。

  return () => {
    try { clearInterval(timer) } catch {}
  }
}
