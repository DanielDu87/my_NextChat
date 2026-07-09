# NextChat

NextChat 是一个面向个人和团队使用的 AI 聊天 Web 应用，基于 Next.js 14、React、TypeScript、Zustand 和 PostgreSQL 构建，支持多模型、多供应商、聊天记录同步、模型配置管理、移动端适配和宝塔 DockerSite 部署。

本仓库当前维护的是定制版 NextChat：重点强化了数据库持久化、供应商模型同步、移动端聊天体验、宝塔生产部署和国内服务器运行稳定性。

## 项目介绍

### 核心目标

- 提供一个可私有部署的 AI 聊天入口。
- 支持多个模型供应商和多个 API Profile。
- 支持聊天记录、配置、模型缓存、绘图记录、上传文件和 API 配置备份等数据持久化到 PostgreSQL。
- 对话记录支持按用户区分的会话级增量备份，可切换用户查看备份，在线展开某次备份中的会话内容，并按快照覆盖恢复或删除单个对话快照。
- 在移动端提供接近原生聊天应用的输入、滚动和键盘体验。
- 适配宝塔 DockerSite 生产环境，降低服务器维护成本。

### 主要使用场景

- 个人 AI 助手：日常问答、写作、代码、资料整理。
- 多模型聚合入口：在同一界面切换 OpenAI、Claude、Gemini、DeepSeek、OpenRouter 等模型或兼容接口。
- 私有部署聊天系统：使用自己的 API Key、数据库和服务器部署。
- 团队共享入口：通过站点访问控制和数据库同步保存统一配置。

## 功能概览

### 聊天体验

- 多轮对话、上下文管理、历史摘要。
- 支持文本、图片、多模态消息和生成媒体展示。
- 支持消息复制、重发、编辑、语音朗读。
- 支持助手消息下方展示 Token 用量，窄屏和长文本会自动换行。
- 对话页顶部提供统一「配置管理」入口，悬停展开后可进入「API 配置」（`/api_config`）、「对话备份」（`/backup/chat`）、「API 备份」（`/backup/api_config`）和「余额查询」（`/balances`）。对话备份点击「立即备份」会为所有用户创建增量备份，可切换用户查看对应备份；历史对话默认只显示标题，点击后展开或收起消息内容，并可按快照覆盖恢复或删除某个对话快照，也可删除整次备份记录。
- API 配置页关闭时，如果存在未同步修改，会弹出仅含「保存 / 不保存」的确认框；点击「不保存」直接退出，避免误留在页面。
- 移动端优化：
  - 新空对话默认显示用户状态与切换入口；发送消息后自动收起，进入已有消息的历史对话时默认保持收起，可通过头部用户按钮手动切换显示状态。
  - 流式输出期间，点击或滑动不会中断模型请求；“回到底部”只定位到点击瞬间已有内容的底部，不持续跟随后续增量。
  - 手机浏览器或 PWA 返回主屏幕后再回到前台时不主动中断输出；只有关闭页面、关闭应用或系统销毁进程时才允许连接终止。
  - Markdown 表格保留完整列宽，超出消息区域时可在表格内部左右滑动查看，不带动整个页面横移。
  - 手机旋转为横屏后仍保持移动端组件和交互，不因横向视口超过断点切换为桌面视角。
  - 移动端切换模型后自动收起用户状态面板；流式上滑由原生手势接管，“回到底部”始终定位末页且不持续跟随。
  - 手动切换模型时先持久化本地模型配置，再在后台静默同步并输出日志；最新对话无论为空还是正在对话，都会同时更新全局默认模型，老对话只更新自身。
  - 多轮对话展开软键盘时至少保留一块可见消息区域，并稳定展示最近消息，避免滚入空白占位区。
  - 点击页面空白不会自动跳到底部。
  - 点击标题可滚动到顶部，输出中也会暂停自动贴底。
  - 回到底部按钮采用两帧滚动方式，避免虚拟消息窗口切换时出现空白。
  - 移动端输入框、键盘弹起、光标和滚动位置做了专项适配。

