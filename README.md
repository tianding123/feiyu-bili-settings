# feiyu-bili-settings ｜ 刷B站

> **基于 [c1overzz（凌羽clover）](https://github.com/c1overzz/dsh-bili-scroll) 的 dsh-bili-scroll 魔改。**
> 原始创意与核心实现来自原作者，本仓库是独立的派生版本，遵循 MIT 协议。

DSH 插件：在 **设置页里开一个「刷B站」子页面**，改关键词、播放量门槛、每轮挑几条、UP 主名单、@ 谁 —— 直接写进 `bili-duty` 的 `config.json`，配合技能定时替你刷 B站、把值得的 @ 你。

## 它和原版有什么不同

|  | 原版 dsh-bili-scroll | 本版 feiyu-bili-settings |
|---|---|---|
| 形态 | 完整插件（含技能 + 定时 + 设置页） | **可独立分发的设置页 + 技能** |
| 安装 | 需要本机已有 Python 或 uv | **零前提**：自带 uv 自动下载 + 校验 sha256 |
| 转写 | 需要手动开开关 + 装依赖 | 一个按钮，可选顺便下模型 |
| 设置页 | 峰谷时段 | 按轮次配置时段（1–6 轮）、会话绑定、UP 主下拉管理 |

## 安装

```bash
dsh plugin --profile desktop add github:tianding123/feiyu-bili-settings
```

或者下载 Release 里的 `.tgz`：

```bash
dsh plugin add file:D:\下载\feiyu-bili-settings-0.4.4.tgz
```

⚠️ **装完必须重启一次 DSH**（插件在 bundle 层组装）。

### 方式三：在 DSH 界面里点「添加插件」

1. 打开 DSH → **插件** 页面
2. 点右上角「**+ 添加插件**」
3. 在输入框里贴：

```
github:tianding123/feiyu-bili-settings
```

4. 点安装

> 如果提示「无法访问 GitHub」或「连接 GitHub 超时」，界面上会有「**改用国内镜像**」按钮，点它就行。

## 首次配置（三步）

1. **装主依赖** —— 设置页点「装主依赖」。没 Python 也没 uv 也行，插件会自己下一份 uv（约 30 MB），自动建 venv、装 110 个包。走国内镜像。
2. **扫码登录** —— 点「扫码登录」，手机 B站 App 扫码。⚠️ 确认时选「**记住我 / 长期**」。
3. **填配置 → 保存** —— 关键词、播放量门槛、每轮挑几条、时段。保存时自动建定时任务。

凭证只落在本机：`<DSH_HOME>/bili-duty/bili_credential.json`，不上传任何地方。

## 设置页里有什么

| 板块 | 内容 |
|---|---|
| **测试** | 「测试跑一轮」—— 3 秒后触发，不等时段 |
| **运行环境** | Python 依赖检查 / 一键装（3 行实时进度） |
| **账号** | 扫码登录、登录态 |
| **会话** | 定时任务跑在哪个会话 |
| **自动刷** | 开关 + 一天几轮 + 每轮起止时间 + 今日进度 |
| **挑片规则** | 搜索关键词、播放量门槛、每轮挑几个、每天上限 |
| **特别关注的 UP 主** | 名单管理（下拉删除）、每轮/每天配额、查最近几天 |
| **发评论** | 开关 + @ 谁 |
| **人设 / 说话风格** | 指定 AGENTS.md 路径，按你的人格写评论 |
| **其他 · 本地转写** | 没字幕时本地跑 Whisper，可选模型大小 |

## 环境要求

- **DSH ≥ 0.1.7-rc.1**
- **桌面版**（有 `@deepseek-ai/dsh-experimental-schedule-bundle`）
  - ⚠️ 用 `dsh web` 起的精简 profile 默认**没有**定时任务功能，设置页会显示红字提示并禁用「自动刷」

## 常见问题

**装完设置页里没有「刷B站」？**
→ 重启 DSH 了吗？插件在 bundle 层组装，不重启不生效。

**「装主依赖」卡在下载 uv？**
→ GitHub 直连可能不通（端口通但数据不来）。插件有 45 秒超时，会自动换 gh-proxy / ghproxy.net / PyPI 镜像。实在不行手动放一份 `uv.exe` 到 `<DSH_HOME>/bili-duty/bin/`。

**「自动刷」显示红字「没装定时任务功能」？**
→ 你的 profile 缺 `@deepseek-ai/dsh-experimental-schedule-bundle`。桌面版自带；`dsh web` 需要手动加进 profile 的 bundles。

## 致谢

- [**c1overzz（凌羽clover）**](https://github.com/c1overzz/dsh-bili-scroll) —— 原始创意、插件架构、值班章程
- [**bilibili-mcp**](https://github.com/adoresever/bilibili-mcp)（MIT, AGI_Ananas）—— B站 接口能力

## 许可证

MIT（见 [LICENSE](./LICENSE)）。内置第三方代码见 `vendor/LICENSE`。
