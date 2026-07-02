# NextChat 开发指南

本文档按当前代码整理（2026-07-02）。开发时以本页、[README.md](../README.md)、[docs/db/data-storage-sync-matrix.md](db/data-storage-sync-matrix.md) 和部署文档为准；历史审计、修复总结类文档只作为背景材料。

## 1. 技术栈与运行形态

- 框架：Next.js 14 App Router + React 18 + TypeScript。
- 样式：SCSS Modules，组件样式和业务组件同目录维护。
- 状态：Zustand 持久化 store，业务工作副本主要落在 IndexedDB。
- 服务端：Next.js Route Handler / API Route，运行时统一使用 `nodejs`，需要数据库的接口通过 `pg` 访问 PostgreSQL。
- 数据库：PostgreSQL 作为云端共享副本、认证、配置密文、聊天规范化表和文件/图片二进制存储。
- 包管理：Yarn 1.x；生产构建优先使用仓库内置 `vendor/rt-client-0.5.0.tgz`。
- 部署：本地开发使用 Docker `dev` profile；线上默认宝塔 DockerSite + `docker-compose.baota.yml` + `.env.baota`。

## 2. 目录结构

```text
app/
├── page.tsx                  # 服务端入口：站点密码/登录 session 门禁后渲染 HomeEntry
├── [...path]/page.tsx        # 普通路径刷新兜底，复用 app/page.tsx
├── api/                      # Next.js 服务端 API、供应商代理、认证、数据库同步
├── client/                   # 模型调用抽象和各供应商客户端
├── components/               # 页面、业务组件、绘图、实时语音、MCP、UI 组件
├── config/                   # 构建/客户端/服务端配置读取和 provider 图标
├── locales/                  # 多语言文案
├── mcp/                      # MCP 工具初始化、动作执行、类型
├── store/                    # Zustand store：聊天、配置、Access、绘图、Prompt 等
└── utils/                    # 同步、本地存储、模型、服务端 repository、工具函数
```

服务端 repository 集中在 `app/utils/server/`：

- `postgres.ts`：连接池、重试、运行时建表/迁移。
- `auth.ts`：用户、登录 session、管理员切换用户。
- `sync-store-repository.ts`：store 快照读写与分发。
- `chat-conversation-repository.ts`：聊天会话规范化到 `conversations` / `messages`。
- `provider-config-repository.ts`：API Profile、供应商配置和 API Key 拆表保存。
- `draw-store-repository.ts` / `draw-image-repository.ts`：绘图任务与图片二进制。
- `cache-file-repository.ts`：上传文件缓存与内容去重。
- `api-config-backup-repository.ts`：API 配置自动/手动备份。

## 3. 前端架构

### 3.1 页面与路由

客户端路由在 `app/components/home.tsx` 中由 `react-router-dom` 管理，统一使用普通路径，不再新增 hash 路由：

- `/`、`/chat`、`/chat/:id`：聊天主界面。
- `/draw`、`/draw/history`：绘图与历史。
- `/api-config`、`/api-config/backups`：供应商/API Profile 配置和备份。
- `/settings`、`/plugins`、`/mcp-market`、`/prompt-manager`、`/artifacts`、`/search-chat` 等业务页面。

`app/[...path]/page.tsx` 兜底所有普通路径刷新，旧 `/#/...` 地址在客户端启动时迁移到普通路径。

### 3.2 启动与鉴权

1. `app/page.tsx` 在服务端读取 cookie。
2. 如果 `NEXTCHAT_DISABLE_AUTH=true/1`，直接进入应用；本地 dev 默认临时使用该模式并映射到 `ccc` 用户。
3. 正常模式先检查站点访问/登录 session；没有 session 时渲染 `SitePasswordGate`。
4. 登录相关接口位于 `app/api/auth/*`；管理员可通过 `app/api/admin/*` 管理/切换有效用户。
5. 客户端进入应用后由 `useAuthStore` 和 `/api/auth/me` 做最终用户态同步。

生产和宝塔环境不要写入 `NEXTCHAT_DISABLE_AUTH=true`。

### 3.3 状态与本地持久化

