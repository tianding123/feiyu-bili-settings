/**
 * feiyu-bili-settings —— host 半边
 *
 * 只干一件事：给设置页开一个读写 `/api/feiyu-bili/*` 的小接口，
 * 目标是 `$DSH_HOME/bili-duty/config.json`（bili.py 和定时任务读的同一份）。
 *
 * 约定：
 *   · 全程 try/catch，绝不向上抛 —— 这个插件挂了不该影响 DSH 启动
 *   · 不 append session 事件、不碰别人的服务
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import { loginStart, loginPoll, saveCredential, renderQrPng } from './lib/login.mjs'
import { ensureUv } from './lib/uvfetch.mjs'

export const name = 'feiyu-bili-settings'
// skills 必须列进来：注册 skill 要等它先就绪，靠 apply 时 ctx.get 可能扑空
export const inject = ['webServer', 'skills']

const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const VENDOR_DIR = join(PKG_DIR, 'vendor')

const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')
const HOME_DIR = join(DSH_HOME, 'bili-duty')
const CFG_FILE = join(HOME_DIR, 'config.json')
const STATE_FILE = join(HOME_DIR, 'state.json')


/** 被归档的会话 id（workspace 服务把归档列表存在这里） */
function archivedSessionIds() {
  try {
    const ws = readJson(join(DSH_HOME, 'storages', 'workspace.json'), {})
    const ids = (ws && ws.global && ws.global.archivedSessionIds) || []
    return new Set(ids.map(String))
  } catch {
    return new Set()
  }
}

// 数据全在家目录（换机器也能算对）：
//   bili-duty/
//     ├─ config.json / state.json / seen.md / out/
//     ├─ bili.py / mcp_server.py / requirements.txt   ← 首次运行时从包里的 vendor 铺过来
//     ├─ bili_credential.json
//     ├─ .venv/                                        ← 「装主依赖」建的
//     └─ bin/uv.exe                                    ← 「装主依赖」下的
const BILI_DIR = HOME_DIR
const CRED_FILE = join(BILI_DIR, 'bili_credential.json')
const REQ_FILE = join(BILI_DIR, 'requirements.txt')
// 2026-10-24 修：venv 的 bin 目录名是平台相关的 —— Windows 是 Scripts/，
// Linux/macOS 是 bin/。原来这里把 'Scripts' 写死了，导致云上（Linux）
// 建完 venv 之后插件仍按 .venv/Scripts/python 去找，永远找不到。
const VENV_BIN = process.platform === 'win32' ? 'Scripts' : 'bin'
const PY_EXE = join(BILI_DIR, '.venv', VENV_BIN, process.platform === 'win32' ? 'python.exe' : 'python')
const UV_EXE = join(BILI_DIR, 'bin', process.platform === 'win32' ? 'uv.exe' : 'uv')
const MIRROR = 'https://pypi.tuna.tsinghua.edu.cn/simple'

// ── 更新检查（2026-10-22 加）─────────────────────────────────────────────
// 起因：用户问「我更新以后，能不能给所有下载安装的人推送更新提示」。
// 推送做不到（插件装在各自电脑，没有中心通道），但可以「主动检查 + 设置页提示」。
const REPO = 'tianding123/feiyu-bili-settings'
const UPDATE_API = `https://api.github.com/repos/${REPO}/releases/latest`
const UPDATE_PAGE = `https://github.com/${REPO}/releases`

/** 读本包版本 */
function currentVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(PKG_DIR, 'package.json'), 'utf8'))
    return String(pkg.version || '0.0.0')
  } catch {
    return '0.0.0'
  }
}

/** 版本比较：a>b→1，相等→0，a<b→-1（忽略前缀 v） */
function cmpVersion(a, b) {
  const pa = String(a).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const pb = String(b).replace(/^v/i, '').split('.').map((x) => parseInt(x, 10) || 0)
  const n = Math.max(pa.length, pb.length)
  for (let i = 0; i < n; i += 1) {
    const x = pa[i] || 0
    const y = pb[i] || 0
    if (x > y) return 1
    if (x < y) return -1
  }
  return 0
}

/**
 * 查 GitHub 最新 release。
 * ⚠️ 必须带超时：国内 GitHub API 常常「端口通但数据不来」，
 *    不设超时会一直挂着（uvfetch 就是这么踩的坑）。
 * 查不到就静默返回 ok:false，绝不打扰用户。
 */
async function checkUpdate() {
  const current = currentVersion()
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const r = await fetch(UPDATE_API, {
      headers: {
        'User-Agent': 'feiyu-bili-settings/' + current,
        Accept: 'application/vnd.github+json',
      },
      signal: ctrl.signal,
    })
    clearTimeout(timer)
    if (!r.ok) return { ok: false, current, error: 'HTTP ' + r.status }
    const j = await r.json()
    const latest = String(j.tag_name || '').replace(/^v/i, '')
    const hasUpdate = !!latest && cmpVersion(latest, current) > 0
    return {
      ok: true,
      current,
      latest,
      hasUpdate,
      url: j.html_url || UPDATE_PAGE,
      page: UPDATE_PAGE,
    }
  } catch (e) {
    clearTimeout(timer)
    return { ok: false, current, error: String((e && e.message) || e) }
  }
}

