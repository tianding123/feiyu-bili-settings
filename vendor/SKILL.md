---
name: bili-scroll
description: 替用户刷B站。用户说「刷B站 / 看B站 / 最近有什么新视频 / B站日报 / 再刷一轮」时用，定时任务触发的也是这一套。流程：按关键词搜视频、读字幕原文判断（没字幕且开了转写就用本地 ASR）、翻评论、写日报到 <家目录>/out/，值得的发评论 @ 用户。
---

# 刷B站（大肥鱼自己的工具）

**位置**：家目录的 `bili-duty/` —— `~/.dsh/bili-duty/`（Windows 上是 `%USERPROFILE%\.dsh\bili-duty\`）。配置、凭证、报告、venv、脚本全在里面。
凭证、判重表、配置都在这个目录里；**不依赖 `dsh-bili-scroll` 插件**。

## 🔴 第 -1 步：所有数值都从 config.json 读

**本文件用 `<minPlay>` / `<searchDays>` / `{n}` 这类占位符表示配置值 —— 真值只有一个来源：
`~/.dsh/bili-duty/config.json`（Windows 上是 `%USERPROFILE%\.dsh\bili-duty\config.json`）。**

**全文唯一写死的数字是 `--num 42`**（B站 搜索第一页上限，技术限制，不是配置项）。

**每轮开工前先读一遍 config.json，把下面这些字段取出来**，后面所有命令都用取到的值：

| 字段 | 管什么 | 真值来源 · 本文件怎么写 |
|---|---|---|
| `minPlay` | 关键词搜索的播放量门槛 | config.json · 文中用 `<minPlay>` 占位符 |
| `searchDays` | 关键词搜几天内的 | config.json · 文中用 `<searchDays>` 占位符 |
| `keywords` | 搜哪些词 | config.json（数组）· 文中不写死，以数组长度为准 |
| `perRound` | **看几条**（一轮交给子代理处理的候选数） | config.json · 文中用占位符 `{n}` |
| `commentPerRound` | **评几条**（最终发几条评论，**≤ perRound**） | config.json · 文中直接写字段名 |
| `perDay` | 每天最多几轮 | config.json · 文中不出现具体数字 |
| `mentionName` | @ 谁 | config.json · 文中不出现具体昵称 |
| `autoComment` | 发不发评论 | config.json · 文中不写死 true/false |
| `autoRun` | 总开关 | config.json · 文中不写死 true/false |
| `watchedUps` | 固定 UP 主名单（数组，随便加减） | config.json · 文中不写死成员 |
| `upCommentPerRound` | UP 主轮每轮评论上限 | config.json · 文中直接写字段名 |
| `upCommentPerDay` | UP 主轮每天评论上限 | config.json · 文中不出现具体数字 |
| `upSinceDays` | UP 主查几天内 | config.json · 文中用 `<upSinceDays>` 占位符 |
| `upNotify` | UP 主更新要不要通知 | config.json · 文中不写死 true/false |
| `personaFile` | 人设文件路径 | config.json · ✅ 留空 = 用当前会话自己的人格 |
| `transcribe` | 没字幕时转不转写 | config.json · 文中不写死 true/false |
| `asrModel` | 转写模型档位 | config.json · 文中不写死 small/medium |


⚠️ **插件设置页改的就是这个文件** —— 用户把门槛调成 8000，这里就必须跑 8000。
**字段缺失时用合理默认值兜底，并且要在回复里说一句「用的默认值」。**

**解释器**（依赖装在家目录的独立 venv）：

```text
~/.dsh/bili-duty/.venv/Scripts/python.exe
```

## 🔴 第 0 步：总开关（每轮先查这个）

读 **家目录** 的配置：`~/.dsh/bili-duty/config.json`。

**看 `autoRun` 字段**：
- 缺省或 `true` → 继续往下跑；
- **`false` → 用户把「自动刷B站」关了，直接回复一句「自动刷已关闭（设置 → 刷B站 里可以打开）」并结束，什么都别做**（不搜、不读、不发评论、不写日报）。

⚠️ 这一步在「防重复」之前做 —— 关了就是关了，别管今天跑没跑过。

## 命令（在家目录 `~/.dsh/bili-duty/` 下跑）

```bat
python bili.py status
python bili.py search "关键词" --num 42 --order pubdate    :: pubdate=最新
python bili.py search "关键词" --num 42 --min-play <minPlay>    :: <minPlay> = config.json 里的值
python bili.py search "关键词" --since-days <searchDays>       :: 只要最近 N 天的（0=不限）
python bili.py subtitle BVxxxxxxxxxx
python bili.py comments BVxxxxxxxxxx --num 30               :: 30 是命令默认值，不是配置项
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