### 模型与供应商

- 支持多 Provider / 多 Profile 管理，Profile 保存时自动落库到 `provider_configs` + `provider_api_keys`。
- 支持模型列表缓存、自动刷新、手动同步（`/api/db/models/refresh`、`yarn db:refresh-provider-models`）。
- 支持按供应商、模型能力、发布时间等维度组织模型选择器。
- 聊天页模型切换采用全局共享配置：所有账号共用同一套默认模型选择，用户切换不会重置当前全局模型。
- 支持自定义 Base URL 和 OpenAI 兼容接口。Custom 供应商走 `/api/proxy/[...path]` + `x-base-url` 服务端代理，避免浏览器 CORS。
- 自定义供应商 baseURL 具备自动适配：上游对原始 URL 返回 HTML（即把请求当成网站路径，常见于 OpenRouter `https://openrouter.ai/api/v1`）时，服务端会自动尝试 `/api/v1`、`/api`、`/v1` 等常见前缀并把 path 中多余的 `v1/` 剥掉重试，命中后写入进程内缓存。命中失败返回 502 + `proxy_baseurl_adaptation_failed`，聊天页会展示中文友好提示和已尝试的候选地址。
- 内置「余额查询」页面（`/balances`）：自动遍历当前用户的 API Profile，按多路径、多前缀顺序探测上游余额接口；可单独保存管理密钥（AihubMix 需使用 Manage Key，Yuto 使用 `API_Key|User_ID`），密文写入 `provider_balance_configs.encrypted_management_key`。
- API 配置自动 / 手动 / 恢复前备份都会把 `provider_balance_configs` 一并打包进 `payload_json.balanceEntries`（payload schema = 2），恢复时按 `provider_code` 解析回 `provider_configs.id` 后写回；新备份统一写入单层 `payload_json.state.apiProfiles`，历史双层 `payload_json.state.state.apiProfiles` 仍保持计数和恢复兼容。
- 默认构建时优先使用仓库内置 `vendor/rt-client-0.5.0.tgz`，减少外网依赖。

### 数据与同步

- PostgreSQL 存储核心业务数据：用户、认证 session、聊天索引、会话、消息、对话备份、供应商配置、API Key 密文、模型缓存、绘图图片、上传文件缓存、API 配置备份和供应商余额快照 / 管理密钥。
- IndexedDB 保存浏览器本地业务工作副本；localStorage 仅保存设备级偏好、主题、临时草稿、全局模型选择和少量启动标记，其中主题只保存在当前设备、不参与云同步。
- 支持数据库同步与本地优先合并策略。
- 提供数据库审计、迁移、清理、模型同步、余额查询等维护脚本。

### 访问控制与部署

- 支持站点访问密码和用户认证 session。
- 支持 Docker 开发、Docker 生产、宝塔 DockerSite 部署。
- 当前线上默认以宝塔 DockerSite 为权威部署方式。
- 支持反向代理、SSL、宝塔 Compose 面板显示和 DockerSite 注册脚本。

### 扩展能力

- Mask / Prompt 预设。
- 插件系统。
- MCP（Model Context Protocol）扩展入口。
- Tauri 桌面端构建能力。
- PWA 形态。

## 技术实现

### 前端架构

- `Next.js 14`：应用框架与 API Routes。
- `React 18`：UI 组件和交互逻辑。
- `TypeScript`：类型约束。
- `SCSS Modules`：组件级样式隔离，全局通用样式优先复用 `app/styles/globals.scss` 的 `nextchat-*` 公共类（详见 `CLAUDE.md` 「公共类约束」）。
- `Zustand`：全局状态管理。
- `React Router BrowserRouter`：客户端页面路由，当前统一使用普通路径 URL。

公共输入类约定：

