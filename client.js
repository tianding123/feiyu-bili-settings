/**
 * feiyu-bili-settings —— 浏览器半边（设置页里的一页「刷B站」）
 *
 * client bundle 是**自注册脚本**，不是 ESM：
 *   window.__ModuleLoader__.load({ id: '<包名>', factory: (require) => ({ inject, apply }) })
 *
 * 数据面：host 那半边开的 `/api/feiyu-bili/config`（GET 读 / POST 写），
 * 目标文件是 `$DSH_HOME/bili-duty/config.json` —— 和 bili.py、定时任务读的是同一份。
 */
window.__ModuleLoader__.load({
  id: 'feiyu-bili-settings',
  factory: (require) => {
    const React = require('react')
    const h = React.createElement

    const API = '/api/feiyu-bili'
    const jget = async (p) => (await fetch(API + p, { credentials: 'same-origin' })).json()
    const jpost = async (p, body) => (await fetch(API + p, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body || {}),
    })).json()

    const CSS = `
[data-fbs]{display:flex;flex-direction:column;gap:18px;padding:2px 2px 8px;max-width:660px;}
[data-fbs-sec]{display:flex;flex-direction:column;gap:10px;}
[data-fbs-credit]{font-size:14px;font-weight:500;letter-spacing:.02em;text-align:center;
  padding:0 0 6px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-fbs-h]{font-size:15px;font-weight:700;letter-spacing:.01em;
  color:var(--dsw-alias-label-primary,#e8eaed);margin-bottom:2px;}
[data-fbs-row]{display:flex;align-items:center;gap:10px;}
[data-fbs-grow]{flex:1;min-width:0;}
[data-fbs-h2]{font-size:12px;font-weight:500;margin-top:2px;}
[data-fbs-label]{font-size:12px;font-weight:500;}
[data-fbs-note]{font-size:10px;line-height:15px;color:var(--dsw-alias-label-tertiary,#9aa0a6);}
[data-fbs-sw]{flex:none;width:38px;height:22px;border-radius:11px;border:0;cursor:pointer;position:relative;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.35));transition:background .15s;padding:0;}
[data-fbs-sw][data-on]{background:#3b82f6;}
[data-fbs-sw] i{position:absolute;top:3px;left:3px;width:16px;height:16px;border-radius:50%;background:#fff;
  transition:left .15s;display:block;}
[data-fbs-sw][data-on] i{left:19px;}
[data-fbs-input]{width:100%;box-sizing:border-box;padding:7px 9px;border-radius:8px;font-size:12px;
  background:var(--dsw-alias-bg-l2,rgba(128,128,128,.10));color:inherit;
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));outline:none;font-family:inherit;
  color-scheme:dark;}
[data-fbs-input] option{background-color:#242731;color:#e8eaed;}
[data-fbs-input]:focus{border-color:#3b82f6;}
[data-fbs-num]{width:96px;box-sizing:border-box;padding:6px 9px;border-radius:8px;font-size:12px;
  background:var(--dsw-alias-bg-l2,rgba(128,128,128,.10));color:inherit;
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));outline:none;font-family:inherit;}
[data-fbs-time]{width:104px;flex:none;box-sizing:border-box;padding:6px 8px;border-radius:8px;font-size:12px;
  background:var(--dsw-alias-bg-l2,rgba(128,128,128,.10));color:inherit;
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));outline:none;font-family:inherit;}
[data-fbs-log]{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:10px;line-height:1.5;
  background:rgba(0,0,0,.22);border-radius:6px;padding:6px 8px;
  height:54px;overflow:hidden;white-space:pre-wrap;word-break:break-all;
  color:var(--dsw-alias-label-secondary,#9aa0a6);}
[data-fbs-sub]{margin-left:14px;padding-left:12px;border-left:2px solid var(--dsw-alias-border-l2,rgba(128,128,128,.18));
  display:flex;flex-direction:column;gap:10px;}
[data-fbs-ta]{width:100%;box-sizing:border-box;min-height:96px;padding:8px 9px;border-radius:8px;font-size:12px;
  background:var(--dsw-alias-bg-l2,rgba(128,128,128,.10));color:inherit;resize:vertical;
  border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.22));outline:none;font-family:ui-monospace,monospace;line-height:1.6;}
[data-fbs-btn]{padding:7px 16px;border-radius:8px;font-size:12px;cursor:pointer;border:0;font-family:inherit;
  background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.22));color:inherit;}
[data-fbs-btn][data-primary]{background:#3b82f6;color:#fff;}
[data-fbs-btn][disabled]{opacity:.5;cursor:default;}
[data-fbs-btn][data-danger]{color:#e5484d;background:transparent;padding:4px 8px;}
[data-fbs-up]{display:flex;align-items:center;gap:8px;padding:6px 0;
  border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.12));}
[data-fbs-badge]{font-size:10px;padding:2px 7px;border-radius:6px;background:rgba(59,130,246,.14);color:#5599f5;}
[data-fbs-ok]{color:#3fb950;font-size:11px;}
[data-fbs-err]{color:#e5484d;font-size:11px;}
`

    function Section({ title, children, lined }) {
      return h('div', { 'data-fbs-sec': '' },
        title ? h('div', { 'data-fbs-h': '' }, title) : null,
        // lined：把内容包进左边那条竖线里，告诉用户"下面这一片都属于这个板块"
        lined ? h('div', { 'data-fbs-sub': '' }, children) : children,
      )
    }

    function Toggle({ label, note, value, onChange }) {
      return h('div', { 'data-fbs-row': '' },
        h('div', { 'data-fbs-grow': '' },
          h('div', { 'data-fbs-label': '' }, label),
          note ? h('div', { 'data-fbs-note': '' }, note) : null),
        h('button', {
          'data-fbs-sw': '', 'data-on': value ? '' : undefined,
          onClick: () => onChange(!value),
          'aria-label': label,
        }, h('i')),
      )
    }

    function NumField({ label, note, value, min, max, onChange }) {
      return h('div', { 'data-fbs-row': '' },
        h('div', { 'data-fbs-grow': '' },
          h('div', { 'data-fbs-label': '' }, label),
          note ? h('div', { 'data-fbs-note': '' }, note) : null),
        h('input', {
          'data-fbs-num': '', type: 'number', value: value ?? 0,
          min: min ?? 0, max: max ?? undefined,
          onChange: (e) => onChange(Number(e.target.value)),
        }),
      )
    }

    function TextField({ label, note, value, placeholder, onChange }) {
      return h('div', { 'data-fbs-sec': '' },
        h('div', { 'data-fbs-label': '' }, label),
        note ? h('div', { 'data-fbs-note': '' }, note) : null,
        h('input', {
          'data-fbs-input': '', type: 'text', value: value ?? '',
          placeholder: placeholder ?? '',
          onChange: (e) => onChange(e.target.value),
        }),
      )
    }

    function Panel() {
      const [cfg, setCfg] = React.useState(null)
      const [st, setSt] = React.useState({})
      const [home, setHome] = React.useState('')
      const [loading, setLoading] = React.useState(true)
      const [saving, setSaving] = React.useState(false)
      const [msg, setMsg] = React.useState(null)
      const [ups, setUps] = React.useState([])
      const [upPick, setUpPick] = React.useState('')
      const [newUp, setNewUp] = React.useState({ name: '', uid: '' })
      // ── 屏蔽的 UP 主（2026-10-22）──
      const [blockedUps, setBlockedUps] = React.useState([])
      const [blkPick, setBlkPick] = React.useState('')
      const [newBlk, setNewBlk] = React.useState({ name: '', uid: '' })
      const [slots, setSlots] = React.useState([
        { start: '12:00', end: '14:00' },
        { start: '17:00', end: '19:00' },
      ])
      const [who, setWho] = React.useState(null)
      const [qr, setQr] = React.useState(null)
      const [qrMsg, setQrMsg] = React.useState('')
      const pollRef = React.useRef(null)
      const [env, setEnv] = React.useState(null)
      const [envMsg, setEnvMsg] = React.useState('')
      const [installing, setInstalling] = React.useState(false)
      const [sessions, setSessions] = React.useState([])
      const [sessionId, setSessionId] = React.useState('')
      const [asrEnv, setAsrEnv] = React.useState(null)
      const [asrMsg, setAsrMsg] = React.useState('')
      const [asrInstalling, setAsrInstalling] = React.useState(false)
      const [withModel, setWithModel] = React.useState(true)
      const [testMsg, setTestMsg] = React.useState(null)
      const [scheduleOk, setScheduleOk] = React.useState(true)
      const [scheduleHint, setScheduleHint] = React.useState('')
      const [envLines, setEnvLines] = React.useState([])
      const [asrLines, setAsrLines] = React.useState([])
      // ── 更新检查（2026-10-22）──
      const [updateInfo, setUpdateInfo] = React.useState(null)
      const [updateChecking, setUpdateChecking] = React.useState(false)
      // ── 更新执行（2026-10-22）──
      const [updateLines, setUpdateLines] = React.useState([])
      const [updateBusy, setUpdateBusy] = React.useState(false)
      const [updateResult, setUpdateResult] = React.useState(null)
      const updatePollRef = React.useRef(null)
      const envPollRef = React.useRef(null)
      const asrPollRef = React.useRef(null)

      React.useEffect(() => () => {
        if (envPollRef.current) clearInterval(envPollRef.current)
        if (asrPollRef.current) clearInterval(asrPollRef.current)
        if (updatePollRef.current) clearInterval(updatePollRef.current)
      }, [])

      const startPoll = (kind) => {
        const ref = kind === 'env' ? envPollRef : asrPollRef
        const setLines = kind === 'env' ? setEnvLines : setAsrLines
        if (ref.current) clearInterval(ref.current)
        ref.current = setInterval(async () => {
          try {
            const r = await jget(`/${kind}/progress`)
            if (r && r.ok) setLines(r.lines || [])
          } catch {
            /* 拉不到就下次再拉 */
          }
        }, 1500)
      }

      const stopPoll = (kind) => {
        const ref = kind === 'env' ? envPollRef : asrPollRef
        if (ref.current) {
          clearInterval(ref.current)
          ref.current = null
        }
      }

      const loadSessions = () => {
        jget('/sessions').then((r) => {
          if (r && r.ok) {
            setSessions(r.items || [])
            if (r.pinned) setSessionId(r.pinned)
          }
        }).catch(() => {})
      }

      const checkAsr = () => {
        jget('/asr/check').then((r) => setAsrEnv(r)).catch(() => {})
      }

      const installAsr = async () => {
        setAsrInstalling(true)
        setAsrMsg('')
        setAsrLines([])
        startPoll('asr')
        try {
          const r = await jpost('/asr/install', { withModel, model: (cfg && cfg.asrModel) || 'small' })
          if (r && r.ok) {
            setAsrMsg('转写依赖装好了')
            checkAsr()
          } else {
            const tail = (r && r.steps && r.steps.length) ? r.steps[r.steps.length - 1].detail : ''
            setAsrMsg(`装失败了：${(r && r.error) || tail || '未知'}`)
          }
        } catch (e) {
          setAsrMsg(String((e && e.message) || e))
        }
        stopPoll('asr')
        setAsrInstalling(false)
      }

      const doTestRun = async () => {
        setTestMsg({ type: 'info', text: '检查前置条件…' })
        try {
          const r = await jpost('/test-run', {})
          if (r && r.ok) {
            setTestMsg({ type: 'ok', text: `已投递 —— 大约 ${r.delaySeconds || 3} 秒后会在会话里开始跑` })
          } else {
            setTestMsg({ type: 'err', problems: (r && r.problems) || ['未知错误'] })
          }
        } catch (e) {
          setTestMsg({ type: 'err', problems: [String((e && e.message) || e)] })
        }
      }

      const checkEnv = () => {
        jget('/env/check').then((r) => setEnv(r)).catch(() => {})
      }

      const installDeps = async () => {
        setInstalling(true)
        setEnvMsg('')
        setEnvLines([])
        startPoll('env')
        try {
          const r = await jpost('/env/install', {})
          setEnvMsg(r && r.ok ? '主依赖装好了' : `装失败了：${(r && (r.error || r.detail)) || '未知'}`)
          checkEnv()
        } catch (e) {
          setEnvMsg(String((e && e.message) || e))
        }
        stopPoll('env')
        setInstalling(false)
      }

      const refreshWho = () => {
        jget('/whoami').then((r) => setWho(r)).catch(() => {})
      }

      // ── 更新检查（2026-10-22）──
      //   打开设置页时自动查一次；也可以手动点「检查更新」重查。
      //   查不到（网络不通 / GitHub 被墙）就静默，不打扰用户。
      const checkUpdateNow = () => {
        setUpdateChecking(true)
        jget('/update/check')
          .then((r) => setUpdateInfo(r || { ok: false, error: '空响应' }))
          .catch((e) => setUpdateInfo({ ok: false, error: String((e && e.message) || e) }))
          .finally(() => setUpdateChecking(false))
      }

      // 只在第一次挂载时查一次（别每次重渲染都去打 GitHub）
      const updateCheckedRef = React.useRef(false)
      React.useEffect(() => {
        if (updateCheckedRef.current) return
        updateCheckedRef.current = true
        checkUpdateNow()
      }, [])

      // ── 执行更新（点「更新」按钮走这里）──
      //   跑的过程中每 1.5 秒拉一次进度，显示在下面的小框里（跟装依赖同一个形态）。
      const startUpdatePoll = () => {
        if (updatePollRef.current) clearInterval(updatePollRef.current)
        updatePollRef.current = setInterval(async () => {
          try {
            const r = await jget('/update/progress')
            if (r && r.ok) setUpdateLines(r.lines || [])
          } catch {
            /* 拉不到就下次再拉 */
          }
        }, 1500)
      }

      const doUpdate = async () => {
        if (updateBusy) return
        setUpdateBusy(true)
        setUpdateResult(null)
        setUpdateLines([])
        startUpdatePoll()
        try {
          const r = await jpost('/update/apply', {})
          if (r && r.ok) {
            setUpdateResult({
              type: 'ok',
              text: r.restart
                ? '✓ 更新完成 —— 重启 DSH 后生效'
                : '✓ 更新完成',
            })
          } else {
            setUpdateResult({ type: 'err', text: '✗ ' + ((r && r.error) || '更新失败') })
          }
        } catch (e) {
          setUpdateResult({ type: 'err', text: '✗ ' + String((e && e.message) || e) })
        }
        if (updatePollRef.current) {
          clearInterval(updatePollRef.current)
          updatePollRef.current = null
        }
        setUpdateBusy(false)
        checkUpdateNow()
      }

      const startLogin = async () => {
        setQrMsg('生成二维码中…')
        try {
          const r = await jpost('/login/start', {})
          if (!r || !r.ok) {
            setQrMsg((r && r.error) || '生成二维码失败')
            return
          }
          setQr(r.qr || null)
          setQrMsg(r.qr ? '用手机 B站 App 扫码登录' : `二维码画不出来，直接打开这个链接：${r.url}`)
          if (pollRef.current) clearInterval(pollRef.current)
          pollRef.current = setInterval(async () => {
            try {
              const p = await jpost('/login/poll', { key: r.key })
              if (!p || !p.ok) {
                setQrMsg((p && p.error) || '轮询失败')
                return
              }
              if (p.state === 'ok') {
                if (pollRef.current) clearInterval(pollRef.current)
                pollRef.current = null
                setQr(null)
                setQrMsg('登录成功！凭证已写入')
                refreshWho()
              } else if (p.state === 'scanned') {
                setQrMsg('已扫码，请在手机上点「确认」')
              } else if (p.state === 'expired') {
                if (pollRef.current) clearInterval(pollRef.current)
                pollRef.current = null
                setQr(null)
                setQrMsg('二维码过期了，再点一次「扫码登录」')
              }
            } catch {
              /* 单次轮询失败不打断 */
            }
          }, 2000)
        } catch (e) {
          setQrMsg(String((e && e.message) || e))
        }
      }

      React.useEffect(() => () => {
        if (pollRef.current) clearInterval(pollRef.current)
      }, [])

      const DEFAULT_SLOTS = [
        { start: '12:00', end: '14:00' },
        { start: '17:00', end: '19:00' },
        { start: '21:00', end: '23:00' },
        { start: '07:00', end: '09:00' },
        { start: '03:00', end: '05:00' },
        { start: '10:00', end: '12:00' },
      ]

      React.useEffect(() => {
        let alive = true
        refreshWho()
        checkEnv()
        loadSessions()
        checkAsr()
        jget('/config').then((r) => {
          if (!alive) return
          if (r && r.ok) {
            const c = r.config || {}
            setCfg(c)
            setSt(r.state || {})
            setHome(r.home || '')
            setScheduleOk(r.scheduleAvailable !== false)
            setScheduleHint(r.scheduleHint || '')
            setUps(Array.isArray(c.watchedUps) ? c.watchedUps : [])
            setBlockedUps(Array.isArray(c.blockedUps) ? c.blockedUps : [])
            if (Array.isArray(c.slots) && c.slots.length) {
              setSlots(c.slots.map((s) => ({ start: s.start || '12:00', end: s.end || '14:00' })))
            }
          } else {
            setMsg({ type: 'err', text: (r && r.error) || '读配置失败' })
          }
          setLoading(false)
        }).catch((e) => {
          if (!alive) return
          setMsg({ type: 'err', text: String(e && e.message || e) })
          setLoading(false)
        })
        return () => { alive = false }
      }, [])

      const set = (k, v) => setCfg((c) => ({ ...(c || {}), [k]: v }))

      const setSlotCount = (n) => {
        const count = Math.max(1, Math.min(6, Number(n) || 1))
        setSlots((cur) => {
          const next = cur.slice(0, count)
          while (next.length < count) {
            next.push({ ...DEFAULT_SLOTS[next.length % DEFAULT_SLOTS.length] })
          }
          return next
        })
      }

      const setSlotField = (i, key, val) => {
        setSlots((cur) => cur.map((s, j) => (j === i ? { ...s, [key]: val } : s)))
      }

      const save = async () => {
        if (!cfg) return
        setSaving(true)
        setMsg(null)
        try {
          const r = await jpost('/config', {
            autoRun: cfg.autoRun !== false,
            slots: slots.map((s) => ({ start: String(s.start || ''), end: String(s.end || '') })),
            scheduleSessionId: sessionId || '',
            keywords: (cfg.keywords || []).map((s) => String(s).trim()).filter(Boolean),
            minPlay: Number(cfg.minPlay) || 0,
            searchDays: Number(cfg.searchDays) || 0,
            perDay: Number(cfg.perDay) || 0,
            commentPerRound: Number(cfg.commentPerRound) || 0,
            autoComment: !!cfg.autoComment,
            mentionName: String(cfg.mentionName || '').trim(),
            transcribe: !!cfg.transcribe,
            asrModel: String(cfg.asrModel || 'small'),
            personaFile: String(cfg.personaFile || '').trim(),
            watchedUps: ups.map((u) => ({ name: String(u.name || '').trim(), uid: Number(u.uid) || 0 })).filter((u) => u.name),
            blockedUps: blockedUps.map((u) => ({ name: String(u.name || '').trim(), uid: Number(u.uid) || 0 })).filter((u) => u.name || u.uid),
            upCommentPerRound: Number(cfg.upCommentPerRound) || 0,
            upCommentPerDay: Number(cfg.upCommentPerDay) || 0,
            upSinceDays: Number(cfg.upSinceDays) || 3,
          })
          if (!r || !r.ok) {
            setMsg({ type: 'err', text: (r && r.error) || '保存失败' })
            setSaving(false)
            return
          }
          setCfg(r.config || cfg)

          // 保存配置之后，按新的时段重建定时任务
          const a = await jpost('/apply-slots', {})
          if (a && a.ok) {
            setMsg({ type: 'ok', text: `已保存 —— 定时任务按 ${a.created} 个时段重建好了` })
          } else {
            setMsg({ type: 'err', text: `配置存好了，但定时任务重建失败：${(a && a.error) || '未知'}` })
          }
        } catch (e) {
          setMsg({ type: 'err', text: String(e && e.message || e) })
        }
        setSaving(false)
      }

      if (loading) return h('div', { 'data-fbs': '' }, h('div', { 'data-fbs-note': '' }, '读取配置中…'))
      if (!cfg) {
        return h('div', { 'data-fbs': '' },
          h('div', { 'data-fbs-err': '' }, (msg && msg.text) || '读不到配置'))
      }

      const runs = (st && st.runs) || {}
      const today = new Date()
      const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

      return h('div', { 'data-fbs': '' },

        // ── 署名 ──
        h('div', { 'data-fbs-credit': '' },
          '本插件基于 ',
          h('span', { style: { color: '#7ea6e0' } }, 'c1overzz（凌羽clover）'),
          ' 的 dsh-bili-scroll 魔改',
        ),

        // ── 版本信息（一直显示）──
        //   左：最新版本 / 本地版本 两行文字
        //   右：更新按钮 —— 本地 < 最新 时可点，否则灰掉
        (function renderVersion() {
          const info = updateInfo || {}
          const ok = info.ok === true
          const known = ok && info.latest
          const latest = known ? info.latest : (updateChecking ? '检查中…' : '查不到')
          const current = info.current || '—'
          // 只有「查到了最新版」且「本地确实更旧」才允许点
          const canUpdate = known && info.hasUpdate === true
          const failed = updateInfo && !ok

          return h('div', {
            style: {
              margin: '0 0 12px',
              padding: '10px 12px',
              borderRadius: '7px',
              background: 'rgba(255,255,255,.03)',
              border: '1px solid rgba(255,255,255,.08)',
              fontSize: '12px',
              lineHeight: '1.7',
              display: 'flex',
              alignItems: 'center',
              gap: '12px',
            },
          },
            // 左边两行
            h('div', { style: { flex: 1, minWidth: 0 } },
              h('div', {
                style: {
                  color: canUpdate ? '#ffc83c' : 'inherit',
                  fontWeight: canUpdate ? '600' : '400',
                },
              }, `最新版本 ${latest}`),
              h('div', {}, `本地版本 ${current}`),
              failed
                ? h('div', { style: { opacity: '.55', fontSize: '11px' } },
                    `（检查失败：${info.error || '网络不通'}）`)
                : null,
            ),
            // 右边按钮
            h('button', {
              disabled: !canUpdate || updateChecking || updateBusy,
              onClick: () => {
                if (!canUpdate || updateBusy) return
                doUpdate()
              },
              style: {
                flex: '0 0 auto',
                padding: '5px 16px',
                borderRadius: '6px',
                fontSize: '12px',
                cursor: canUpdate && !updateChecking && !updateBusy ? 'pointer' : 'not-allowed',
                border: '1px solid ' + (canUpdate ? 'rgba(126,166,224,.7)' : 'rgba(255,255,255,.12)'),
                background: canUpdate ? 'rgba(126,166,224,.18)' : 'transparent',
                color: canUpdate ? '#7ea6e0' : 'rgba(255,255,255,.3)',
                opacity: updateChecking || updateBusy ? '.5' : '1',
              },
              title: updateBusy
                ? '正在更新…'
                : canUpdate
                  ? '从 GitHub 拉最新版并安装'
                  : '已是最新，无需更新',
            }, updateBusy ? '更新中…' : updateChecking ? '检查中' : '更新'),
            // 重查（小按钮）
            h('button', {
              onClick: () => checkUpdateNow(),
              disabled: updateChecking,
              style: {
                flex: '0 0 auto',
                padding: '5px 10px',
                borderRadius: '6px',
                fontSize: '11px',
                cursor: updateChecking ? 'not-allowed' : 'pointer',
                border: '1px solid rgba(255,255,255,.12)',
                background: 'transparent',
                color: 'inherit',
                opacity: '.6',
              },
              title: '重新检查一次',
            }, '↻'),
          )
        })(),

        // ── 更新执行进度（跟「装依赖」那个小框同一个形态）──
        //   只有真的在跑 / 跑完了才出现，平时不占地方。
        updateLines.length > 0 || updateResult
          ? h('div', {
              style: {
                margin: '0 0 12px',
                padding: '10px 12px',
                borderRadius: '7px',
                background: 'rgba(0,0,0,.25)',
                border: '1px solid rgba(255,255,255,.08)',
                fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
                fontSize: '11px',
                lineHeight: '1.65',
              },
            },
              updateResult
                ? h('div', {
                    style: {
                      color: updateResult.type === 'ok' ? '#7fd47f' : '#ff8a80',
                      marginBottom: '6px',
                      fontWeight: '600',
                    },
                  }, updateResult.text)
                : h('div', { style: { opacity: '.7', marginBottom: '6px' } }, '正在更新…'),
              updateLines.slice(-6).map((ln, i) =>
                h('div', {
                  key: i,
                  style: { opacity: '.75', wordBreak: 'break-all' },
                }, ln)),
            )
          : null,

        // ── 测试跑一轮 ──
        h(Section, { title: '测试', lined: true },
          h('div', { 'data-fbs-row': '' },
            h('div', { 'data-fbs-grow': '' },
              h('div', { 'data-fbs-label': '' }, '现在就跑一轮试试'),
              h('div', { 'data-fbs-note': '' }, '无视时段，按下面的设置跑一次（不占当天额度）。'),
            ),
            h('button', {
              'data-fbs-btn': '', 'data-primary': '',
              onClick: doTestRun,
            }, '测试跑一轮'),
          ),
          testMsg && testMsg.type === 'ok'
            ? h('div', { 'data-fbs-ok': '' }, testMsg.text)
            : null,
          testMsg && testMsg.type === 'info'
            ? h('div', { 'data-fbs-note': '' }, testMsg.text)
            : null,
          testMsg && testMsg.type === 'err'
            ? h('div', { 'data-fbs-err': '', style: { whiteSpace: 'pre-wrap' } },
                (testMsg.problems || []).map((p, i) => h('div', { key: `p-${i}` }, `· ${p}`)))
            : null,
        ),

        // ── 环境 ──
        h(Section, { title: '运行环境', lined: true },
          h('div', { 'data-fbs-row': '' },
            h('div', { 'data-fbs-grow': '' },
              h('div', { 'data-fbs-label': '' },
                env === null ? '检查中…'
                  : env.ok ? '已就绪 · 依赖齐全'
                  : env.python ? 'Python 在，但依赖不全'
                  : '找不到 Python'),
              h('div', { 'data-fbs-note': '' },
                env && env.detail ? env.detail.split('\n')[0] : (env && env.pythonPath) || ''),
            ),
            h('button', {
              'data-fbs-btn': '',
              onClick: () => { checkEnv(); setEnvMsg('') },
            }, '检查环境'),
            h('button', {
              'data-fbs-btn': '', 'data-primary': '',
              disabled: installing,
              onClick: installDeps,
            }, installing ? '装依赖中…' : '装主依赖'),
          ),
          envLines.length ? h('div', { 'data-fbs-log': '' }, envLines.join('\n')) : null,
          envMsg ? h('div', { 'data-fbs-note': '', style: { whiteSpace: 'pre-wrap' } }, envMsg) : null,
          h('div', { 'data-fbs-note': '' }, '换机器或依赖损坏时点「装主依赖」，会走清华镜像把 Python 包装回来。'),
        ),

        // ── 账号 ──
        h(Section, { title: '账号', lined: true },
          h('div', { 'data-fbs-row': '' },
            h('div', { 'data-fbs-grow': '' },
              h('div', { 'data-fbs-label': '' },
                who && who.loggedIn ? `已登录：${who.username}` : '未登录'),
              h('div', { 'data-fbs-note': '' },
                who && who.loggedIn
                  ? `uid ${who.uid} · Lv${who.level} · ${who.message}`
                  : (who && (who.message || who.error)) || '凭证过期后刷不了、也发不了评论'),
            ),
            h('button', {
              'data-fbs-btn': '',
              onClick: startLogin,
            }, qr ? '刷新二维码' : '扫码登录'),
          ),
          qr ? h('div', { style: { textAlign: 'center', padding: '6px 0' } },
            h('img', {
              src: qr, width: 180, height: 180,
              alt: 'B站 登录二维码',
              style: { borderRadius: '10px', background: '#fff', padding: '10px', display: 'inline-block' },
            }),
          ) : null,
          qrMsg ? h('div', { 'data-fbs-note': '', style: { textAlign: 'center' } }, qrMsg) : null,
        ),

        // ── 会话 ──
        h(Section, { title: '会话', lined: true },
          h('div', { 'data-fbs-row': '' },
            h('div', { 'data-fbs-grow': '' },
              h('div', { 'data-fbs-label': '' }, '跑在哪个会话'),
              h('div', { 'data-fbs-note': '' },
                sessions.length ? '不选就自动用最近活跃的那个' : '还没有会话 —— 先去聊天页发一句话'),
            ),
            h('select', {
              'data-fbs-input': '',
              value: sessionId,
              onChange: (e) => setSessionId(e.target.value),
              style: { maxWidth: '260px' },
            },
              h('option', { value: '' },
                sessions.length ? '自动（最近活跃）' : '（没有会话）'),
              ...sessions.map((s) => h('option', { key: s.id, value: s.id }, s.label)),
            ),
          ),
        ),

        // ── 总开关 ──
        h(Section, { title: '自动刷' },
          // 没装定时任务功能时，把话说清楚，别让人白填
          !scheduleOk
            ? h('div', {
                'data-fbs-err': '',
                style: {
                  whiteSpace: 'pre-wrap', lineHeight: '1.6',
                  background: 'rgba(229,72,77,.10)', borderRadius: '8px', padding: '8px 10px',
                },
              }, '⚠ 自动刷用不了：这个 DSH 环境没装定时任务功能。\n' + (scheduleHint || ''))
            : null,

          // 开关 + 展开内容，全包在竖线里
          h('div', { 'data-fbs-sub': '' },
            h(Toggle, {
              label: '自动刷B站',
              note: scheduleOk
                ? (cfg.autoRun === false
                    ? '已关闭 —— 定时任务到点会直接跳过，不搜也不发'
                    : `每天自动跑 ${slots.length} 轮（关掉就暂停，定时任务本身还在）`)
                : '需要定时任务功能才能用（见上面的说明）',
              value: cfg.autoRun !== false && scheduleOk,
              onChange: scheduleOk ? (v) => set('autoRun', v) : () => {},
            }),

            // 开关打开时才展开时段设置
            cfg.autoRun !== false && scheduleOk
              ? h('div', { style: { display: 'contents' } },
                  h('div', { 'data-fbs-row': '' },
                    h('div', { 'data-fbs-grow': '' },
                      h('div', { 'data-fbs-label': '' }, '一天刷几次'),
                      h('div', { 'data-fbs-note': '' }, '1–6 次。改成几次下面就出现几行时段。'),
                    ),
                    h('input', {
                      'data-fbs-num': '', type: 'number', min: 1, max: 6,
                      value: slots.length,
                      onChange: (e) => setSlotCount(e.target.value),
                    }),
                  ),
                  ...slots.map((s2, i2) => h('div', { 'data-fbs-row': '', key: `slot-${i2}` },
                    h('span', { 'data-fbs-note': '', style: { width: '52px', flex: 'none' } }, `第 ${i2 + 1} 轮`),
                    h('input', {
                      'data-fbs-time': '', type: 'time', value: s2.start,
                      onChange: (e) => setSlotField(i2, 'start', e.target.value),
                    }),
                    h('span', { 'data-fbs-note': '' }, '→'),
                    h('input', {
                      'data-fbs-time': '', type: 'time', value: s2.end,
                      onChange: (e) => setSlotField(i2, 'end', e.target.value),
                    }),
                    h('span', { 'data-fbs-note': '', style: { marginLeft: '6px' } }, '结束'),
                  )),
                  h('div', { 'data-fbs-note': '' }, '保存时会按这些时段重建定时任务（旧的「刷B站」任务会被替换）。'),
                )
              : null,

            // 今天的状态（始终在竖线里）
            h('div', { 'data-fbs-row': '', style: { flexWrap: 'wrap', marginTop: '4px' } },
              ...slots.map((s2, i2) => {
                const done = !!runs[`${ymd}:r${i2 + 1}`]
                return h('span', {
                  'data-fbs-badge': '',
                  key: `run-${i2}`,
                  title: `${s2.start}–${s2.end}`,
                }, `第${i2 + 1}轮 ${done ? '已跑' : '未跑'}`)
              }),
              h('span', { 'data-fbs-note': '' },
                `挑过 ${(st && st.picked) || 0} 条 · UP 主评论 ${(st && st.upComments) || 0} 条`),
            ),
            h('div', { 'data-fbs-note': '' }, `配置文件：${home}\\config.json`),
          ),
        ),

        // ── 挑片规则（含搜索关键词）──
        h(Section, { title: '挑片规则', lined: true },
          h('div', { 'data-fbs-h2': '' }, '搜索关键词'),
          h('div', { 'data-fbs-note': '' }, '每行一个。每轮会把这些词全部搜一遍（派子代理去刷）。'),
          h('textarea', {
            'data-fbs-ta': '',
            value: (cfg.keywords || []).join('\n'),
            onChange: (e) => set('keywords', e.target.value.split('\n')),
          }),

          h(NumField, {
            label: '播放量门槛（关键词搜索）',
            note: '低于这个数的视频直接不看。UP 主新视频不受此限。0 = 不限',
            value: cfg.minPlay, min: 0,
            onChange: (v) => set('minPlay', v),
          }),
          h(NumField, {
            label: '查最近几天',
            note: '关键词轮只看最近几天发的视频。0 = 不限',
            value: cfg.searchDays ?? 3, min: 0, max: 30,
            onChange: (v) => set('searchDays', v),
          }),
          h(NumField, {
            label: '每轮挑几个并 @ 你',
            note: '关键词轮每轮挑几条，每条单独发一条评论 @ 你',
            value: cfg.commentPerRound, min: 0, max: 20,
            onChange: (v) => set('commentPerRound', v),
          }),
          h(NumField, {
            label: '每天最多几条',
            note: '两轮加起来的上限',
            value: cfg.perDay, min: 0, max: 60,
            onChange: (v) => set('perDay', v),
          }),
        ),

        // ── 特别关注的 UP 主 ──
        h(Section, { title: '特别关注的 UP 主', lined: true },
          h('div', { 'data-fbs-note': '' }, '他们发新视频会单独检查并 @ 你。这条路不加播放量门槛，也不用子代理。'),
          h('div', { 'data-fbs-row': '', style: { flexWrap: 'wrap' } },
            h(NumField, {
              label: '每轮最多几条',
              value: cfg.upCommentPerRound, min: 0, max: 10,
              onChange: (v) => set('upCommentPerRound', v),
            }),
            h(NumField, {
              label: '每天最多几条',
              value: cfg.upCommentPerDay, min: 0, max: 30,
              onChange: (v) => set('upCommentPerDay', v),
            }),
            h(NumField, {
              label: '查最近几天',
              note: '往前翻几天找他们的新视频',
              value: cfg.upSinceDays ?? 3, min: 1, max: 30,
              onChange: (v) => set('upSinceDays', v),
            }),
          ),
          // 已关注的 UP 主：下拉选一个 + 删除
          h('div', { 'data-fbs-row': '' },
            h('div', { 'data-fbs-grow': '' },
              h('div', { 'data-fbs-label': '' }, '已关注的 UP 主'),
              h('div', { 'data-fbs-note': '' },
                ups.length ? `共 ${ups.length} 个 —— 选一个点删除` : '还没有，下面添加'),
            ),
            h('select', {
              'data-fbs-input': '',
              value: upPick,
              onChange: (e) => setUpPick(e.target.value),
              style: { maxWidth: '200px' },
              disabled: !ups.length,
            },
              h('option', { value: '' }, ups.length ? '（选一个）' : '（空）'),
              ...ups.map((u, i) => h('option', { key: `pick-${i}`, value: String(i) },
                `${u.name}${u.uid ? ` · ${u.uid}` : ''}`)),
            ),
            h('button', {
              'data-fbs-btn': '', 'data-danger': '',
              disabled: !ups.length || upPick === '',
              onClick: () => {
                const i = Number(upPick)
                if (Number.isInteger(i) && i >= 0 && i < ups.length) {
                  setUps(ups.filter((_, j) => j !== i))
                  setUpPick('')
                }
              },
            }, '删除'),
          ),
          h('div', { 'data-fbs-row': '' },
            h('input', {
              'data-fbs-input': '', type: 'text', placeholder: 'UP 主昵称',
              value: newUp.name,
              onChange: (e) => setNewUp({ ...newUp, name: e.target.value }),
            }),
            h('input', {
              'data-fbs-num': '', type: 'text', placeholder: 'uid（可留空）',
              value: newUp.uid,
              onChange: (e) => setNewUp({ ...newUp, uid: e.target.value }),
              style: { width: '130px' },
            }),
            h('button', {
              'data-fbs-btn': '',
              onClick: () => {
                const name = newUp.name.trim()
                if (!name) return
                setUps([...ups, { name, uid: Number(newUp.uid) || 0 }])
                setNewUp({ name: '', uid: '' })
              },
            }, '添加'),
          ),
          h('div', { 'data-fbs-note': '' }, 'uid 留 0 也行：开跑时会按昵称自动查一次并写回。'),
        ),

        // ── 屏蔽的 UP 主（2026-10-22 加）──
        h(Section, { title: '屏蔽的 UP 主', lined: true },
          h('div', { 'data-fbs-note': '' },
            '这些人做的视频，搜到了也直接跳过 —— 不读字幕、不写报告、不发评论。'),
          h('div', { 'data-fbs-row': '' },
            h('div', { 'data-fbs-grow': '' },
              h('div', { 'data-fbs-label': '' }, '已屏蔽的 UP 主'),
              h('div', { 'data-fbs-note': '' },
                blockedUps.length ? `共 ${blockedUps.length} 个 —— 选一个点删除` : '还没有，下面添加'),
            ),
            h('select', {
              'data-fbs-input': '',
              value: blkPick,
              onChange: (e) => setBlkPick(e.target.value),
              style: { maxWidth: '200px' },
              disabled: !blockedUps.length,
            },
              h('option', { value: '' }, blockedUps.length ? '（选一个）' : '（空）'),
              ...blockedUps.map((u, i) => h('option', { key: `blk-${i}`, value: String(i) },
                `${u.name || '(无名)'}${u.uid ? ` · ${u.uid}` : ''}`)),
            ),
            h('button', {
              'data-fbs-btn': '', 'data-danger': '',
              disabled: !blockedUps.length || blkPick === '',
              onClick: () => {
                const i = Number(blkPick)
                if (Number.isInteger(i) && i >= 0 && i < blockedUps.length) {
                  setBlockedUps(blockedUps.filter((_, j) => j !== i))
                  setBlkPick('')
                }
              },
            }, '删除'),
          ),
          h('div', { 'data-fbs-row': '' },
            h('input', {
              'data-fbs-input': '', type: 'text', placeholder: 'UP 主昵称',
              value: newBlk.name,
              onChange: (e) => setNewBlk({ ...newBlk, name: e.target.value }),
            }),
            h('input', {
              'data-fbs-num': '', type: 'text', placeholder: 'uid（可留空）',
              value: newBlk.uid,
              onChange: (e) => setNewBlk({ ...newBlk, uid: e.target.value }),
              style: { width: '130px' },
            }),
            h('button', {
              'data-fbs-btn': '',
              disabled: !newBlk.name.trim() && !newBlk.uid.trim(),
              onClick: () => {
                const name = newBlk.name.trim()
                const uid = Number(newBlk.uid) || 0
                if (!name && !uid) return
                setBlockedUps([...blockedUps, { name, uid }])
                setNewBlk({ name: '', uid: '' })
              },
            }, '添加'),
          ),
          h('div', { 'data-fbs-note': '' },
            '填了 uid 就按 uid 比（最准，不怕改名）；没填 uid 才按昵称比。'),
        ),

        // ── 评论 ──
        h(Section, { title: '发评论', lined: true },
          h(Toggle, {
            label: '自动评论并 @ 我',
            note: '关掉就只写日报，不在评论区说话',
            value: !!cfg.autoComment,
            onChange: (v) => set('autoComment', v),
          }),
          h(TextField, {
            label: '要 @ 谁',
            note: '纯文本 @，填你在 B站的昵称',
            value: cfg.mentionName,
            placeholder: '例如：你的B站昵称',
            onChange: (v) => set('mentionName', v),
          }),
        ),

        // ── 特别关注的 UP ──
        // ── 人设 ──
        h(Section, { title: '人设 / 说话风格', lined: true },
          h('div', { 'data-fbs-note': '' },
            '填一个 AGENTS.md（或任意 .md）的完整路径，刷B站那轮就按里面的设定来写评论。'),
          h('input', {
            'data-fbs-input': '', type: 'text',
            value: cfg.personaFile || '',
            placeholder: '留空 = 用当前会话自己的设定',
            onChange: (e) => set('personaFile', e.target.value),
          }),
          h('div', { 'data-fbs-note': '' },
            cfg.personaFile
              ? `每轮会读：${cfg.personaFile}`
              : '没填 —— 评论语气跟着你当前会话的人格走'),
        ),

        // ── 其他 ──
        h(Section, { title: '其他 · 本地转写' },
          // 开关 + 展开内容，全包在竖线里
          h('div', { 'data-fbs-sub': '' },
            h(Toggle, {
              label: '没字幕时用本地转写',
              note: '视频没字幕时在本地跑语音识别；要装转写环境才有用',
              value: !!cfg.transcribe,
              onChange: (v) => set('transcribe', v),
            }),

          cfg.transcribe
            ? h('div', { style: { display: 'contents' } },
                h('div', { 'data-fbs-row': '' },
                  h('div', { 'data-fbs-grow': '' },
                    h('div', { 'data-fbs-label': '' },
                      asrEnv === null ? '转写环境：检查中…'
                        : asrEnv.ok ? '转写环境：已就绪'
                        : asrEnv.python ? '转写环境：Python 在，但包装不全'
                        : '转写环境：未安装'),
                    h('div', { 'data-fbs-note': '' },
                      asrEnv && asrEnv.pythonPath ? asrEnv.pythonPath : ''),
                  ),
                  h('button', {
                    'data-fbs-btn': '', 'data-primary': '',
                    disabled: asrInstalling,
                    onClick: installAsr,
                  }, asrInstalling ? '装转写依赖中…' : '装转写依赖'),
                ),

                // 模型大小
                h('div', { 'data-fbs-row': '' },
                  h('div', { 'data-fbs-grow': '' },
                    h('div', { 'data-fbs-label': '' }, '模型大小'),
                    h('div', { 'data-fbs-note': '' },
                      'tiny 75MB 快但糙 · base 150MB 够用 · small 500MB 平衡 · medium 1.5GB 准但慢'),
                  ),
                  h('select', {
                    'data-fbs-input': '',
                    value: cfg.asrModel || 'small',
                    onChange: (e) => set('asrModel', e.target.value),
                    style: { maxWidth: '140px' },
                  },
                    h('option', { value: 'tiny' }, 'tiny'),
                    h('option', { value: 'base' }, 'base'),
                    h('option', { value: 'small' }, 'small'),
                    h('option', { value: 'medium' }, 'medium'),
                  ),
                ),

                // 顺便下模型
                h('div', { 'data-fbs-row': '' },
                  h('input', {
                    type: 'checkbox',
                    checked: withModel,
                    onChange: (e) => setWithModel(e.target.checked),
                    style: { margin: 0 },
                  }),
                  h('div', { 'data-fbs-grow': '' },
                    h('div', { 'data-fbs-label': '' }, '装依赖时顺便把模型也下好'),
                    h('div', { 'data-fbs-note': '' },
                      '勾上：装完就能直接用（多等几分钟）；不勾：第一次真转写时才下，会再等一会儿'),
                  ),
                ),

                asrLines.length ? h('div', { 'data-fbs-log': '' }, asrLines.join('\n')) : null,
                asrMsg ? h('div', { 'data-fbs-note': '', style: { whiteSpace: 'pre-wrap' } }, asrMsg) : null,
              )
            : null,
          ),
        ),

        // ── 保存 ──
        h('div', { 'data-fbs-row': '' },
          h('button', {
            'data-fbs-btn': '', 'data-primary': '',
            disabled: saving,
            onClick: save,
          }, saving ? '保存中…' : '保存'),
          msg ? h('span', { [msg.type === 'ok' ? 'data-fbs-ok' : 'data-fbs-err']: '' }, msg.text) : null,
        ),
      )
    }

    return {
      inject: ['slots'],
      apply(ctx) {
        try {
          const style = document.createElement('style')
          style.setAttribute('data-plugin-css', 'feiyu-bili-settings')
          style.textContent = CSS
          document.head.appendChild(style)
          ctx.effect(() => () => style.remove(), 'feiyu-bili-settings: 样式')
        } catch {
          /* 样式失败不影响功能 */
        }

        try {
          const slots = (typeof ctx.get === 'function' ? ctx.get('slots') : undefined) || ctx.slots
          if (!slots) return
          slots.inject('settings.section', () => slots.register(
            { name: 'settings.section', id: 'bili-duty', order: 26, label: '刷B站' },
            () => h(Panel),
          ))
        } catch {
          /* 注册失败只是这页不出现 */
        }
      },
    }
  },
})