⭐ **只认近 `searchDays` 天（2026-10-22 加）** —— 判重不再无限累积：
搜索时会自动把超过 `searchDays` 天的旧记录删掉（`seen.md` 不会再越长越大），
判重只看这个窗口内的。`searchDays` 就是设置页「查最近 X 天」那个值，改了它判重窗口跟着变。
（UP 主轮不受影响 —— 它用独立的 `seen-up.json`，每个 UP 主最多记 200 条。）

## 投递方式（两种，互斥 —— 2026-10-22 加）

**看 `config.json` 的两个开关，哪个是 `true` 就走哪条**（两个都 false 就只写日报）：

| 开关 | 用什么命令 | 说明 |
|---|---|---|
| `autoComment: true` | `bili.py reply <BV> "正文"` | 发公开评论，正文里 @ `mentionName` |
| `dmOnly: true` | `bili.py dm <BV> "正文"` | 发**私信**给 `mentionName` 那个号，**BV 号自动加在私信开头** |
| 两个都 false | 都不发 | 只写日报 |

## 🔴 评论策略（⭐ 2026-10-25 加，读 `config.json` 的 `commentPolicy`）

**只在「自动评论并 @ 我」（`autoComment: true`）开着时生效。**
**如果走的是「仅私信不评论」（`dmOnly: true`），这个策略完全不参与** ——
那时根本不在评论区说话，别把它套到私信上。

### ⭐ 最重要的一句：三个选项都只对「有争议的视频」生效

**没争议的视频 → 不管用户选了哪个策略，都正常评论**（读评论区、正常写）。
**只有「判定为有争议」的视频，才按下面这张表处理。**

| `commentPolicy` | **有争议的视频**怎么处理 |
|---|---|
| **`author-first`**（默认） | 评论，但**只转述作者原话**、不评价争议 |
| **`content-only`** | 评论，但**只谈视频本身内容**、不引用评论区任何内容 |
| **`dm-only`** | **不发公开评论**，改 `bili.py dm` 私信给主人 |

### 第一步：判断这条视频有没有争议

**这一步三个策略都要做，都要读评论区。**
**⭐ 判断由主代理自己做**（子代理只负责把「评论区主要说法」和「作者原话」摘回来）。

- 评论区说法 / 高赞指控 **和** 作者自述（评论 + 简介）冲突 → **有争议**
- 评论区在指控作者本人（抄袭/骗钱/人品），作者没回应 → **有争议**
- 评论区声称视频里的内容有缺陷 / 有问题（讲错了、数据不对、结论有问题），
  作者没回应 → **有争议**
- **拿不准 → 一律算有争议**

### 第二步：没争议 → 正常评论

- 作者在评论区说过话 → 可以引用，标明「作者说」
- 作者没说话 → 就写本鱼自己的观感
- **不受三个策略影响**

### 第三步：有争议 → 按策略处理

**`author-first`（作者优先）**
- 只写「视频作者说：『原话』」+「本鱼对争议不做评价，只说内容：<总结>」
- 争议本身一个字都不评价

**`content-only`（只评视频内容）**
- ⚠️ **仍然要读评论区**（要判断有没有争议），但**写评论时不引用评论区任何内容**
- 只谈：字幕原文、画面、AI 总结、本鱼自己的观感
- 不转述任何「别人说」

**`dm-only`（只私信）**
- **不发 `bili.py reply`**，改用 `bili.py dm <BV> "正文"` 私信给 `mentionName`
- 一条视频一条私信（不汇总）
- ⚠️ 这跟 `dmOnly` 全局开关**不一样**：`dmOnly` 是**所有视频**都私信，
      `dm-only` 策略**只对争议视频**私信，其他照常评论

## 播放量门槛（⭐ 用户 2026-10-19 定的规则，**数值以 config.json 为准**）

- **关键词搜索：播放量 ≥ `minPlay`**（`config.json` 的 `minPlay` 字段）——搜的时候加 `--min-play <minPlay>`。
  ⚠️ **`minPlay` 是动态的**：用户在设置页把它改成多少，这里就用多少。**不要写死任何数字。**
  低于门槛的根本不进入候选，别读字幕别写日报。