- 主要 store：`chat`、`chat-index`、`access`、`config`、`model-cache`、`draw`、`plugin`、`prompt`、`sync`、`update`。
- 业务工作副本使用 `indexedDbStateStorage`，库名为 `nextchat-local-cache`。
- 聊天 store 使用拆分持久化：索引写入 `chat-next-web-store::user::<user>::index`，单会话写入 `chat-next-web-store::user::<user>::session::<id>`。
- 首屏只加载当前会话和少量最近会话，其余会话以摘要占位，进入会话时再按需 hydrate。
- `localStorage` 只保存设备级偏好、草稿和少量启动标记，如 `lang`、`sidebarWidth`、`unfinished-input-*`。

### 3.4 聊天核心逻辑

- `app/components/chat.tsx` 负责消息列表、输入、流式输出、移动端滚动和快捷操作。
- `app/store/chat.ts` 负责会话增删改、发送消息、上下文裁剪、摘要、MCP 工具调用、自动命名、同步触发。
- `app/client/api.ts` 和 `app/client/platforms/*` 根据当前模型/provider 选择运行时客户端。
- 模型参数发送前会经过 `app/client/model-parameter-rules.ts` 按能力清理，避免向不支持的模型发送无效参数。
- 流式输出通过 `ChatControllerPool` 管理 abort controller；移动端用户上滑会暂停自动贴底。
- 长会话渲染依赖会话摘要、虚拟窗口和按需 hydrate，避免一次性读取/渲染全部历史。

### 3.5 模型、供应商和 API 配置

- `access-control` store 保存 API Profiles 的前端状态。
- 保存到数据库时，Profile 结构化字段写入 `provider_configs`，密钥写入 `provider_api_keys` / `sync_secrets`，公开快照写入 `app_settings.security_settings`。
- 模型缓存不再写入独立模型目录表；刷新后回写 `access-control.apiProfiles[*].cachedModels`。
- 模型获取入口：页面按钮、`/api/db/models/refresh`、`yarn db:refresh-provider-models`。
- API 配置保存会触发自动备份，备份表为 `api_config_backups`，设置表为 `api_config_backup_settings`。

### 3.6 绘图、上传文件和媒体

- 绘图页面在 `app/components/draw/`，参数规则在 `app/utils/draw-model-params.ts`。
- 绘图历史 store key 是 `draw-list`，任务元数据存在 `user_draw_stores.payload_json`。
- 绘图原图和缩略图存在 `user_draw_images.data/thumb_data`，按 `md5(data)` 去重。
- 上传/缓存文件通过 `/api/cache/*` 写入 `cache_file_blobs` 与 `user_cache_files`；blob 按内容 MD5 去重，用户文件记录可设置过期和 pinned。

## 4. 后端 API 架构

### 4.1 API 分层

- 供应商代理：`app/api/openai.ts`、`anthropic.ts`、`google.ts`、`deepseek.ts` 等旧式 API 文件，以及 `app/api/[provider]/[...path]/route.ts` 动态代理。
- 配置与运行态：`/api/config` 返回非敏感运行配置；禁止在此暴露密钥。
- 认证：`/api/auth/login`、`/api/auth/logout`、`/api/auth/me`、`/api/site-auth`。
- 数据同步：`/api/db/sync/[key]`、`/api/db/chat-sync`、`/api/db/chat-sync/sessions`、`/api/db/sync-meta`。
- 维护：`/api/db/health`、`/api/db/models/refresh`、`/api/db/api-config-backups`。
- 文件与 Artifacts：`/api/cache/*`、`/api/artifacts`。

### 4.2 数据同步逻辑

- 通用 store 通过 `/api/db/sync/[key]` GET/PUT/DELETE 同步，写入前会校验 `x-expected-updated-at` / `x-expected-checksum`，冲突时返回 `snapshot_conflict`。
- 聊天数据使用专用增量接口 `/api/db/chat-sync`：索引写入 `app_settings.chat_settings['__chat-index-state__']`，会话正文拆到 `conversations` 和 `messages`。
- 会话正文下载使用 `/api/db/chat-sync/sessions` 按 ID 批量获取，避免首屏一次拉取全部消息。
- 自动同步范围由 `app/utils/sync-store-keys.ts` 定义：聊天/首页优先同步 Access 和 Config；Prompt 是全站共享数据，不参与后台双向自动同步。
- PostgreSQL 暂不可用时，部分 GET 接口会降级返回空结果并带 `degraded` 或 `X-NextChat-Degraded`，避免页面直接崩溃。

### 4.3 数据库与 schema

`ensureSyncStorageSchema()`、`ensureAuthSchemaAndSeed()` 和 `ensureSitePasswordConfigured()` 会在运行时自动创建/补齐表结构。当前同步 schema 版本为 `2026-06-28-api-config-backup-counts`，认证 schema 版本为 `2026-06-11-auth-last-chat`。