- `nextchat-input-control`：用于原生 `input`、`textarea`、`select`、`contentEditable` 等可输入本体，负责尺寸、内边距、排版和统一交互反馈。
- `nextchat-input-surface`：用于自定义外壳、只读展示块、伪输入框等表面容器，负责统一边框、背景和焦点视觉。
- 不要在同一层可交互输入上同时叠加 `nextchat-input-control` 和 `nextchat-input-surface`，否则容易出现双边框和双焦点反馈。

核心目录：

```text
app/
├── page.tsx        # 服务端入口：鉴权/站点密码门禁
├── [...path]/      # 普通路径刷新兜底
├── api/            # 服务端 API、供应商代理、认证和数据库同步
├── client/         # 模型供应商客户端
├── components/     # UI、聊天、绘图、API 配置、MCP 等业务组件
├── config/         # 构建/客户端/服务端配置
├── locales/        # 多语言文案
├── mcp/            # MCP 相关能力
├── store/          # Zustand 状态
└── utils/          # 同步、模型、存储、服务端 repository 和工具
```

### 聊天界面实现

主要文件：

- `app/components/chat.tsx`
- `app/components/chat.module.scss`
- `app/store/chat.ts`
- `app/store/chat-session.ts`
- `app/utils/chat.ts`

实现要点：

- 聊天持久化按用户拆分为索引和单会话正文，首屏只 hydrate 当前会话和少量最近会话。
- 使用虚拟消息窗口控制长对话渲染量。
- 流式输出期间根据用户滚动意图决定是否自动贴底。
- 移动端通过 `visualViewport`、输入框测量和多阶段布局同步处理软键盘遮挡。
- 回到底部和滚到顶部逻辑区分处理，避免滚动状态与虚拟消息窗口错位。
- Token 用量通过消息 `usage` 字段格式化展示。

### 页面路由与访问地址

当前项目已从 hash 路由切换为普通路径路由：

- 首页：`http://localhost:3000/`
- 聊天页：`http://localhost:3000/chat`
- 指定会话：`http://localhost:3000/chat/<session-id>`
- 对话备份：`http://localhost:3000/backup/chat`
- 绘图页：`http://localhost:3000/draw`
- 绘图历史：`http://localhost:3000/draw/history`
- API 配置：`http://localhost:3000/api_config`
- API 配置备份：`http://localhost:3000/backup/api_config`
- 余额查询：`http://localhost:3000/balances`
- 线上对应：`https://chat.dyxcloud.com/...`（同样使用普通路径）

旧地址如 `http://localhost:3000/#/draw`、`/#/settings`、`/#/auth` 会在客户端启动时自动迁移到对应普通路径。直接刷新 `/draw`、`/api_config` 等路径由 Next.js catch-all 页面兜底进入同一个应用入口。

### 数据库存储实现

主要文件：

- `app/utils/server/postgres.ts`
- `app/utils/server/backup-postgres.ts`
- `app/utils/server/auth.ts`
- `app/utils/server/chat-conversation-repository.ts`
- `app/utils/server/provider-config-repository.ts`
- `app/utils/server/provider-balance-repository.ts`
- `app/utils/server/sync-store-repository.ts`
- `docs/db/nextchat-postgres-schema.sql`

核心表：

- `app_users`：用户与同步身份。
- `auth_sessions`：登录 session token 哈希。
- `app_settings`：前端 store 快照和同步状态。
- `conversations`：聊天会话元数据。
- `messages`：聊天消息内容。
- `provider_configs`：供应商配置。
- `provider_api_keys`：API Key 密文与分组。
- `provider_balance_configs`：供应商余额快照、查询时间戳和管理 API Key 密文。
- `sync_secrets`：同步敏感 payload 密文。
- `site_access_settings`：站点访问密码哈希。
- `user_draw_stores`：绘画任务历史快照。
- `user_draw_images`：绘画生成图片原图与缩略图（bytea，按 md5 去重）。
- `cache_file_blobs` / `user_cache_files`：上传文件二进制去重与用户文件记录。

