<h1 align="center">Quark Sync</h1>

<p align="center">
  <strong>把 Obsidian 仓库同步到夸克网盘：直连夸克开放平台，或对接 Alist / OpenList 等 WebDAV 网关。</strong><br>
  <em>Sync an Obsidian vault with Quark Drive — directly via the open platform, or through an Alist / OpenList WebDAV gateway.</em>
</p>

<p align="center">
  <a href="https://github.com/xiaomaogou66/Quark-Sync-for-obsidian/releases/latest">下载 / Download</a> ·
  <a href="#zh">中文</a> ·
  <a href="#en">English</a>
</p>

> 本仓库是 [nutstore/obsidian-nutstore-sync](https://github.com/nutstore/obsidian-nutstore-sync) 的衍生项目：同步后端换成了夸克网盘，坚果云（WebDAV / SSO / AI 网关）相关代码已全部移除。协议为 **AGPL-3.0**。

---

<a id="zh"></a>

## ✨ 特性

- **两种后端**：夸克开放平台直连，或任意标准 WebDAV 网关（Alist / OpenList / quarkdrive-webdav）
- **五种同步策略**：双向、仅发送、仅发送（覆盖云端）、仅接收、仅接收（还原本地）
- **可视化目录选择**：面包屑浏览远端目录，可直接新建，路径不存在自动回退到根
- **冲突处理可选**：智能合并、diff3 三路合并、本地优先、云端优先
- **可控可审阅**：同步前预览待执行操作；自动同步中的删除单独确认
- **过滤与大文件**：glob 规则、`configDir` 同步模式、超大文件跳过
- **AI 助手**（继承自上游）：内置 ChatBox，可调用工具、Skills、MCP

## 🚀 安装

1. 从 [Releases](https://github.com/xiaomaogou66/Quark-Sync-for-obsidian/releases/latest) 下载 `main.js`、`manifest.json`、`styles.css`
2. 放进 `<vault>/.obsidian/plugins/quark-sync/`
3. 重启 Obsidian → 设置 → 第三方插件 → 启用 **Quark Sync**

> 首次同步前请备份 Vault。

## 🔌 两种连接方式

设置 → Quark Sync → 夸克网盘账号，顶部 **同步后端** 二选一：

| 后端 | 需要什么 | 适合 |
| --- | --- | --- |
| **夸克开放平台（直连）** | 在[夸克开放平台](https://open.quark.cn/)注册应用，取得 `app_id` / `sign_key`，再 OAuth 得到 `access_token` / `refresh_token` | 能拿到开放平台凭据 |
| **WebDAV 网关（Alist / OpenList 等）** | 网关的 WebDAV 地址 + 账号密码，**不需要任何夸克 API 凭据** | 已有（或愿意搭）Alist / OpenList |

拿到凭据后点 **检查连接**；失败时会给具体原因（地址缺 `/dav`、401 凭据错误、404 路径不存在、405 不是 WebDAV 等）。

## 🗄️ 网盘侧准备：用 Alist / OpenList 挂载夸克网盘

插件自己不做夸克登录，网关负责登录并把网盘暴露成 WebDAV。两者任选其一，操作几乎一致。

### 官方入口

| 项目 | 文档 | 源码 | 夸克驱动文档 |
| --- | --- | --- | --- |
| **Alist** | <https://alistgo.com>（旧版文档 <https://alist.nn.ci>） | <https://github.com/AlistGo/alist> | <https://alistgo.com/zh/guide/drivers/quark> |
| **OpenList** | <https://doc.oplist.org> | <https://github.com/OpenListTeam/OpenList> | <https://doc.oplist.org/guide/drivers/quark> |

> OpenList 是 Alist 的社区治理分支，命令与界面基本一致；下面以 `alist` 为例，OpenList 把命令换成 `openlist` 即可。

### 1. 安装并初始化

```bash
# 方式 A：直接跑官方二进制（Linux x86_64）
#   从 Releases 下载 alist-linux-amd64.tar.gz 或 openlist-linux-amd64.tar.gz
tar xzf alist-linux-amd64.tar.gz && chmod +x alist

# 方式 B：Docker
docker run -d --restart unless-stopped -p 5244:5244 \
  -v /srv/alist:/opt/alist/data --name alist xhofe/alist:latest

# 设管理员密码（第一次启动会打印随机密码，也可手动设置）
./alist admin set '你的密码'

# 前台启动；数据目录用 --data 显式指定，避免和 systemd 的工作目录不一致
./alist server --data /srv/alist
```

管理界面：<http://localhost:5244>

### 2. 取夸克 Cookie

1. 浏览器打开 <https://pan.quark.cn> 并**先登录**
2. `F12` → Network → 勾选 Preserve log → 刷新页面
3. 过滤框输入 `clouddrive`，点开任意请求（如 `file/sort`）
4. 复制 Request Headers 里的整个 `Cookie` 值（**不要带 `Cookie:` 前缀和引号**）

> Cookie 里最关键的是 `__pus`（登录态）和 `__puus`（短期 token，约 3 小时）。Alist / OpenList 会自动刷新 `__puus`，配置一次长期有效；但如果夸克强制重新登录（异地登录、改密、风控），存储会掉线，需要重抓 Cookie。

### 3. 添加存储

管理界面 → **存储** → **添加**：

| 字段 | 值 |
| --- | --- |
| 驱动 | **夸克网盘 / TV**（OpenList 里为 `Quark / TV / Open`，也有基于官方 OpenAPI 的 `Quark Open`） |
| 挂载路径 | `/quark`（插件里就用这个路径，例如 `/quark/AI学习工作流`） |
| Cookie | 第 2 步抓到的整串 |
| 根文件夹 ID | `0`（网盘根目录；要挂子目录就填该目录 ID） |
| WebDAV 策略 / 代理 | 保持默认「本地代理」兼容性最好 |

保存后确认存储状态是 **work**（不是 `require login`）。

### 4. 确认 WebDAV 可用

```bash
# 未认证应为 401，说明 DAV 端点在
curl -s -o /dev/null -w '%{http_code}\n' -X PROPFIND http://localhost:5244/dav/ -H 'Depth: 0'
```

插件里填：

| 设置项 | 值 |
| --- | --- |
| WebDAV 地址 | `http://localhost:5244/dav`（**必须带 `/dav`**） |
| 用户名 / 密码 | Alist / OpenList 的管理员账号密码（不是夸克账号） |
| 远程目录 | 点 📁 按钮选，或填 `/quark/<仓库名>` |

> 想验证「是网关问题还是插件问题」，用仓库里的探针脚本（不依赖 Obsidian）：
>
> ```bash
> GATEWAY_URL=http://localhost:5244/dav GATEWAY_USER=admin GATEWAY_PASS='密码' \
>   node scripts/webdav-gateway-probe.mjs /quark
> ```

### 常见问题

| 现象 | 原因 / 处理 |
| --- | --- |
| 存储状态 `require login [guest]` | Cookie 无效或缺 `__pus`，重抓后保存 |
| 插件「检查连接」报 401 | 用了夸克账号；这里要填 Alist / OpenList 的账号密码 |
| 报 404 / 405 | 地址少了 `/dav`，或填成了网页首页 |
| 挂载后目录多一层 `quark/` | 用 WebDAV 根（`/dav`）会看到所有存储；远程目录要写 `/quark/...` |
| 下载很慢 | 夸克非会员限速是服务端限制 |

## 🧭 首次同步建议

1. 通用设置 → 远程目录：用 📁 选择器确定目标目录（例如 `/quark/AI学习工作流`）
2. 同步策略先选 **仅发送**（本地 → 云端），同步模式保持 **严格**
3. 点同步 → 在「操作预览」里确认都是上传、没有意外删除
4. 跑完切 **双向** 再同步一次确认无差异

跑完可用下面的命令核对远端文件数与体积：

```bash
GATEWAY_URL=http://localhost:5244/dav GATEWAY_USER=admin GATEWAY_PASS='密码' \
  node scripts/webdav-gateway-probe.mjs --count /quark/AI学习工作流
```

## ⚠️ 已知限制

- **没有增量变更流**：每次同步都会重新遍历远端目录，大 Vault 首次与后续同步都较慢
- **写入本地 mtime**：上传时把本地修改时间写进云端，双向同步仍按 mtime 比较
- **名称与长度**：云端不接受的文件名会被单列出来，不会静默跳过
- **开放平台凭据**需自行申请；拿不到就走 WebDAV 网关
- WebDAV 请求做了串行限速（约 200ms/次），防止打爆网关

## 🛠️ 开发

```bash
pnpm install          # 需要 git-lfs 之外无特殊依赖（模型目录已改为普通文件跟踪）
pnpm lint             # eslint + tsc
pnpm test:unit        # 单测（含夸克客户端、适配器、路径助手）
pnpm build            # 产出 main.js / styles.css
pnpm test:obsidian:host   # 用本机 Obsidian 起临时 vault 做端到端验收（CDP）
```

发布：

```bash
gh release create v1.5.x-quark main.js manifest.json styles.css \
  --title "Quark Sync 1.5.x" --notes-file notes.md
```

## 📄 协议

AGPL-3.0，与上游一致。上游版权归 nutstore 及贡献者所有。

---

<a id="en"></a>

## ✨ Features

- **Two backends**: the Quark open-platform API, or any standard WebDAV gateway (Alist / OpenList / quarkdrive-webdav)
- **Five sync policies**: two-way, send only, send only (override cloud), receive only, receive only (revert local)
- **Visual folder picker** with breadcrumbs, folder creation and automatic fallback to the root
- **Conflict strategies**: smart merge, diff3, local priority, cloud priority
- **Reviewable**: preview planned operations, separate confirmation for deletions during auto-sync
- **Filters & limits**: glob rules, config-dir modes, large-file skipping
- **AI assistant** inherited from upstream (ChatBox, tools, Skills, MCP)

## 🚀 Install

1. Download `main.js`, `manifest.json`, `styles.css` from the [latest release](https://github.com/xiaomaogou66/Quark-Sync-for-obsidian/releases/latest)
2. Copy them into `<vault>/.obsidian/plugins/quark-sync/`
3. Reload Obsidian → Settings → Community plugins → enable **Quark Sync**

## 🔌 Two ways to connect

Settings → Quark Sync → account section → **Sync backend**:

| Backend | Needs | Good for |
| --- | --- | --- |
| **Quark open platform (direct)** | An app on the [Quark open platform](https://open.quark.cn/) (`app_id` / `sign_key`) plus an OAuth `access_token` | You can obtain open-platform credentials |
| **WebDAV gateway (Alist / OpenList, …)** | The gateway's WebDAV URL and credentials — **no Quark API credentials at all** | You already run Alist / OpenList |

## 🗄️ Gateway setup (Alist / OpenList)

| Project | Docs | Source | Quark driver docs |
| --- | --- | --- | --- |
| **Alist** | <https://alistgo.com> | <https://github.com/AlistGo/alist> | <https://alistgo.com/zh/guide/drivers/quark> |
| **OpenList** | <https://doc.oplist.org> | <https://github.com/OpenListTeam/OpenList> | <https://doc.oplist.org/guide/drivers/quark> |

1. Install and start the gateway (binary or Docker), then `./alist admin set '<password>'` and `./alist server --data /srv/alist`. Web UI: <http://localhost:5244>
2. Log in at <https://pan.quark.cn>, open DevTools → Network, filter `clouddrive`, copy the whole `Cookie` header value (it must include `__pus`)
3. In the gateway UI: **Storage → Add** → driver **Quark / TV**, mount path `/quark`, paste the cookie, root folder ID `0`, keep the default local proxy
4. Verify the storage status is **work**, then confirm `PROPFIND http://localhost:5244/dav/` answers 401 (endpoint alive)
5. In the plugin: WebDAV URL `http://localhost:5244/dav`, the gateway's **admin** credentials, and a remote directory such as `/quark/MyVault` (use the 📁 picker)

Out-of-app check (no Obsidian needed):

```bash
GATEWAY_URL=http://localhost:5244/dav GATEWAY_USER=admin GATEWAY_PASS='password' \
  node scripts/webdav-gateway-probe.mjs /quark
```

## 🧭 First sync

1. Pick the remote directory with the 📁 picker
2. Choose **Send only** and keep **strict** mode
3. Sync, review the operation preview, then start
4. Switch to **Two-way** afterwards and sync once more

## ⚠️ Limitations

- No change feed: every sync re-walks the remote tree, so large vaults are slow
- Local mtimes are written on upload so two-way comparison keeps working
- Rejected filenames are reported, never skipped silently
- Open-platform credentials must be obtained by you; otherwise use a WebDAV gateway
- WebDAV calls are serialised (~200 ms) to protect the gateway

## 📄 License

AGPL-3.0, same as upstream.