主要表：

- 用户认证：`app_users`、`auth_sessions`、`site_access_settings`。
- Store 快照：`app_settings` 的 `chat_settings`、`plugin_settings`、`security_settings`、`extra_settings`。
- 聊天规范化：`conversations`、`messages`。
- 供应商配置：`provider_configs`、`provider_api_keys`、`sync_secrets`。
- 绘图与文件：`user_draw_stores`、`user_draw_images`、`cache_file_blobs`、`user_cache_files`。
- API 配置备份：`api_config_backup_settings`、`api_config_backups`。

完整映射见 [docs/db/data-storage-sync-matrix.md](db/data-storage-sync-matrix.md)，SQL 参考见 [docs/db/nextchat-postgres-schema.sql](db/nextchat-postgres-schema.sql)。

## 5. 本地 Docker 热加载开发

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile ssh-tunnel up -d --build postgres-ssh-tunnel
NEXTCHAT_DISABLE_AUTH=true NEXTCHAT_LOCAL_BYPASS_USER=ccc PGHOST=postgres-ssh-tunnel PGPORT=5432 SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel logs -f nextchat-dev
```

访问：<http://localhost:3000>

停止：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev down
```

热加载规则：

- 普通业务代码修改后依赖 `next dev` 热加载，不要重启容器，不要重新构建镜像。
- 只有 `package.json`、`yarn.lock`、`Dockerfile` 变更时，才重新 build。
- `WATCHPACK_POLLING` 和 `CHOKIDAR_USEPOLLING` 默认保持 `false`，只有文件监听异常时才开启。

## 6. 环境变量要点

- 数据库：优先设置 `DATABASE_URL`，或设置 `PGHOST`、`PGPORT`、`PGDATABASE`、`PGUSER`、`PGPASSWORD`。
- 连接池：`PGPOOL_MAX`、`PG_CONNECT_TIMEOUT_MS`、`PG_IDLE_TIMEOUT_MS`。
- 认证：`NEXTCHAT_ADMIN_USERNAME`、`NEXTCHAT_ADMIN_PASSWORD`、`NEXTCHAT_DISABLE_AUTH`、`NEXTCHAT_LOCAL_BYPASS_USER`。
- 同步默认用户：`NEXTCHAT_DEFAULT_USER_ID`、`DEFAULT_SYNC_USER_ID`、`NEXT_PUBLIC_DEFAULT_SYNC_USER_ID` 必须保持一致。
- 模型刷新保护：`MODEL_SYNC_TOKEN` 设置后，调用 `/api/db/models/refresh` 需要 `Authorization: Bearer <token>`。
- 国内/离线运行：默认关闭 `ENABLE_GOOGLE_FONTS`、`ENABLE_SHAREGPT`、`ENABLE_MCP`、`ENABLE_EDGE_TTS`，除非明确需要。

不要提交真实 `.env`、API Key、数据库密码或生产 cookie。

## 7. 质量检查

```bash
yarn lint
yarn build
npx tsc --noEmit --pretty false
```

说明：仓库已移除 Jest 配置和 `test/` 目录，不再默认使用 `yarn test` / `yarn test:ci`。

## 8. 开发注意事项

- 修改 API Profile 或密钥逻辑时，同时检查 `access-control` store、`provider-config-repository.ts`、备份页面和同步文档。
- 修改聊天数据结构时，同时检查拆分持久化、`chat-sync.ts`、`chat-conversation-repository.ts` 和数据矩阵。
- 修改绘图或上传文件时，同时检查 `user_draw_images`、`cache_file_blobs`、持久化和备份说明。
- 修改路由时保持普通路径，并确认直接刷新路径可由 catch-all 进入应用。
- 移动端聊天滚动约定：流式输出中轻微上滑暂停贴底；点击空白不回到底部；回到底部按钮使用两帧滚动；Token 用量行允许换行。

## 9. 部署文档入口

- Docker 部署与本地开发：[docs/docker-deploy-cn.md](docker-deploy-cn.md)
- 宝塔部署权威说明：[README_BAOTA.md](../README_BAOTA.md)
- 宝塔详细 Runbook：[docs/baota-chat-dyxcloud-runbook.md](baota-chat-dyxcloud-runbook.md)
- 部署入口与统一规则：[DEPLOY.md](../DEPLOY.md)