备份数据库由 `BACKUP_DATABASE_URL` 或 `BACKUP_PGHOST` / `BACKUP_PGDATABASE` / `BACKUP_PGUSER` / `BACKUP_PGPASSWORD` 指向，运行时 owner 是 `app/utils/server/backup-postgres.ts`。核心表：

- `backup_chat_settings` / `backup_chat_runs` / `backup_chat_conversation_snapshots`：按用户区分的对话增量备份和会话快照。
- `backup_api_config_settings` / `backup_api_config_snapshots`：API 配置自动/手动备份。

对话记录当前已经规范化拆分到 `app_settings.chat_settings.__chat-index-state__`、`conversations` 和 `messages`。站内对话备份写入独立备份数据库的 `backup_chat_settings` / `backup_chat_runs` / `backup_chat_conversation_snapshots`，按用户隔离；页面点击「立即备份」会为所有用户逐个创建增量备份，并可切换用户查看对应备份。每次增量只收录上次备份后变更过的会话，但每个会话保存完整消息快照，包含软删除会话，便于在线展开查看。单会话恢复会从备份数据库读取快照，再写回主业务库并恢复为可见；恢复写入会刷新会话更新时间，避免本地旧缓存或后续同步再次覆盖恢复结果。页面支持删除整次备份记录，或删除某次备份中的单个会话快照。生产灾备仍以 PostgreSQL `pg_dump` / 宝塔计划任务备份为准，主库和备份库都需要纳入备份范围。

### 模型同步实现

主要文件：

- `app/utils/server/provider-model-fetch.ts`
- `app/utils/server/provider-model-sync.ts`
- `app/utils/server/provider-balance.ts`
- `app/utils/provider-balance.ts`
- `app/api/db/provider-balance/route.ts`
- `app/components/provider-balances.tsx`
- `app/store/model-cache.ts`
- `scripts/sync-models-to-postgres.ts`
- `scripts/refresh-provider-models.ts`

实现方式：

- 服务端按 Provider 拉取模型列表。
- 前端以 IndexedDB 本地缓存优先，必要时触发刷新。
- 数据库存储供应商配置、API Key 密文和 `access-control` 快照。
- 模型目录不再写入独立 `model_catalog` 等表，刷新结果回写 `access-control.apiProfiles[*].cachedModels`。
- 余额查询是供应商模型的旁路能力：`/api/db/provider-balance` 提供 `GET`（列出当前用户所有 Profile 与最近余额快照）、`PUT`（保存某个 Profile 的管理 API Key）、`POST`（对单个 Profile 发起余额查询）；AihubMix 固定请求 `/api/user/self`，优先使用 Bearer Manage Key 并兼容旧式 Authorization，且始终基于用户配置的 `baseUrl`（含 `api.inferera.com` 等镜像）查询——镜像站点的 Manage Key 与官方域名 `aihubmix.com` 不互通，部分部署环境也无法访问官方域名，因此不强制改写为官方域名；其他通用供应商按前缀 × 资源组合探测。超时、网络错误、`5xx`/`429` 或成功响应暂时缺少余额字段时，服务端会沿用原候选路径最多查询 3 轮，最终结果才落库；明确的配置、鉴权和稳定 `4xx` 错误不重试。服务端保留每轮探测的 `attempts`，前端日志可直接观察路径与状态码。

### 部署实现

本地开发使用 Docker `dev` profile：

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile ssh-tunnel up -d --build postgres-ssh-tunnel
NEXTCHAT_DISABLE_AUTH=true NEXTCHAT_LOCAL_BYPASS_USER=ccc PGHOST=postgres-ssh-tunnel PGPORT=5432 SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel logs -f nextchat-dev
```

生产部署当前以宝塔 DockerSite 为准：

- 项目路径：`/www/dk_project/my_NextChat`
- Compose：`docker-compose.baota.yml`
- 环境变量：`.env.baota`
- 域名：`chat.dyxcloud.com`
- 上游：`http://127.0.0.1:3000`