/** 把包里的 vendor 铺到家目录（只在目标不存在时铺，不覆盖用户已有的） */
function ensureHomeFiles() {
  try {
    mkdirSync(BILI_DIR, { recursive: true })
    for (const f of ['bili.py', 'mcp_server.py', 'asr.py', 'requirements.txt']) {
      const to = join(BILI_DIR, f)
      const from = join(VENDOR_DIR, f)
      if (!existsSync(from)) continue
      // ⚠️ 不能只看「存不存在」—— 插件升级后包里的脚本会变（比如加了 --since-days），
      //    只铺缺失的话家目录永远是旧版，新功能装了也不生效。内容不一样就覆盖。
      let needCopy = !existsSync(to)
      if (!needCopy) {
        try {
          const a = readFileSync(from)
          const b = readFileSync(to)
          needCopy = a.length !== b.length || !a.equals(b)
        } catch {
          needCopy = true
        }
      }
      if (needCopy) copyFileSync(from, to)
    }
    return true
  } catch {
    return false
  }
}

/** 跑一个子进程，收完 stdout/stderr 再回 */
function run(cmd, args, opts = {}) {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let child
    try {
      child = spawn(cmd, args, { windowsHide: true, ...opts })
    } catch (e) {
      return resolve({ code: -1, out, err: String(e?.message ?? e) })
    }
    const timer = opts.timeout
      ? setTimeout(() => { try { child.kill() } catch { /* ignore */ } }, opts.timeout)
      : null
    child.stdout?.on('data', (d) => { out += d.toString() })
    child.stderr?.on('data', (d) => { err += d.toString() })
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      resolve({ code: -1, out, err: String(e?.message ?? e) })
    })
    child.on('exit', (c) => {
      if (timer) clearTimeout(timer)
      resolve({ code: c ?? -1, out, err })
    })
  })
}

// ── 安装进度（内存里保留最近若干行，给设置页那个小框看） ──
const PROGRESS = { env: [], asr: [], update: [] }

function pushProgress(kind, text) {
  const arr = PROGRESS[kind]
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '')
    if (!line) continue
    arr.push(line.length > 240 ? line.slice(0, 240) + '…' : line)
  }
  if (arr.length > 40) arr.splice(0, arr.length - 40)
}

/** 带实时行回调的 run（用于装依赖，把进度推进 PROGRESS） */
function runLive(cmd, args, opts, kind) {
  return new Promise((resolve) => {
    let out = ''
    let err = ''
    let child
    try {
      child = spawn(cmd, args, { windowsHide: true, ...opts })
    } catch (e) {
      return resolve({ code: -1, out, err: String(e?.message ?? e) })
    }
    const timer = opts.timeout
      ? setTimeout(() => { try { child.kill() } catch { /* ignore */ } }, opts.timeout)
      : null
    const onData = (d) => {
      const s = d.toString()
      out += s
      pushProgress(kind, s)
    }
    child.stdout?.on('data', onData)
    child.stderr?.on('data', (d) => { err += d.toString(); pushProgress(kind, d.toString()) })
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      resolve({ code: -1, out, err: String(e?.message ?? e) })
    })
    child.on('exit', (c) => {
      if (timer) clearTimeout(timer)
      resolve({ code: c ?? -1, out, err })
    })
  })
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'

// ── 自动更新（2026-10-22 加）─────────────────────────────────────────────
// 用户要求：点「更新」就真装，别只打开网页；并且要有进度小窗口。
// 实现：DSH 自带 node + pnpm（在 resources/runtime 下），从 GitHub 重装本包。

/** DSH 自带的 node / pnpm 路径（换目录也能自己找） */
function runtimeToolchain() {
  try {
    const appDir = dirname(process.execPath)
    const rt = join(appDir, 'resources', 'runtime')
    const nodeExe = join(
      rt,
      'primary-runtime',
      'dependencies',
      'node',
      'bin',
      process.platform === 'win32' ? 'node.exe' : 'node',
    )
    const pnpmCjs = join(rt, 'pnpm', 'bin', 'pnpm.cjs')
    return { node: nodeExe, pnpm: pnpmCjs, ok: existsSync(nodeExe) && existsSync(pnpmCjs) }
  } catch {
    return { node: '', pnpm: '', ok: false }
  }
}

/** profile 目录：插件在 <profile>/node_modules/<包名>，往上两层 */
function profileRoot() {
  try {
    return dirname(dirname(PKG_DIR))
  } catch {
    return ''
  }
}

let updateBusy = false

/**
 * 真正执行更新：pnpm add github:<repo>
 * 进度推到 PROGRESS.update，前端靠 /update/progress 轮询显示。
 */