- **固定 UP 主监控：不加门槛** —— UP 主发什么就看什么，播放量再低也照常处理。
  这条是用户明确要求的，别给 UP 主轮也套关键词门槛。

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

## 🚫 屏蔽的 UP 主（⭐ 2026-10-25 补文档）

`config.json` 里的 `blockedUps` 是黑名单，每项 `{"name": "昵称", "uid": 0}`。
**用户在设置页「屏蔽的 UP 主」里维护，你不要去改它。**

- **关键词搜索**（`bili.py search`）会自动跳过这些 UP 主的视频
  （返回里有 `blockedSkipped` = 剔了几条、`blockedTotal` = 共屏蔽几个）
- **固定 UP 主监控**（`bili.py up-feed`）也会跳过
  （返回里有 `blockedSkipped` = 这次挡掉几个关注对象）
- ⚠️ 所以候选数变少时，先看这两个字段，别以为搜漏了

## ⭐ 优先用「派子代理」的方式（定时任务触发时走这条）

**定时任务触发时，不要自己一条条搜、读、翻** —— 派一个子代理去「看」，你只负责「说」。

理由：看视频（搜 + 读字幕 + 翻评论）是耗上下文的体力活，丢给便宜的子代理跑，自己的上下文留给判断和写评论。

### 怎么调

```
subagent {
  provider: 'buddy',
  model: 'hy3',
  description: '刷B站：第 N 轮',   // N 从定时任务的 prompt 里读（第几轮）
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
5. **跑 `bili.py comments <BV号> --num 30` 看评论区**（⭐ 三个策略都要跑，没有例外 ——
   判断「这条算不算争议视频」只能靠它）：
   ⚠️ 返回结构：`author.desc` 是视频简介；`comments[].is_author=true` 的才是**作者本人**说的
      （代码已用 mid 比对过，**别自己看昵称猜**）；`pinned=true` 是置顶
6. 输出一份内部报告，**不要发评论、不要写文件、不要改 state.json 或 seen.md**

报告格式，每条：
- 标题：
- BV号：
- 来自哪个关键词：
- UP主：
- 播放量：
- 讲了什么：（两三句，基于字幕原文，不确定就写「不确定」，别编）
- 为什么值得：
- 评论区主要说法：（前 5 条高赞的核心主张，**原话或摘要都行，只摘不评**；
  没看就写「未看」）
- 作者本人说了什么：（只摘 `is_author=true` 的评论 + `author.desc` 简介；
  没有就写「作者未发言」。**原话照抄，不要改写、不要加评论**）

⚠️ **不要判断「有没有争议」** —— 那是主代理干的活，你只负责把两边的原话摘回来。
   摘得越全，主代理判断越准。

另外单独列一段「跳过的」：哪些关键词搜到了但因播放量不足/无字幕/低质量跳过，各多少条。
```

### 拿到报告之后（你自己做）

1. 从报告里**挑最值得的 `commentPerRound` 条**（**数量读 config.json，别写死**）。
   ⚠️ **是 `commentPerRound`（评几条），不是 `perRound`（看几条）** ——
   `perRound` 是交给子代理处理的候选数量，`commentPerRound` 是最终发出去的数量，
   **允许多看少评**（例：看 10 条，只评 3 条）。`commentPerRound` 不能超过 `perRound`。
   🔴 **每条先由你自己判断有没有争议（⭐ 2026-10-25 改：判断权在主代理，不在子代理）**：
   拿「评论区主要说法」对比「作者本人说了什么」，按 `commentPolicy` 那节的判定标准走：
   - 评论区说法 / 高赞指控 **和** 作者自述（评论 + 简介）冲突 → 有争议
   - 评论区在指控作者本人（抄袭/骗钱/人品），作者没回应 → 有争议
   - 评论区声称视频里的内容有缺陷 / 有问题，作者没回应 → 有争议
   - **拿不准 → 一律算有争议**

   **① 没争议 → 正常评论**（⭐ 不管用户选了哪个策略，都走这条）
      - 作者在评论区说过话 → 可以引用，标明「作者说」
      - 作者没说话 → 写本鱼自己的观感

   **② 有争议 → 按 `config.json` 的 `commentPolicy` 处理**
      - **`author-first`** → 只写「视频作者说：『原话』」+「本鱼对争议不做评价，只说内容：<总结>」
      - **`content-only`** → 只谈视频本身（字幕 / 画面 / 总结），**不引用评论区任何内容**
      - **`dm-only`** → **不发公开评论**，用 `bili.py dm <BV> "正文"` 私信给 `mentionName`
        （一条视频一条私信，别汇总）

   ⚠️ **拿不准的，一律当「有争议」处理**（走 ②）