详细流程见：

- [README_BAOTA.md](README_BAOTA.md)
- [docs/baota-chat-dyxcloud-runbook.md](docs/baota-chat-dyxcloud-runbook.md)

## 文档入口

### 开发相关

- 开发指南：[docs/development.md](docs/development.md)
- Docker 部署与开发：[docs/docker-deploy-cn.md](docs/docker-deploy-cn.md)
- 本地开发快速入口：[docs/local-dev-guide.md](docs/local-dev-guide.md)

### 部署相关

- 部署入口：[DEPLOY.md](DEPLOY.md)
- 宝塔当前线上说明：[README_BAOTA.md](README_BAOTA.md)
- 宝塔详细 Runbook：[docs/baota-chat-dyxcloud-runbook.md](docs/baota-chat-dyxcloud-runbook.md)
- 宝塔 DockerSite 页面操作：[docs/baota-dockersite-guide.md](docs/baota-dockersite-guide.md)
- 宝塔 PostgreSQL 操作：[docs/baota-postgres-guide.md](docs/baota-postgres-guide.md)
- 宝塔 DockerSite 页面操作：[docs/baota-dockersite-guide.md](docs/baota-dockersite-guide.md)

### 功能与维护

- 用户手册：[docs/user-manual-cn.md](docs/user-manual-cn.md)
- 多用户与登录：[docs/user-admin-guide.md](docs/user-admin-guide.md)
- 同步功能使用指南：[docs/sync-usage-guide.md](docs/sync-usage-guide.md)
- 数据库存储矩阵：[docs/db/data-storage-sync-matrix.md](docs/db/data-storage-sync-matrix.md)
- 模型刷新说明：[docs/db/provider-model-auto-refresh.md](docs/db/provider-model-auto-refresh.md)
- 余额查询 / Yuto 集成：[docs/yuto-balance-query.md](docs/yuto-balance-query.md)
- 质量与部署后验证：[docs/quality-checklist.md](docs/quality-checklist.md)

## 当前约定

- 本地 Docker 开发统一使用 `dev` profile 和 `./scripts/docker-compose-safe.sh`。
- 普通业务代码修改后依赖热加载，不重启容器、不重建镜像。
- 生产部署默认使用宝塔 DockerSite：`docker-compose.baota.yml` + `.env.baota`。
- 页面 URL 统一使用普通路径，不再新增 `/#/...` hash 链接。
- 不再维护 Jest 测试脚本和 `test/` 目录；质量检查优先使用 `yarn lint`、`yarn build`、针对性脚本或手工验证。
- 临时调试文件、历史 `.bak` 文件、截图生成的空 `div*` 文件不要提交。

## 常用命令

### 本地开发

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile ssh-tunnel up -d --build postgres-ssh-tunnel
NEXTCHAT_DISABLE_AUTH=true NEXTCHAT_LOCAL_BYPASS_USER=ccc PGHOST=postgres-ssh-tunnel PGPORT=5432 SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel logs -f nextchat-dev
```

停止：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev down
```

### 构建与检查

```bash
yarn lint
yarn build
npx tsc --noEmit --pretty false
```

说明：当前 `tsc` 可能受项目既有 `tsconfig.json` 中 `moduleResolution=node10` 废弃提示影响。

### 宝塔生产部署

标准流程以 [README_BAOTA.md](README_BAOTA.md) 和 [docs/baota-chat-dyxcloud-runbook.md](docs/baota-chat-dyxcloud-runbook.md) 为准。

```bash
ssh ss 'tmux new-session -d -s nextchat-baota-deploy "cd /www/dk_project/my_NextChat && git pull --ff-only && ./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota build nextchat && ./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota up -d nextchat 2>&1 | tee /tmp/nextchat-baota-deploy.log"'
ssh ss 'tmux capture-pane -t nextchat-baota-deploy -p -S -120'
```
