<h1 align="center">Quark Sync</h1>

<p align="center">
  <a href="#zh">中文</a> ·
  <a href="#en">English</a>
</p>

<p align="center">
  <strong>在 Obsidian 中同步夸克网盘：可视化的同步策略，以及能理解上下文的 AI 助手。</strong><br>
  <em>Sync your Obsidian vault with Quark Drive, with an extensible AI assistant built into your workspace.</em>
</p>

> [!NOTE]
> 这是 [nutstore/obsidian-nutstore-sync](https://github.com/nutstore/obsidian-nutstore-sync) 的衍生项目：同步后端已从坚果云 WebDAV 换成夸克网盘开放平台，坚果云后端与 SSO 登录已移除。AI 助手功能来自上游，其中「坚果云 AI 网关」为上游提供的独立服务。

---

<a id="zh"></a>

Quark Sync 让 Obsidian 与夸克网盘双向同步，支持桌面端与移动端。同步方向、冲突策略、过滤规则都可控，另外还有内置 AI 助手可以调用工具、复用 Skills、连接 MCP 服务。

### ✨ 为什么使用 Quark Sync

- **同步方向由你决定**：五种同步策略覆盖多设备同步、单向备份和镜像场景。
- **重要操作看得见**：可在同步前审阅待执行操作，并为自动删除单独保留确认步骤。
- **大型 Vault 也能灵活配置**：支持宽松或严格扫描、路径过滤和大文件跳过。
- **可扩展的 AI 助手**：在 Obsidian 中使用内置工具、Skills、MCP 和可配置子 Agent。

### 🚀 快速开始

1. 把本仓库的 `main.js`、`manifest.json`、`styles.css` 放进 `<vault>/.obsidian/plugins/quark-sync/`，然后在 Obsidian 中启用 **Quark Sync**。
2. 在 [夸克开放平台](https://open.quark.cn/) 创建应用，取得 `app_id` 与 `sign_key`。
3. 完成 OAuth 授权，取得 `access_token` 与 `refresh_token`。
4. 打开插件设置，填入上述四项与根目录 FID（默认 `0`），点击 **检查连接**。
5. 选择同步目录与同步策略，点击功能区图标或运行命令 **Start sync**。

> [!IMPORTANT]
> 首次同步前请备份 Vault。带有“覆盖”或“还原”含义的镜像策略可能删除另一端独有的文件。

### 🗄️ 夸克后端说明

夸克网盘不提供 WebDAV，也没有账号密码登录，因此本插件直接对接**开放平台 API**：

- **凭据只保存在本地 Vault**，不会上传到任何服务器；`sign_key` 属于你自己创建的应用。
- **写入本地修改时间**：上传时把本地 mtime 写进 `l_updated_at`，双向同步仍按修改时间比较。
- **秒传**：内容未变的文件通过 `upload_pre` 的秒传通道跳过上传；大文件按服务端下发的分片大小分片 PUT。
- **每次同步都会重新遍历远端目录**：开放接口没有增量变更流，大 Vault 首次同步较慢。
- **覆盖方式**：默认“复用同名文件”；若发现同名文件被上传成多份，改为“先删除再上传”。
- **令牌过期**：填了「令牌刷新中转」（兼容 OpenList 的刷新接口）会自动续期，否则需手动填新的 Access Token。
- **限速**：非会员账号下载速度受夸克限速影响。

### 🔌 两种连接方式

设置里的 **同步后端** 可以二选一：

| 后端 | 需要什么 | 适合 |
| --- | --- | --- |
| **夸克开放平台（直连）** | 自己在[夸克开放平台](https://open.quark.cn/)注册应用，拿到 `app_id` / `sign_key`，再 OAuth 得到 `access_token` | 能拿到开放平台凭据、想少一层中转 |
| **WebDAV 网关（Alist / OpenList 等）** | 网关的 WebDAV 地址 + 账号密码；**不需要任何夸克 API 凭据** | 本机/服务器已经用 Alist、OpenList、quarkdrive-webdav 或 `rclone serve webdav` 挂好夸克网盘 |

WebDAV 网关地址一般以 `/dav` 结尾，例如 Alist 默认是 `http://127.0.0.1:5244/dav`，用户名 `admin`。
插件对这个地址只做标准 WebDAV 读写，网关自己负责登录夸克，因此可同时兼容 Alist、OpenList、quarkdrive-webdav、rclone、坚果云以外的任意 WebDAV 服务端。

### 🔄 按你的方式同步

| 同步策略               | 行为                                             | 适合场景                   |
| ---------------------- | ------------------------------------------------ | -------------------------- |
| **双向同步**           | 在本地与夸克网盘之间同步新增、修改和删除         | 多设备日常使用             |
| **仅发送**             | 上传本地新增和修改，保留云端独有或已变化的内容   | 本地为主，云端保留独立内容 |
| **仅发送（覆盖云端）** | 让云端内容与本地保持一致                         | 将本地作为完整主副本       |
| **仅接收**             | 下载云端新增和修改，保留本地独有或已变化的内容   | 云端为主，本地保留独立内容 |
| **仅接收（还原本地）** | 让本地内容与云端保持一致                         | 将云端作为完整主副本       |

### 🧩 冲突处理由你选择

- **智能合并**：对 Markdown 等文本文件做无冲突合并，保留双方改动。
- **diff3 三路合并**：以同步基线为参照做三路合并。
- **本地优先 / 云端优先**：直接让一侧覆盖另一侧，适合单一来源的目录。

### 🤖 AI 助手

内置 ChatBox 可以读取当前 Vault、调用工具、执行 Skills、连接 MCP 服务，并按需启用子 Agent。Agent 修改文件或插件设置前会请求确认，设置中还有白名单限制，不包含夸克凭据或 AI API Key。

### ⚠️ 使用前须知

- 首次同步需要扫描两端内容，文件较多时会花费更长时间。
- “仅发送（覆盖云端）”可能删除云端独有文件；“仅接收（还原本地）”可能删除本地独有文件。
- 被过滤或超过大小限制的文件不会同步，因此两端可能有意保持不同。
- 如果两端已经存在大量同名文件，建议先备份并使用严格模式完成首次同步。
- 本插件不是 Obsidian 官方同步服务，也与夸克官方无关；夸克开放平台的应用与配额由你自己承担。

---

<a id="en"></a>

Quark Sync keeps an Obsidian vault and Quark Drive in sync on desktop and mobile. You choose the direction, the conflict strategy and the filters, and a built-in AI assistant can use tools, reusable Skills and MCP servers when you need it.

> [!NOTE]
> This is a derivative of [nutstore/obsidian-nutstore-sync](https://github.com/nutstore/obsidian-nutstore-sync). The sync backend was replaced with the Quark Drive open platform; the Nutstore WebDAV backend and SSO login were removed. AI features come from upstream, including the optional Nutstore AI gateway provider.

### ✨ Why Quark Sync

- **You control the direction**: five sync policies cover everyday multi-device use, one-way backup, and mirror workflows.
- **Important operations stay visible**: review planned operations before syncing and keep a separate confirmation step for automatic deletions.
- **Flexible for large vaults**: loose or strict scanning, path filters, and large-file limits.
- **An extensible AI assistant**: built-in tools, Skills, MCP, and configurable subagents.

### 🚀 Quick Start

1. Copy `main.js`, `manifest.json` and `styles.css` into `<vault>/.obsidian/plugins/quark-sync/`, then enable **Quark Sync** in Obsidian.
2. Create an app on the [Quark open platform](https://open.quark.cn/) to get an `app_id` and `sign_key`.
3. Complete the OAuth flow to obtain an `access_token` and `refresh_token`.
4. Open the plugin settings, paste all four values plus a root folder FID (default `0`), then run **Check connection**.
5. Pick a sync folder and policy, then click the ribbon icon or run **Start sync**.

> [!IMPORTANT]
> Back up your vault before the first sync. Mirror policies that override or revert changes may delete files that exist on only one side.

### 🗄️ About the Quark backend

- Credentials stay in the local vault and are never uploaded; the `sign_key` belongs to the app you created.
- Uploads carry the local mtime (`l_updated_at`), so two-way sync still compares modification times.
- Unchanged files short-circuit through the rapid-upload channel; large files are uploaded in server-provided parts.
- There is no change feed, so every sync re-walks the remote tree — the first sync of a large vault is slow.
- Overwrite mode defaults to “reuse the existing file”; switch to “delete first, then upload” if duplicates ever appear.
- An expired token is refreshed through the optional OpenList-compatible relay, otherwise paste a fresh token.
- Download speed for free accounts is throttled by Quark.

### 🔌 Two ways to connect

**Sync backend** in the settings switches between:

| Backend | Needs | Good for |
| --- | --- | --- |
| **Quark open platform (direct)** | Your own app on the [Quark open platform](https://open.quark.cn/) (`app_id` / `sign_key`) plus an OAuth `access_token` | When you can obtain open-platform credentials and want no extra hop |
| **WebDAV gateway (Alist / OpenList, …)** | The gateway's WebDAV URL plus credentials — **no Quark API credentials at all** | Machines that already mount Quark through Alist, OpenList, quarkdrive-webdav or `rclone serve webdav` |

The gateway URL usually ends with `/dav` (Alist default: `http://127.0.0.1:5244/dav`, user `admin`). The plugin only performs standard WebDAV calls, so any WebDAV server works — Alist, OpenList, quarkdrive-webdav, rclone, or anything else.

### 🔄 Sync Your Way

| Policy                        | Behaviour                                                        | Good for                      |
| ----------------------------- | ---------------------------------------------------------------- | ----------------------------- |
| **Two-way**                   | Add, update and delete in both directions                        | Everyday multi-device use     |
| **Send only**                 | Upload local changes, keep cloud-only or changed content         | Local-first with cloud copies |
| **Send only (override cloud)**| Make the cloud match the vault exactly                            | Vault is the only source      |
| **Receive only**              | Download cloud changes, keep local-only or changed content        | Cloud-first, local edits kept |
| **Receive only (revert local)**| Make the vault match the cloud exactly                           | Cloud is the only source      |

### 🧩 Choose How Conflicts Are Handled

- **Smart merge** for Markdown-like text files, keeping both sides.
- **diff3 three-way merge** against the recorded base.
- **Local priority / cloud priority** when one side should win outright.

### ⚠️ Before You Sync

- The first sync scans both sides and may take longer for large vaults.
- **Send only (override cloud)** may delete cloud-only files; **Receive only (revert local)** may delete local-only files.
- Filtered files and files above the size limit remain unsynced, so the two sides may intentionally differ.
- If both sides already contain many files with matching paths, back up first and use strict mode for the initial sync.
- This plugin is not Obsidian Sync and is not affiliated with Quark.