async function applyUpdate() {
  if (updateBusy) return { ok: false, error: '上一次更新还没跑完，别点两次' }

  const tc = runtimeToolchain()
  if (!tc.ok) {
    return {
      ok: false,
      error: '找不到 DSH 自带的 node/pnpm（在安装目录 resources/runtime 下），没法自动更新',
    }
  }

  const cwd = profileRoot()
  if (!cwd || !existsSync(cwd)) {
    return { ok: false, error: '找不到 profile 目录，没法自动更新' }
  }

  updateBusy = true
  PROGRESS.update.length = 0
  const started = Date.now()

  try {
    const spec = `github:${REPO}`
    pushProgress('update', `从 GitHub 拉最新版：${REPO}`)
    pushProgress('update', '国内网络下可能要等一会儿；GitHub 直连失败会自动重试')

    const res = await runLive(
      tc.node,
      [tc.pnpm, 'add', spec],
      { cwd, timeout: 300000 },
      'update',
    )

    const secs = Math.round((Date.now() - started) / 1000)

    if (res.code === 0) {
      pushProgress('update', `✓ 更新完成（用了 ${secs} 秒）`)
      pushProgress('update', '⚠️ 需要重启 DSH 才会加载新版')
      return { ok: true, restart: true, seconds: secs }
    }

    // 失败时给个人能看懂的原因
    const blob = `${res.err || ''}\n${res.out || ''}`.toLowerCase()
    let hint = `pnpm 退出码 ${res.code}`
    if (/could not connect|etimedout|econnreset|network|connect.*failed/.test(blob)) {
      hint = 'GitHub 连不上（网络问题）。可以开 VPN 后重试，或者手动下载 tgz 安装。'
    } else if (/eacces|permission/.test(blob)) {
      hint = '没有写权限（可能被安全软件拦了）。'
    } else if (/404|not found/.test(blob)) {
      hint = '仓库地址错了，或者仓库被删了。'
    } else if (secs >= 250) {
      hint = '超时了（网速太慢）。'
    }
    pushProgress('update', `✗ 更新失败：${hint}`)
    return { ok: false, error: hint, seconds: secs }
  } catch (e) {
    const msg = String((e && e.message) || e)
    pushProgress('update', `✗ 更新异常：${msg}`)
    return { ok: false, error: msg }
  } finally {
    updateBusy = false
  }
}

/**
 * 建 venv —— Python 版本逐级降级：3.12 → 3.11 → 3.10。
 * uv 会自己下对应版本的 Python，不依赖系统里装了什么，
 * 所以用户系统里是 3.8 还是根本没装都不影响。
 * 只有三个版本全下不下来才失败，而且说清楚为什么、怎么办。
 */
async function makeVenv(dir, kind, label) {
  const versions = ['3.12', '3.11', '3.10']
  let lastErr = ''
  for (let i = 0; i < versions.length; i++) {
    const v = versions[i]
    pushProgress(kind, `创建 ${label} 的 Python 环境（${v}）…`)
    const r = await runLive(UV_EXE, ['venv', '--python', v, dir], {
      cwd: BILI_DIR, timeout: 240000,
    }, kind)
    if (r.code === 0) {
      pushProgress(kind, `✓ Python ${v} 环境建好了`)
      return { step: 'venv', ok: true, version: v }
    }
    lastErr = ((r.out || '') + (r.err || '')).trim().slice(-300)
    if (i < versions.length - 1) {
      pushProgress(kind, `${v} 装不上，换 ${versions[i + 1]} 再试…`)
    }
  }
  pushProgress(kind, '✗ 3.12 / 3.11 / 3.10 都建不起来')
  return {
    step: 'venv',
    ok: false,
    message: 'Python 环境建不出来：3.12 / 3.11 / 3.10 三个版本都试过了。\n'
      + '常见原因：① 网络下不到 Python ② 磁盘空间不够 ③ 杀软拦住了 uv。\n'
      + '手动办法：自己装一个 Python 3.10+ 并加入 PATH，再点一次「装主依赖」。\n'
      + (lastErr ? '\nuv 的原始报错（最后一段）：\n' + lastErr : ''),
  }
}

function readJson(file, fallback) {
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, value) {
  try {
    mkdirSync(HOME_DIR, { recursive: true })
    writeFileSync(file, JSON.stringify(value, null, 2) + '\n', 'utf8')
    return true
  } catch {
    return false
  }
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}

