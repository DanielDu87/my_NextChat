# NextChat

NextChat 是一个面向个人和团队使用的 AI 聊天 Web 应用，基于 Next.js 14、React、TypeScript、Zustand 和 PostgreSQL 构建，支持多模型、多供应商、聊天记录同步、模型配置管理、移动端适配和宝塔 DockerSite 部署。

本仓库当前维护的是定制版 NextChat：重点强化了数据库持久化、供应商模型同步、移动端聊天体验、宝塔生产部署和国内服务器运行稳定性。

## 项目介绍

### 核心目标

- 提供一个可私有部署的 AI 聊天入口。
- 支持多个模型供应商和多个 API Profile。
- 支持聊天记录、配置、模型缓存等数据持久化到 PostgreSQL。
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
- 移动端优化：
  - 流式输出时轻微上滑即可暂停自动贴底。
  - 点击页面空白不会自动跳到底部。
  - 点击标题可滚动到顶部，输出中也会暂停自动贴底。
  - 回到底部按钮采用两帧滚动方式，避免虚拟消息窗口切换时出现空白。
  - 移动端输入框、键盘弹起、光标和滚动位置做了专项适配。

### 模型与供应商

- 支持多 Provider / 多 Profile 管理。
- 支持模型列表缓存、自动刷新、手动同步。
- 支持按供应商、模型能力、发布时间等维度组织模型选择器。
- 支持自定义 Base URL 和 OpenAI 兼容接口。
- 默认构建时优先使用仓库内置 `vendor/rt-client-0.5.0.tgz`，减少外网依赖。

### 数据与同步

- PostgreSQL 存储核心业务数据：用户、认证 session、聊天索引、会话、消息、供应商配置、API Key 密文、模型缓存等。
- localStorage / IndexedDB 仅保存设备级偏好、本地缓存和临时草稿。
- 支持数据库同步与本地优先合并策略。
- 提供数据库审计、迁移、清理、模型同步等维护脚本。

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
- `SCSS Modules`：组件级样式隔离。
- `Zustand`：全局状态管理。
- `React Router BrowserRouter`：客户端页面路由，当前统一使用普通路径 URL。

核心目录：

```text
app/
├── api/            # 服务端 API 路由
├── client/         # 模型供应商客户端
├── components/     # UI 和业务组件
├── config/         # Provider 图标等配置
├── locales/        # 多语言文案
├── mcp/            # MCP 相关能力
├── store/          # Zustand 状态
└── utils/          # 同步、模型、存储、服务端工具
```

### 聊天界面实现

主要文件：

- `app/components/chat.tsx`
- `app/components/chat.module.scss`
- `app/store/chat.ts`
- `app/store/chat-session.ts`
- `app/utils/chat.ts`

实现要点：

- 使用虚拟消息窗口控制长对话渲染量。
- 流式输出期间根据用户滚动意图决定是否自动贴底。
- 移动端通过 `visualViewport`、输入框测量和多阶段布局同步处理软键盘遮挡。
- 回到底部和滚到顶部逻辑区分处理，避免滚动状态与虚拟消息窗口错位。
- Token 用量通过消息 `usage` 字段格式化展示。

### 页面路由与访问地址

当前项目已从 hash 路由切换为普通路径路由：

- 首页：`http://localhost:3000/`
- 聊天页：`http://localhost:3000/chat`
- 绘图页：`http://localhost:3000/draw`
- 绘图历史：`http://localhost:3000/draw/history`
- API 配置：`http://localhost:3000/api-config`
- 线上 API 配置：`https://chat.dyxcloud.com/api-config`

旧地址如 `http://localhost:3000/#/draw`、`/#/settings`、`/#/auth` 会在客户端启动时自动迁移到对应普通路径。直接刷新 `/draw`、`/api-config` 等路径由 Next.js catch-all 页面兜底进入同一个应用入口。

### 数据库存储实现

主要文件：

- `app/utils/server/postgres.ts`
- `app/utils/server/auth.ts`
- `app/utils/server/chat-conversation-repository.ts`
- `app/utils/server/provider-config-repository.ts`
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
- `sync_secrets`：同步敏感 payload 密文。
- `site_access_settings`：站点访问密码哈希。

### 模型同步实现

主要文件：

- `app/utils/server/provider-model-fetch.ts`
- `app/utils/server/provider-model-sync.ts`
- `app/utils/provider-sync.ts`
- `app/store/model-cache.ts`
- `scripts/sync-models-to-postgres.ts`
- `scripts/refresh-provider-models.ts`

实现方式：

- 服务端按 Provider 拉取模型列表。
- 前端以本地缓存优先，必要时触发刷新。
- 数据库存储供应商配置和模型缓存状态。
- 空的历史模型目录表已清理，当前以运行时代码和 `docs/db/nextchat-postgres-schema.sql` 为准。

### 部署实现

本地开发使用 Docker `dev` profile：

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev logs -f nextchat-dev
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
- 旧本地数据库开发说明：[docs/local-dev-guide.md](docs/local-dev-guide.md)（仅作历史参考，默认不要使用 `local-db`）

### 部署相关

- 部署入口：[DEPLOY.md](DEPLOY.md)
- 宝塔当前线上说明：[README_BAOTA.md](README_BAOTA.md)
- 宝塔详细 Runbook：[docs/baota-chat-dyxcloud-runbook.md](docs/baota-chat-dyxcloud-runbook.md)
- 宝塔安装说明：[docs/BAOTA_INSTALL_GUIDE.md](docs/BAOTA_INSTALL_GUIDE.md)
- 宝塔 Docker 指南：[docs/baota-docker-guide.md](docs/baota-docker-guide.md)

### 功能与维护

- 用户手册：[docs/user-manual-cn.md](docs/user-manual-cn.md)
- 常见问题：[docs/faq-cn.md](docs/faq-cn.md)
- 聊天记录同步说明：[docs/synchronise-chat-logs-cn.md](docs/synchronise-chat-logs-cn.md)
- 数据库存储矩阵：[docs/db/data-storage-sync-matrix.md](docs/db/data-storage-sync-matrix.md)
- 模型刷新说明：[docs/db/provider-model-auto-refresh.md](docs/db/provider-model-auto-refresh.md)
- 翻译说明：[docs/translation.md](docs/translation.md)

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
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev logs -f nextchat-dev
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
ssh ss 'tmux new-session -d -s nextchat-baota-deploy "cd /www/dk_project/my_NextChat && git pull --ff-only && export BUILDX_CONFIG=/tmp/nextchat-docker-buildx && mkdir -p /tmp/nextchat-docker-buildx && docker compose -f docker-compose.baota.yml --env-file .env.baota build nextchat && docker compose -f docker-compose.baota.yml --env-file .env.baota up -d nextchat 2>&1 | tee /tmp/nextchat-baota-deploy.log"'
ssh ss 'tmux capture-pane -t nextchat-baota-deploy -p -S -120'
```