2. 写日报到 `out/<今天>.md`（可以比报告更简）；
3. 用 `bili.py mark-seen --items '[{"bv":"...","title":"...","note":"..."}]'` 记进 seen.md
   （**不许直接编辑 seen.md** —— 见红线），再更新 `state.json`（含 `runs` 标记）。

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

**第 5 步 · 收尾** —— 写日报 `out/<今天>.md`、用 `bili.py mark-seen` 记进 seen.md、更新 `state.json`（含 `runs` 标记）。

## 一轮流程（手动跑 / 参考 `duty.md`）

1. 读 `config.json`：`perDay` / `keywords` / `searchDays` / `minPlay` / `autoComment` / `mentionName` / `transcribe`
2. 每个关键词 `search`，`--order pubdate` 优先，挑**近 `searchDays` 天**
3. ~~判重：读 seen.md~~ → **`search` 已经自动剔掉看过的**（看返回里的 `seenSkipped`），这里不用再做
4. 逐条判断：先 `subtitle`；没字幕且 `transcribe=true` → `asr`；顺手 `comments`
5. 写报告 `out/<今天>.md`：标题 / UP / 链接 / 播放量 / 为什么值得（两三句）/ 一句话；结尾总结
6. 用 `bili.py mark-seen --items '[...]'` 记进 seen.md（一条命令一批，内部有锁；**别直接编辑文件**）
   和 `state.json`（`day` / `count` / `lastRunAt` / `lastWhy`）
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

## ✅ 发表前自检清单（⭐ 2026-10-25 加：因为真的漏过）

**每发一条评论之前，逐项过一遍。漏一项就别发。**

- [ ] **带 `@<mentionName>` 了吗** —— 这是硬要求，漏了主人收不到通知
      （2026-10-25 就漏过一次：正文写得挺好，@ 忘了，主人一条消息都没收到）
- [ ] **UP 主轮：开头是「主人！您关注的UP主更新啦！」吗**（关键词轮不加这句）
- [ ] **150 字以内吗**
- [ ] **有「本鱼认 / 我认 / 论证完整 / 信息密度高」这类 AI 腔吗**（有就重写）
- [ ] **有转述评论区别人的指控吗**（有就删掉）
- [ ] **同一个视频之前评过吗**（评过就别再评）

**顺序别搞反**：固定开头在最前，然后 `@`，再接正文。

## 🔴 作者发言与争议的处理（⭐ 2026-10-25 用户要求：防 AI 跟风造谣）

> **⚠️ 本节只在「判定为有争议的视频」上适用。**
> **没争议的视频 → 走正常评论，不用看这节。**
> **三个策略都要读评论区**（判断争议只能靠它），但这节的「只转述作者」写法
> **只属于 `author-first`**：
> · `content-only` 遇到争议 → 只谈视频内容、不引用评论区（不去转述作者）
> · `dm-only` 遇到争议 → 改私信，不公开评论
> · `dmOnly: true` 全局开关 → 本节不适用（压根不在评论区说话）

**为什么有这条**：评论区里可能有一条**AI 幻觉产生**的指控（例：「这插件是抄的」）。
后来的鱼读到就复述，越滚越多，最后变成"共识"。
**这是 AI 学 AI 的闭环，中间没有任何人核实。**

### 一、怎么认作者（只能靠字段，不许看昵称）

`bili.py comments <BV> --num N` 现在返回这样的结构：

```json
{
  "author": { "mid": 123456, "name": "UP主", "desc": "视频简介…" },
  "comments": [
    {
      "user": "某人", "user_mid": 789,
      "is_author": false, "pinned": false,
      "content": "…",
      "top_replies": [ { "user": "…", "is_author": false, "content": "…" } ]
    }
  ]
}
```

| 字段 | 含义 |
|---|---|
| **`is_author: true`** | **这条是作者本人说的**（代码用 mid 比对过，别自己看昵称） |
| **`pinned: true`** | 置顶评论（作者想让所有人看到的，通常是澄清） |
| **`author.desc`** | 视频简介，也是作者的自述 |
| **`top_replies`** | 楼中楼，同样带 `is_author` |