export function apply(ctx) {
  // 启动时把包里的 Python 脚本铺到家目录（只在缺失时铺）
  ensureHomeFiles()

  // 把自带的 SKILL.md 注册成 skill（这样不依赖别的 skill 插件）
  try {
    const skills = ctx.skills
    const mdPath = join(VENDOR_DIR, 'SKILL.md')
    if (skills && typeof skills.register === 'function' && existsSync(mdPath)) {
      const md = readFileSync(mdPath, 'utf8')
      const m = md.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/)
      let skillName = 'bili-scroll'
      let description = '替用户刷B站：按关键词搜视频、读字幕判断、发评论 @ 用户，写日报'
      if (m) {
        const fm = m[1]
        const nm = fm.match(/^name:\s*(.+)$/m)
        const dm = fm.match(/^description:\s*(.+)$/m)
        if (nm) skillName = nm[1].trim()
        if (dm) description = dm[1].trim()
      }
      const body = md.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
      ctx.effect(
        () => skills.register({ name: skillName, description, content: body, source: 'runtime' }),
        'feiyu-bili-settings: 注册 bili-scroll skill',
      )
    }
  } catch {
    /* 注册失败不影响其它功能 */
  }

  const send = (res, code, payload) => {
    try {
      res.statusCode = code
      res.setHeader('content-type', 'application/json; charset=utf-8')
      res.setHeader('cache-control', 'no-store')
      res.end(JSON.stringify(payload))
    } catch {
      /* 客户端已经断了 */
    }
  }

  async function handle(req, res, url) {
    const path = url.pathname.replace(/^\/api\/feiyu-bili/, '') || '/'

    // ── 更新检查（设置页打开时调一次；手动点「检查更新」也走这里）──
    if (req.method === 'GET' && path === '/update/check') {
      const r = await checkUpdate().catch((e) => ({
        ok: false,
        current: currentVersion(),
        error: String((e && e.message) || e),
      }))
      return send(res, 200, r)
    }

    // ── 真正执行更新（点「更新」按钮走这里）──
    if (req.method === 'POST' && path === '/update/apply') {
      const r = await applyUpdate().catch((e) => ({
        ok: false,
        error: String((e && e.message) || e),
      }))
      return send(res, 200, r)
    }

    if (req.method === 'GET' && path === '/config') {
      const scheduleOk = !!ctx.get('schedule')
      return send(res, 200, {
        ok: true,
        config: readJson(CFG_FILE, {}),
        state: readJson(STATE_FILE, {}),
        home: HOME_DIR,
        configFile: CFG_FILE,
        exists: existsSync(CFG_FILE),
        scheduleAvailable: scheduleOk,
        scheduleHint: scheduleOk
          ? ''
          : '当前 DSH 这个 profile 没装定时任务功能（缺 @deepseek-ai/dsh-experimental-schedule-bundle）。'
            + '桌面版自带；用 dsh web 起的话要把它加进 profile 的 bundles。',
      })
    }

    if (req.method === 'POST' && path === '/config') {
      const patch = await readBody(req)
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) {
        return send(res, 400, { ok: false, error: 'body 必须是对象' })
      }
      // 只接受白名单键，别让设置页把别的东西写进来
      const ALLOWED = new Set([
        'autoRun', 'slots', 'keywords', 'minPlay', 'perDay', 'commentPerRound', 'searchDays',
        'autoComment', 'mentionName', 'transcribe', 'asrModel',
        'dmOnly',
        // ⭐ 2026-10-25：评论策略（author-first / content-only），只在 autoComment 开着时生效
        'commentPolicy',
        'watchedUps', 'upCommentPerRound', 'upCommentPerDay', 'upSinceDays', 'scheduleSessionId',
        'blockedUps',
        'personaFile',
      ])
      const cur = readJson(CFG_FILE, {})
      const next = { ...cur }
      for (const [k, v] of Object.entries(patch)) {
        if (ALLOWED.has(k)) next[k] = v
      }
      if (!writeJson(CFG_FILE, next)) {
        return send(res, 500, { ok: false, error: `写不进去：${CFG_FILE}` })
      }
      return send(res, 200, { ok: true, config: next })
    }

    // ── 可选的会话列表（给下拉框用） ──
    if (req.method === 'GET' && path === '/sessions') {
      try {
        const cfg = readJson(CFG_FILE, {})
        const pinned = cfg.scheduleSessionId || ''
        const archived = archivedSessionIds()
        const items = []
        const seen = new Set()

        // 只认 sessionController.list()：它就是侧边栏那份清单。
        // ⚠️ 别拿 sessions.list() 兜底 —— 那是「进程里活着的全部」，含各工作区的空会话，
        //    侧边栏根本不显示它们，补进去就是一堆「未命名会话」噪音。
        let probed = 0
        try {
          const ctrl = ctx.get('sessionController')
          if (ctrl && typeof ctrl.list === 'function') {
            const v = await ctrl.list({}, AbortSignal.timeout(4000))
            for (const s of (v && v.items) || []) {
              const id = String(s.sessionId || '')
              if (!id || seen.has(id)) continue
              if (archived.has(id)) continue          // 归档的不显示
              if (s.origin === 'subagent') continue   // 子代理产生的不显示
              if (s.blank) continue                   // 空会话不显示
              const proj = (s.projections && s.projections.values) || {}
              const title = String(proj.title || proj['session-title'] || proj['sessionTitle'] || '').trim()
              // 没有标题的也跳过：侧边栏里看不到它们，混进来只会让人困惑
              if (!title) continue
              seen.add(id)
              probed++
              items.push({ id, title, cwd: s.cwd || '', updatedAt: s.updatedAt || 0, label: title })
            }
          }
        } catch {
          /* 拿不到就返回空列表，前端会提示先聊一句 */
        }

        // 已选中的会话万一不在上面那份清单里（没标题/被归档），补一条，
        // 否则下拉框会显示成空白，用户以为没选
        if (pinned && !items.some((x) => x.id === pinned)) {
          items.unshift({
            id: pinned,
            title: '',
            cwd: '',
            updatedAt: Date.now(),
            label: `当前绑定的会话 · ${pinned.slice(-6)}`,
          })
        }

        items.sort((a, b) => {
          if (a.id === pinned && b.id !== pinned) return -1
          if (b.id === pinned && a.id !== pinned) return 1
          return (b.updatedAt || 0) - (a.updatedAt || 0)
        })

        return send(res, 200, { ok: true, items, pinned, probed })
      } catch (e) {
        return send(res, 200, { ok: false, items: [], error: String(e?.message || e) })
      }
    }

    // ── 转写环境检查 ──
    if (req.method === 'GET' && path === '/asr/check') {
      const py = join(BILI_DIR, '.venv-asr', VENV_BIN, process.platform === 'win32' ? 'python.exe' : 'python')
      const pyOk = existsSync(py)
      let depsOk = false
      let detail = ''
      if (pyOk) {
        const r = await run(py, ['-c', 'import faster_whisper,av,ctranslate2;print("OK")'], {
          cwd: BILI_DIR, timeout: 30000,
        })
        depsOk = r.code === 0 && /OK/.test(r.out)
        detail = ((r.out || '') + (r.err || '')).trim().split('\n').slice(-3).join('\n').slice(-400)
      } else {
        detail = `找不到转写环境：${py}`
      }
      return send(res, 200, { ok: pyOk && depsOk, python: pyOk, deps: depsOk, pythonPath: py, detail })
    }

    // ── 装转写依赖（可选顺便下模型） ──
    if (req.method === 'POST' && path === '/asr/install') {
      const body = await readBody(req)
      const withModel = !!body.withModel
      const model = String(body.model || 'small')
      PROGRESS.asr.length = 0
      pushProgress('asr', '开始装转写依赖…')
      if (!existsSync(UV_EXE)) {
        pushProgress('asr', '✗ 找不到 uv —— 先点上面的「装主依赖」')
        return send(res, 200, { ok: false, error: `找不到 uv：${UV_EXE}` })
      }
      const asrPy = join(BILI_DIR, '.venv-asr', VENV_BIN, process.platform === 'win32' ? 'python.exe' : 'python')
      const steps = []
      // 1. 建 venv-asr（同样走 3.12 → 3.11 → 3.10 降级）
      if (!existsSync(asrPy)) {
        const ver = await makeVenv(join(BILI_DIR, '.venv-asr'), 'asr', '转写环境')
        steps.push(ver)
        if (!ver.ok) {
          return send(res, 200, { ok: false, error: ver.message, steps })
        }
      }
      // 2. 装包
      pushProgress('asr', '安装 faster-whisper / av / ctranslate2…')
      const r2 = await runLive(UV_EXE, [
        'pip', 'install', '--python', asrPy,
        'faster-whisper', 'av', 'ctranslate2',
        '-i', MIRROR,
      ], { cwd: BILI_DIR, timeout: 600000 }, 'asr')
      steps.push({ step: 'packages', code: r2.code, detail: ((r2.out || '') + (r2.err || '')).slice(-800) })
      if (r2.code !== 0) {
        pushProgress('asr', '✗ 装包失败')
        return send(res, 200, { ok: false, steps })
      }

      // 3. 顺便下模型（可选）
      if (withModel) {
        pushProgress('asr', `下载 ${model} 模型（首次会慢一点）…`)
        const hf = join(BILI_DIR, '.hf-cache')
        const r3 = await runLive(asrPy, [
          '-c',
          `import os;os.environ.setdefault('HF_ENDPOINT','https://hf-mirror.com');` +
          `from faster_whisper import WhisperModel;` +
          `WhisperModel(${JSON.stringify(model)}, device='cpu', compute_type='int8', download_root=${JSON.stringify(hf)});` +
          `print('MODEL_OK')`,
        ], {
          cwd: BILI_DIR, timeout: 900000,
          env: { ...process.env, HF_HOME: hf, HF_ENDPOINT: 'https://hf-mirror.com' },
        }, 'asr')
        steps.push({ step: 'model', code: r3.code, detail: ((r3.out || '') + (r3.err || '')).slice(-600) })
        if (r3.code !== 0) {
          pushProgress('asr', '✗ 模型下载失败')
          return send(res, 200, { ok: false, steps })
        }
      }
      pushProgress('asr', '✓ 转写依赖装好了')

      // 4. 把路径写进 config
      const cfg = readJson(CFG_FILE, {})
      cfg.asrPython = asrPy
      cfg.hfCache = join(BILI_DIR, '.hf-cache')
      writeJson(CFG_FILE, cfg)

      return send(res, 200, { ok: true, steps, asrPython: asrPy })
    }

    // ── 测试跑一轮（无视时段，先做前置检查） ──
    if (req.method === 'POST' && path === '/test-run') {
      const problems = []
      const cfg = readJson(CFG_FILE, {})

      // 1. 主依赖
      const pyOk = existsSync(PY_EXE)
      if (!pyOk) {
        problems.push('主依赖缺失：找不到 Python 环境，先点「装主依赖」')
      } else {
        const r = await run(PY_EXE, ['-c', 'import bilibili_api,mcp,qrcode;print("OK")'], {
          cwd: BILI_DIR, timeout: 20000,
        })
        if (!(r.code === 0 && /OK/.test(r.out))) problems.push('主依赖缺失：Python 包装不全，先点「装主依赖」')
      }

      // 2. 转写依赖（只在开了转写时检查）
      if (cfg.transcribe) {
        const asrPy = join(BILI_DIR, '.venv-asr', VENV_BIN, process.platform === 'win32' ? 'python.exe' : 'python')
        if (!existsSync(asrPy)) {
          problems.push('转写依赖缺失：开了「本地转写」但没装转写环境，先点「装转写依赖」或关掉转写')
        } else {
          const r = await run(asrPy, ['-c', 'import faster_whisper;print("OK")'], { cwd: BILI_DIR, timeout: 30000 })
          if (!(r.code === 0 && /OK/.test(r.out))) problems.push('转写依赖缺失：转写环境里的包装不全，先点「装转写依赖」')
        }
      }

      // 3. 登录状态
      try {
        const c = readJson(CRED_FILE, {})
        if (!c.sessdata) {
          problems.push('登录状态异常：没有凭证，先点「扫码登录」')
        } else {
          const cookie = `SESSDATA=${c.sessdata}; bili_jct=${c.bili_jct || ''}; buvid3=${c.buvid3 || ''}; DedeUserID=${c.dedeuserid || ''}`
          const r = await fetch('https://api.bilibili.com/x/web-interface/nav', {
            headers: { Cookie: cookie, 'User-Agent': UA },
          })
          const j = await r.json().catch(() => null)
          if (!j?.data?.isLogin) problems.push('登录状态异常：凭证失效了，重新扫一次')
        }
      } catch {
        problems.push('登录状态异常：检查登录时网络不通')
      }

      // 4. 关键词 / 特别关注的 UP 主：两样至少要有一样
      const kws = Array.isArray(cfg.keywords) ? cfg.keywords.filter((k) => String(k || '').trim()) : []
      const ups = Array.isArray(cfg.watchedUps)
        ? cfg.watchedUps.filter((u) => u && String(u.name || '').trim())
        : []
      if (!kws.length && !ups.length) {
        problems.push('还没填搜索关键词、也没加特别关注的 UP 主：至少填一个再试')
      }

      // 5. 绑定会话
      const schedule = ctx.get('schedule')
      const sessions = ctx.get('sessions')
      let sessionId = cfg.scheduleSessionId || ''
      if (!sessionId) {
        const list = sessions && typeof sessions.list === 'function' ? sessions.list() : []
        sessionId = list.length ? String(list[list.length - 1].id) : ''
      }
      if (!sessionId) problems.push('没有可用的会话：先在聊天页发一句话，再回来试')

      if (problems.length) {
        return send(res, 200, { ok: false, problems })
      }

      // 前置都过了 → 建一条 1 分钟后的一次性任务
      if (!schedule) {
        return send(res, 200, { ok: false, problems: ['当前 DSH 没装定时任务功能（缺 schedule bundle），测试跑不了'] })
      }
      // 3 秒后触发。⚠️ `at` 用 {date,time} 对象只有分钟精度，所以这里必须传带秒的 RFC3339 字符串。
      const pad = (n) => String(n).padStart(2, '0')
      const toRfc3339 = (d) => {
        const off = -d.getTimezoneOffset()
        const sign = off >= 0 ? '+' : '-'
        return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
          + `T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
          + `${sign}${pad(Math.floor(Math.abs(off) / 60))}:${pad(Math.abs(off) % 60)}`
      }
      const dmOnly = cfg.dmOnly === true
      const autoComment = cfg.autoComment === true
      let deliverLine = '其他全按 SKILL.md 的流程跑一轮（UP 主 + 关键词 + 写日报，**不发评论也不发私信**）。'
      if (dmOnly) {
        deliverLine = '⭐ 用户开的是【仅私信不评论】：递消息给主人用 `bili.py dm <BV号> "正文"`（BV 号会自动加在私信开头），**不要发公开评论**。其余按 SKILL.md 跑一轮（UP 主 + 关键词 + 日报）。'
      } else if (autoComment) {
        deliverLine = '其他全按 SKILL.md 的流程跑一轮（UP 主 + 关键词 + 发评论 + 日报）。'
      }
      const prompt = [
        '刷B站 · 这是一次【手动测试】，用户刚在设置页点了「测试跑一轮」。',
        '',
        '先调用 skill { name: "bili-scroll" }，把 SKILL.md 读进来。',
        '⚠️ 这次是测试：**跳过「防重复」检查**（不读 runs 标记、也不写），**不占当天额度**。',
        deliverLine,
      ].join('\n').trim()

      // 先试 3 秒；万一服务器判定时间已过，无脑再往后挪 5 秒重试一次
      let lastErr = ''
      for (const delayMs of [3000, 8000]) {
        const at = toRfc3339(new Date(Date.now() + delayMs))
        try {
          const rec = await schedule.create(sessionId, {
            title: '刷B站 · 手动测试（一次性）',
            prompt,
            at,
          })
          return send(res, 200, { ok: true, taskId: rec?.id, at, delaySeconds: Math.round(delayMs / 1000), sessionId })
        } catch (e) {
          lastErr = String(e?.message ?? e)
        }
      }
      return send(res, 200, { ok: false, problems: [`建测试任务失败：${lastErr}`] })
    }

    // ── 安装进度（最近 3 行） ──
    if (
      req.method === 'GET' &&
      (path === '/env/progress' || path === '/asr/progress' || path === '/update/progress')
    ) {
      const kind = path.startsWith('/env') ? 'env' : path.startsWith('/asr') ? 'asr' : 'update'
      const all = PROGRESS[kind]
      return send(res, 200, { ok: true, lines: all.slice(-3), total: all.length })
    }

    // ── 环境检查 ──
    if (req.method === 'GET' && path === '/env/check') {
      const pyOk = existsSync(PY_EXE)
      let depsOk = false
      let detail = ''
      if (pyOk) {
        const r = await run(PY_EXE, ['-c', 'import bilibili_api,mcp,qrcode;print("OK")'], {
          cwd: BILI_DIR, timeout: 20000,
        })
        depsOk = r.code === 0 && /OK/.test(r.out)
        detail = ((r.out || '') + (r.err || '')).trim().split('\n').slice(-4).join('\n').slice(-500)
      } else {
        detail = `找不到 Python：${PY_EXE}`
      }
      return send(res, 200, {
        ok: pyOk && depsOk,
        python: pyOk,
        deps: depsOk,
        uv: existsSync(UV_EXE),
        requirements: existsSync(REQ_FILE),
        pythonPath: PY_EXE,
        detail,
      })
    }

    // ── 装主依赖（必要时先下 uv，再建 venv 装包） ──
    if (req.method === 'POST' && path === '/env/install') {
      ensureHomeFiles()
      PROGRESS.env.length = 0
      pushProgress('env', '开始装主依赖…')
      const steps = []

      // 1. 找 uv：家目录 → PATH → 自动下载
      if (!existsSync(UV_EXE)) {
        pushProgress('env', '没找到 uv，准备下载…')
        const okUv = await ensureUv({
          dir: join(BILI_DIR, 'bin'),
          log: (line) => pushProgress('env', line),
        }).catch(() => false)
        if (!okUv || !existsSync(UV_EXE)) {
          pushProgress('env', '✗ uv 下载失败')
          return send(res, 200, {
            ok: false,
            error: '下不动 uv（网络到不了 GitHub / 镜像）。可以自己装个 uv 放到 '
              + join(BILI_DIR, 'bin', 'uv.exe') + ' 再试',
            steps,
          })
        }
        steps.push({ step: 'uv', ok: true })
      }

      // 2. 建 venv（没有才建）—— 版本按 3.12 → 3.11 → 3.10 逐级降，别写死一个
      if (!existsSync(PY_EXE)) {
        const ver = await makeVenv(join(BILI_DIR, '.venv'), 'env', '主依赖')
        steps.push(ver)
        if (!ver.ok) {
          return send(res, 200, {
            ok: false,
            error: ver.message,
            steps,
          })
        }
      }

      // 3. 装 Python 包
      if (!existsSync(REQ_FILE)) {
        return send(res, 200, { ok: false, error: `找不到 requirements.txt：${REQ_FILE}`, steps })
      }
      pushProgress('env', '安装 Python 依赖包…')
      const r = await runLive(UV_EXE, [
        'pip', 'install', '--python', PY_EXE, '-r', REQ_FILE, '-i', MIRROR,
      ], { cwd: BILI_DIR, timeout: 600000 }, 'env')
      steps.push({ step: 'packages', code: r.code, detail: ((r.out || '') + (r.err || '')).slice(-1000) })
      pushProgress('env', r.code === 0 ? '✓ 主依赖装好了' : '✗ 安装失败')
      return send(res, 200, {
        ok: r.code === 0,
        steps,
        detail: ((r.out || '') + (r.err || '')).trim().slice(-1500),
      })
    }

    // ── 当前登录状态 ──
    if (req.method === 'GET' && path === '/whoami') {
      try {
        const c = readJson(CRED_FILE, {})
        if (!c.sessdata) {
          return send(res, 200, { ok: true, loggedIn: false, message: '还没有凭证，点「扫码登录」' })
        }
        const cookie = `SESSDATA=${c.sessdata}; bili_jct=${c.bili_jct || ''}; buvid3=${c.buvid3 || ''}; DedeUserID=${c.dedeuserid || ''}`
        const r = await fetch('https://api.bilibili.com/x/web-interface/nav', {
          headers: { Cookie: cookie, 'User-Agent': UA },
        })
        const j = await r.json().catch(() => null)
        const d = j?.data || {}
        return send(res, 200, {
          ok: true,
          loggedIn: !!d.isLogin,
          username: d.uname || '',
          uid: d.mid || c.dedeuserid || '',
          level: d.level || 0,
          message: d.isLogin ? '凭证有效' : '凭证失效了，重新扫一次',
        })
      } catch (e) {
        return send(res, 200, { ok: false, loggedIn: false, error: String(e?.message || e) })
      }
    }


    // ── 扫码登录：生成二维码 ──
    if (req.method === 'POST' && path === '/login/start') {
      try {
        const { key, url } = await loginStart()
        let qr = null
        try {
          const png = await renderQrPng(PY_EXE, HOME_DIR, url)
          if (png) qr = 'data:image/png;base64,' + readFileSync(png).toString('base64')
        } catch {
          /* 画不出图就只给链接，前端会提示 */
        }
        return send(res, 200, { ok: true, key, url, qr })
      } catch (e) {
        return send(res, 200, { ok: false, error: String(e?.message || e) })
      }
    }

    // ── 扫码登录：轮询一次 ──
    if (req.method === 'POST' && path === '/login/poll') {
      try {
        const body = await readBody(req)
        const key = String(body.key || '')
        if (!key) return send(res, 400, { ok: false, error: '缺 key' })
        const r = await loginPoll(key)
        if (r.state === 'ok') {
          const file = saveCredential(BILI_DIR, r.credential)
          return send(res, 200, { ok: true, state: 'ok', file })
        }
        return send(res, 200, { ok: true, state: r.state, code: r.code, message: r.message })
      } catch (e) {
        return send(res, 200, { ok: false, error: String(e?.message || e) })
      }
    }

    // ── 按 slots 重建「刷B站」定时任务 ──
    if (req.method === 'POST' && path === '/apply-slots') {
      const schedule = ctx.get('schedule')
      if (!schedule) {
        return send(res, 200, {
          ok: false,
          error: '当前 DSH 没装定时任务功能（缺 @deepseek-ai/dsh-experimental-schedule-bundle），'
            + '所以建不了自动刷任务。桌面版自带这个功能；用 dsh web 起的 profile 需要把它加进 bundles。',
        })
      }
      const cfg = readJson(CFG_FILE, {})
      const slots = Array.isArray(cfg.slots) ? cfg.slots : []
      if (!slots.length) {
        return send(res, 400, { ok: false, error: 'config.json 里没有 slots' })
      }

      // 1. 找出所有已有的「刷B站」任务（含它们绑定的会话）
      const catalog = await schedule.catalog()
      const mine = (catalog || []).filter((t) => typeof t?.title === 'string' && t.title.startsWith('刷B站'))

      // 2. 决定绑到哪个会话：用户在设置页选的 > 沿用已有任务的绑定 > 当前活跃会话里最后一个
      let sessionId = String(cfg.scheduleSessionId || '').trim() || mine[0]?.sessionId
      if (!sessionId) {
        const sessions = ctx.get('sessions')
        const list = sessions && typeof sessions.list === 'function' ? sessions.list() : []
        const last = list && list.length ? list[list.length - 1] : null
        sessionId = last?.id
      }
      if (!sessionId) {
        return send(res, 500, { ok: false, error: '找不到可绑定的会话（先在 DSH 里开一个会话，或在下拉框里选一个）' })
      }

      // 3. 删掉旧的「刷B站」任务
      const removed = []
      for (const t of mine) {
        try {
          await schedule.delete({ sessionId: t.sessionId, id: t.id })
          removed.push(t.title)
        } catch {
          /* 单条删失败不影响其它 */
        }
      }

      // 4. 按 slots 建新的。⚠️ prompt 必须 trim —— 尾部空白会让整个 schedule 服务加载失败
      const created = []
      const errors = []
      for (let i = 0; i < slots.length; i++) {
        const s = slots[i] || {}
        const start = String(s.start || '').slice(0, 5)
        const end = String(s.end || '').slice(0, 5)
        if (!/^\d{2}:\d{2}$/.test(start)) {
          errors.push(`第 ${i + 1} 轮时间不合法：${s.start}`)
          continue
        }
        const title = `刷B站 · 第${i + 1}轮（${start}–${end || '?'}）`
        const lines = [
          `刷B站 · 第${i + 1}轮（${start}–${end || '?'}）到了。`,
          '',
          '先调用 skill { name: "bili-scroll" }，把 SKILL.md 读进来，然后完全按它跑一轮。',
          `⚠️ 这是今天的**第 ${i + 1} 轮**，防重标记记作 \`runs["<今天>:r${i + 1}"]\`。`,
        ]
          if (cfg.dmOnly === true) {
            lines.push('')
            lines.push('⭐ 用户开的是【仅私信不评论】：递消息给主人用 `bili.py dm <BV号> "正文"`，**不要发公开评论**。')
          } else if (cfg.autoComment === true) {
            lines.push('')
            lines.push('⭐ 用户开的是【自动评论并 @ 我】：走 `bili.py reply` 发公开评论。')
          } else {
            lines.push('')
            lines.push('⭐ 用户两个开关都关着：**不发评论也不发私信**，只写日报。')
          }
        const personaFile = String(cfg.personaFile || '').trim()
        if (personaFile) {
          lines.push('')
          lines.push(`📖 **人设**：读 ${personaFile} ，这一轮的语气和写法按它来（它说了算，别用你默认那套）。`)
        }
        const prompt = lines.join('\n').trim()
        try {
          const rec = await schedule.create(sessionId, {
            title,
            prompt,
            daily: { time: `${start}:00`, time_zone: 'Asia/Shanghai' },
          })
          created.push({ title, id: rec?.id })
        } catch (e) {
          errors.push(`${title}: ${e?.message ?? String(e)}`)
        }
      }

      return send(res, 200, {
        ok: errors.length === 0,
        created: created.length,
        removed: removed.length,
        sessionId,
        tasks: created,
        errors,
      })
    }

    return send(res, 404, { ok: false, error: `unknown ${req.method} ${path}` })
  }

  try {
    ctx.effect(() => ctx.webServer.register({
      kind: 'prefix',
      path: '/api/feiyu-bili',
      handler: async (req, res) => {
        try {
          await handle(req, res, new URL(req.url, 'http://127.0.0.1'))
        } catch (e) {
          send(res, 500, { ok: false, error: e?.message ?? String(e) })
        }
      },
    }), 'feiyu-bili-settings: /api/feiyu-bili 路由')
  } catch {
    /* 路由没挂上也别炸 */
  }
}