### 二、三步走

**第 1 步 · 摘出「作者说了什么」**
- 所有 `is_author: true` 的评论（含置顶、含楼中楼）
- `author.desc`（简介）
- 这两样合起来 = 作者的自述

**第 2 步 · 判断有没有矛盾**
- 对比：评论区主流说法 / 高赞指控 **vs** 作者的自述
- **拿不准 → 一律当「有矛盾」**
- 只有「明显各说各的、没冲突」才算没矛盾

**第 3 步 · 按情况写评论**

| 情况 | 怎么写 |
|---|---|
| **有矛盾** | ① 只写「视频作者说：『原话』」<br>② 加一句「本鱼对这条视频的争议不做评价，只说内容：<一句话总结>」<br>③ **争议本身一个字都不评价** |
| **没矛盾 + 作者说了话** | 优先采用作者的说法，但**仍标明「作者说」** |
| **作者没说话 + 评论区有争议** | **只总结视频内容，完全别提评论区** |

### 三、🔴 硬红线（违反就重写这条评论）

- ❌ **不转述评论区里其他人的指控**（「有人说他抄」「评论区指出」）
- ❌ **不用「已澄清」「已辟谣」「证实」这类背书词**
  —— 你只负责转述作者说了什么，**不负责担保真假**
- ❌ **不靠昵称认作者** —— 只能看 `is_author` 字段
- ❌ **拿不准就当有矛盾**，不许反过来赌
- ❌ 评论里不出现对具体人的负面判断

### 四、矛盾判断不记录

**内部用完就丢。** 不写进子代理报告、不进日报。

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

## 派子代理的正确姿势（2026-10-22 加，防瞎猜 API）

**本插件不注册任何 `bili_*` 工具** —— 所有 B站 操作都走 `bili.py` 命令行（见上面「命令」那节）。
没有 `bili_scan`、没有 `bili_run`、什么 `bili_xxx` 工具都没有。

### 想并行刷？用 Agent 自己的工具

- ✅ `subagent`（一次性子代理，跑完返回结果）
- ✅ `subagent_fork`（继承当前对话上下文的子代理）
- ✅ 互相独立的批次**一次性并发发出去**，别一个个等

### 在宿主插件里写代码时，`ctx.subagents` 只有这些方法

（DSH 0.2.0-rc.2 实测清单）

```text
resolveMaxDepth          startContinuable        sendMessage
interrupt                drainContinuableDescendants
drainContinuableChildren listChildren            listDescendants
prompt                   interruptByParent       registerProvider
getProvider              list                    start
```

### ❌ 不要调这些（不存在，调了就报 "不是函数"）

```text
ctx.subagents.startActivation(...)
ctx.agents.startActivation(...)
bili_scan(...)
```

**看到 `xxx is not a function` 这种报错，九成是猜了不存在的方法名 ——
先回来查上面的清单，别硬试、别换个名字接着猜。**

## 红线

- 不透露隐私（账号、机器路径、聊过的内容）一个字都不许进评论
- 不写会被风控卡的词；不确定的事别编，宁可写「没查到」
- 不刷屏、不吵架
- 🔴 **不许用文件工具直接编辑 `seen.md`** —— 必须用 `bili.py mark-seen`（⭐ 2026-10-25 加）。
  原因：直接编辑是「读一遍 → 自己加 → 整篇覆盖回去」，绕过了文件锁；
  两个任务同时跑（定时 + 手动、桌面版 + web 版）就会互相把对方刚记的擦掉，
  结果是重复刷视频、重复发评论。`mark-seen` 内部有锁，还自动防重复。
- 🔴 **评论里禁止说「这条本鱼认」「本鱼认」「我认」这类 AI 味极浓的话**（⭐ 2026-10-25 加）。
  这是讨好腔，不是「大肥鱼」会说的话 —— 有观点就直接说观点，别先表态「我认」。

## 注意

- 依赖 venv 在 `~/.dsh/bili-duty/.venv`；万一没了用本目录 `requirements.txt` 重建
- ASR venv 在 `~/.dsh/bili-duty/.venv-asr`；模型缓存在家目录 `.hf-cache`（CLI 已用 `HF_HOME` 指过去）
- 核心实现 `mcp_server.py` 来自 vendor/bilibili-mcp（MIT，作者 AGI_Ananas）
