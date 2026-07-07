# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working on code in this repository.

## 项目概述

NextChat 是一个基于 Next.js 14 的跨平台 AI 聊天应用（当前版本 `2.16.1`），支持 18 个 AI 服务提供商，可作为 Web 应用（PWA）、Tauri 桌面应用运行。除对话外，还内置**绘画（AI 绘图）**、**实时语音对话**、**声纹**、**MCP 工具调用**、**插件**、**Artifacts** 等功能。

技术栈：Next.js 14 + React 18 + TypeScript 5.6 + Zustand 4 + PostgreSQL（`pg`），路由基于 `react-router-dom`，样式使用 SCSS + CSS Modules。

## 数据库连接规范

**⚠️ 重要：本项目永远连接远程数据库，不使用本地 Docker PostgreSQL 容器作为数据存储。**

### 连接方式

应用通过 SSH 隧道连接远程数据库（42.193.15.117）：

```
本地应用 → host.docker.internal:15432 → SSH 隧道 → 远程数据库:5432
```

### 数据库规范

- ✅ **本地开发**：通过 SSH 隧道连接远程数据库
- ❌ **禁止使用**：本地 Docker PostgreSQL 容器（`--profile local-db`）
- ✅ **远程服务器部署**：直接连接本地数据库（localhost:5432）

### 开发前必须操作

启动应用前，必须先建立 SSH 隧道：

```bash
ssh -f -N -L 15432:127.0.0.1:5432 root@42.193.15.117 -p 222
```

详细说明请参考 [docs/development.md](./docs/development.md)

## Git 提交规范

**⚠️ 重要：只有用户明确说"提交"时才执行 git commit 和 push。**

### 提交规则

1. **不主动提交**

   - 开发过程中不自动提交代码
   - 完成修改后不主动提交
   - 只有当用户明确说"提交"、"commit"、"提交代码"等明确指令时才执行提交

2. **提交后自动推送**

   - 执行 `git commit` 后自动执行 `git push`
   - 确保本地提交同步到远程仓库

3. **提交信息格式**
   ```
   YYYY-MM-DD HH:MM 提交内容描述
   ```

### 提交流程

当用户说"提交"时：

```bash
# 1. 暂存所有修改
git add -A

# 2. 创建提交（使用规范格式）
git commit -m "$(cat <<'EOF'
2026-05-15 10:30 提交内容描述

详细说明（可选）

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"

# 3. 推送到远程
git push
```

### 示例对话

**错误示例（不要这样做）：**

```
用户: "修改完成了"
助手: [自动执行 git commit] ❌ 错误！
```

**正确示例：**

```
用户: "修改完成了"
助手: "修改已完成。" ✅ 正确，不提交

用户: "提交"
助手: [执行 git add、git commit、git push] ✅ 正确
```

## 常用命令

### 开发

**⚠️ 重要：本地开发必须使用 Docker 热加载模式，禁止直接使用 `yarn dev`。**

默认使用 `dev` profile 和 `scripts/docker-compose-safe.sh`。普通业务代码修改后依赖热加载，不要重启容器、不要重新构建镜像。

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile ssh-tunnel up -d --build postgres-ssh-tunnel
NEXTCHAT_DISABLE_AUTH=true NEXTCHAT_LOCAL_BYPASS_USER=ccc PGHOST=postgres-ssh-tunnel PGPORT=5432 SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel logs -f nextchat-dev

# Tauri 桌面应用开发（例外，不走 Docker）
yarn app:dev
```

停止开发环境：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev down
```

常用页面：

- 聊天页：`/chat`
- 绘图页：`/draw`、绘图历史：`/draw/history`
- API 配置：`/api_config`

### 构建

```bash
# 构建 Web 应用（standalone 模式）
yarn build

# 构建静态导出
yarn export

# 构建 Tauri 桌面应用
yarn app:build
```

### 测试与质量

```bash
# 代码检查
yarn lint

# 类型检查（当前会受 tsconfig 的 moduleResolution=node10 废弃提示影响）
npx tsc --noEmit --pretty false

# 生产构建
yarn build
```

说明：本仓库已移除 Jest 配置、`test/` 目录和 `yarn test` / `yarn test:ci` 脚本，不要再把它们作为默认验证命令。`devDependencies` 中仍残留 `jest` / `@testing-library/*` 相关包但无对应配置和脚本，不可直接运行测试。

补充约定：后续浏览器手工测试、回归测试默认切换到 `ccc` 用户后再执行，除非用户明确指定其他账号。

### 数据库与模型维护脚本

通过 `tsx` 运行（`scripts/` 目录），改动数据库前务必先确认影响范围：

```bash
# 数据库健康检查
yarn db:health

# 模型同步与维护
yarn models:published-at          # 维护模型发布时间
yarn db:sync-models               # 同步模型到 PostgreSQL
yarn db:refresh-provider-models   # 刷新各提供商模型列表

# 迁移脚本（一般只执行一次）
yarn db:migrate-chat-store        # 旧 chat store 迁移到 conversations
yarn db:migrate-draw-store        # 迁移绘画存储
yarn db:migrate-sync-artifacts    # sync artifacts 迁移到独立表

# 清理脚本（⚠️ 高风险，执行前确认）
yarn db:cleanup-legacy-chat-store
yarn db:cleanup-legacy-sync-storage
yarn db:drop-unused-tables
yarn db:purge-keep-provider-configs
yarn db:unify-user-id
yarn db:seed-chat-performance     # 性能压测数据填充
```

### 其他

```bash
# 获取 prompts
yarn prompts
```

## 架构概览

### 路由约定

- 使用 `react-router-dom`，URL 为**普通路径**（如 `/chat`、`/draw`），不再新增 `/#/...` hash 链接。
- 旧 hash 地址在客户端启动时自动迁移到普通路径。
- 服务端通过 `app/[...path]/page.tsx` catch-all 渲染，直接刷新 `/draw`、`/api_config` 等页面应正常进入应用。

### 状态管理（Zustand + Persist）

项目使用 Zustand 进行状态管理，配合自定义持久化存储。需要持久化的 store 在 `app/constant.ts` 的 `StoreKey` 注册（`Chat`/`Plugin`/`Access`/`Config`/`ModelCache`/`Prompt`/`Update`/`Sync`/`DrawList`/`Mcp`），store 实现位于 `app/store/`：

| Store | 文件 | 职责 |
| --- | --- | --- |
| Chat | `chat.ts` | 核心聊天状态（会话、消息、记忆压缩、附件） |
| Config | `config.ts` | 应用配置（模型、主题、TTS、实时语音） |
| Access | `access.ts` | API 访问控制（API Key、访问码、多 Key 配置） |
| Auth | `auth.ts` | 用户认证状态（登录态、当前用户） |
| DrawList | `draw.ts` | 绘画任务与历史 |
| Mask | `mask.ts` | Prompt 模板（Masks） |
| Prompt | `prompt.ts` | 自定义 Prompt |
| ModelCache | `model-cache.ts` | 模型列表缓存 |
| Sync | `sync.ts` | 聊天记录与配置同步（Database/WebDAV 等） |
| Plugin | `plugin.ts` | 插件 |
| Mcp | — | MCP 工具（`app/mcp/`，非持久化 store） |
| Update | `update.ts` | 版本更新 |

聊天 store 进一步拆分为辅助模块（非独立 store）：`chat-defaults.ts`、`chat-index.ts`、`chat-session.ts`。

### 存储架构

项目使用双层存储：

1. **PostgreSQL** - 主要业务存储
   - 通过 `app/utils/server/postgres.ts` 的全局连接池（`global.__nextchatPostgresPool`）访问，含连接异常重试。
   - 存储对话、配置、Prompt、Mask、插件、模型同步快照、绘画任务与图片、用户与认证等核心数据。
   - 表结构由代码按 Schema 版本（`SYNC_STORAGE_SCHEMA_VERSION`，当前 `2026-07-06-chat-backups`）自动初始化/迁移。

2. **localStorage** - 纯本地偏好存储
   - 存储语言、页面宽度、横幅关闭状态、临时输入草稿等设备级状态。
   - 持久化封装见 `app/utils/store.ts`（`createPersistStore`）、`app/utils/database-state-storage.ts`、`indexeddb-state-storage.ts`。

### 数据库 Repository 层（服务端）

`app/utils/server/` 是所有服务端数据访问的统一入口（Repository 模式），**新增/修改数据库逻辑应优先复用这里的封装**，避免直接写裸 SQL：

- `postgres.ts` - 连接池、重试、Schema 版本管理
- `chat-conversation-repository.ts` - 对话与会话
- `chat-backup-repository.ts` - 按用户区分的对话增量备份、在线查看、删除和单会话合并恢复
- `draw-image-repository.ts` / `draw-store-repository.ts` - 绘画图片与任务
- `sync-store-repository.ts` / `sync-store-helpers.ts` / `sync-meta-loader.ts` - 同步键值存储与元数据
- `provider-config-repository.ts` - 提供商配置
- `provider-model-fetch.ts` / `provider-model-sync.ts` - 提供商模型拉取与同步
- `provider-balance-repository.ts` / `provider-balance.ts` - 供应商余额快照、管理 API Key 密文存取与上游探测
- `app-settings-repository.ts` - 应用设置
- `api-config-backup-repository.ts` / `api-config-backup-scheduler.ts` - API 配置自动备份与恢复（含余额条目；新备份写单层 state，历史双层 Zustand 持久化 state 兼容读取）
- `sync-app-user.ts` / `sync-user.ts` / `auth.ts` / `site-password.ts` - 用户与认证
- `access-store-security.ts` / `sync-secrets.ts` - 访问安全与密钥

### API 路由

服务端路由位于 `app/api/`：

- `[provider]/[...path]` - **AI 提供商代理**（核心聊天/补全/图像转发）
- `proxy/[...path]` - 通用代理
- `db/` - 数据库同步接口
  - `sync/[key]` - 通用键值同步（对话/配置等），access-control 写入会触发 API 配置自动备份
  - `chat-sync`（含 `sessions`）、`chat-updated-at` - 对话同步
  - `chat-backups` - 对话增量备份、全用户一键备份、按用户切换查看备份内容、删除备份/快照和单会话合并恢复
  - `draw-image`（含 `[id]`） - 绘画图片存取（含缩略图）
  - `provider-balance` - 供应商余额查询（GET 列表 / PUT 管理 API Key / POST 单次查询）
  - `api-config-backups` - API 配置备份与恢复（含供应商余额条目）
  - `sync-meta` - 同步元数据、`health` - 健康检查
  - `models/refresh` - 模型刷新、`balance` - 余额查询
- `auth/` - 登录（`login`）、登出（`logout`）、当前用户（`me`）
- `admin/` - 用户管理（`users`）、切换用户（`switch-user`）
- `site-auth` - 站点访问密码
- `config` - 客户端配置下发
- 聚合模型元数据服务：`aihubmix`、`ocoolai`、`toapis`、`yuto`、`tencent`
- `webhook/sync-models` - 模型同步 webhook
- `model-probe` - 模型探测、`artifacts` - Artifacts

### API 客户端架构

多服务提供商抽象层，路由入口在 `app/client/api.ts` 的 `ClientApi` 类：

- **`app/client/api.ts`** - `ClientApi`，根据 `ServiceProvider` 路由到具体平台实现，含 `getBearerToken` 等通用工具。
- **`app/client/controller.ts`** - 请求流程控制器。
- **`app/client/model-capability.ts`** / **`model-parameter-rules.ts`** - 模型能力与参数规则。
- **`app/client/openai-media-utils.ts`** - 多模态/媒体处理。

各平台实现位于 `app/client/platforms/`，实现统一的 `chat()`、`speech()`、`usage()`、`models()` 等方法：

| 文件 | 提供商 |
| --- | --- |
| `openai.ts` | OpenAI / Azure / 兼容协议 |
| `anthropic.ts` | Claude |
| `google.ts` | Gemini |
| `deepseek.ts` | DeepSeek |
| `glm.ts` | 智谱 ChatGLM |
| `alibaba.ts` | 通义千问 |
| `bytedance.ts` | 豆包 |
| `baidu.ts` | 文心一言 |
| `tencent.ts` | 腾讯混元 |
| `moonshot.ts` | 月之暗面 |
| `iflytek.ts` | 讯飞星火 |
| `siliconflow.ts` | 硅基流动 |
| `xai.ts` | Grok (xAI) |
| `ai302.ts` | 302.AI |
| `local.ts` | 本地模型 |

新增平台：在 `app/constant.ts` 的 `ServiceProvider` 添加枚举，在 `platforms/` 新建实现，并在 `ClientApi` 构造函数中添加对应 case。

### 绘画系统

- **`app/store/draw.ts`** - 绘画任务状态与历史。
- **`app/components/draw/`** - 绘画 UI：`draw-panel.tsx`（参数面板）、`draw-sidebar.tsx`、`draw.tsx`（主界面）、`index.tsx`。
- **`app/api/db/draw-image/`** - 绘画图片服务端存储（原图 + `?thumb=1` 缩略图）。
- **`app/utils/draw-model-params.ts`** - 绘画模型参数归一化（尺寸、质量、DashScope 适配等）。
- 支持的绘画协议：OpenAI 兼容图像接口（`v1/images/generations`，覆盖通义万相、即梦、智谱、SiliconFlow 等）与 Stability。
- 路由：`/draw`（绘图）、`/draw/history`（历史）。
- 数据库迁移：`yarn db:migrate-draw-store`。

### 认证与多用户

- **`app/store/auth.ts`** - 登录态、当前用户。
- **`app/api/auth/`**（login/logout/me）、**`app/api/admin/`**（用户管理/切换）、**`app/api/site-auth`**（站点访问密码）。
- **`app/utils/server/`**：`auth.ts`、`site-password.ts`、`sync-app-user.ts`、`sync-user.ts`。
- 组件：`app/components/auth.tsx`、`site-password-gate.tsx`、`user-menu.tsx`。

### 余额查询与 API 配置备份

- **入口页面**：API 配置为 `/api_config`，API 配置备份为 `/backup/api_config`，余额查询为 `/balances`，均从对话页顶部统一「配置管理」按钮的悬停菜单进入。
- **核心代码**：
  - `app/utils/server/provider-balance.ts` - 服务端余额查询核心，按「前缀 × 资源」组合探测上游接口，保留每次探测的 `attempts`。
  - `app/utils/server/provider-balance-repository.ts` - 余额快照、查询时间戳、错误信息、加密管理 API Key（`encrypted_management_key` / `masked_management_key`）。
  - `app/utils/provider-balance.ts` - 前端请求 SDK，统一打印请求 ID、耗时与上游路径日志。
  - `app/api/db/provider-balance/route.ts` - `GET`（列表）、`PUT`（保存管理 Key，密文落库）、`POST`（单次查询）。
  - `app/components/provider-balances.tsx` - 余额查询页面。
- **数据库表**：`provider_balance_configs`，按 `provider_configs.id` 一对一关联；密文管理 Key 通过 `sync-secrets.ts` 加密。
- **API 配置备份包含余额条目**：API 配置自动备份 / 手动备份 / 恢复前保护备份都会把当前用户的 `provider_balance_configs` 一并打包进 `payload_json.balanceEntries`（payload schema 版本 = 2），恢复时按 `provider_code` 解析回 `provider_configs.id` 后写回。旧备份（无 `balanceEntries`）仍然兼容，只恢复 access-control；新备份统一写单层 `payload_json.state.apiProfiles`，历史双层 `payload_json.state.state.apiProfiles` 仍保持计数和恢复兼容。
- **实现位置**：`app/utils/server/api-config-backup-repository.ts`（`buildApiConfigBackupPayload` / `writeApiConfigBalanceEntries`）、`app/api/db/api-config-backups/route.ts`、`app/api/db/sync/[key]/route.ts`（access-control PUT 时自动备份）、`app/utils/server/api-config-backup-scheduler.ts`（后台定时备份）。
- **对话记录备份落点**：对话已经拆成 `app_settings.chat_settings.__chat-index-state__`、`conversations` 和 `messages`。站内对话备份已使用独立的 `chat_backup_settings` / `chat_backup_runs` / `chat_backup_conversation_snapshots`，不要塞进 `api_config_backups`。生产灾备继续以 PostgreSQL `pg_dump` / 宝塔计划任务备份为准。

### 对话增量备份

- **入口页面**：`/backup/chat`，从对话页顶部「配置管理」按钮的悬停菜单进入。
- **用户隔离**：所有备份按用户写入 `app_users.id`，本地免登录默认是 `ccc`。页面点击「立即备份」会为所有启用用户逐个创建增量备份；用户下拉框只控制下方历史查看和单会话恢复目标。生产环境仅管理员或本地免登录模式可执行全用户备份，普通用户只能操作自身可写数据。
- **增量策略**：以最近一次成功备份的 `to_watermark` 为起点，收录 `conversations.updated_at` 或关联 `messages.updated_at` 之后有变化的会话；每个被收录的会话保存完整 `session_payload`，包括软删除会话，便于在线查看和恢复已删除对话。
- **查看、删除与恢复**：历史会话默认只显示标题和会话信息，点击后展开消息内容，再次点击收起。可删除整次备份记录，也可删除某次备份中的单个会话快照。单会话恢复是合并模式：恢复时会把该会话标记为可见并写回备份中的消息，但不会裁剪当前库里已有的更多消息，也不会删除其他会话。
- **数据库表**：`chat_backup_settings`、`chat_backup_runs`、`chat_backup_conversation_snapshots`。这些表只服务站内恢复；生产灾备仍以 PostgreSQL `pg_dump` / 宝塔计划任务备份为准。
- **实现位置**：`app/utils/server/chat-backup-repository.ts`、`app/api/db/chat-backups/route.ts`、`app/components/chat-backups.tsx`。

### 模型管理

围绕模型列表的获取、分类、能力判定、自动同步：

- 缓存 store：`app/store/model-cache.ts`。
- 工具：`app/utils/model*.ts`（`model.ts`、`models.ts`、`model-capabilities.ts`、`model-classification.ts`、`model-category-rules.ts`、`model-pool.ts`、`model-provider.ts`、`model-sync-diff.ts`、`model-selector-provider.ts`、`model-published-at.ts`、`auto-model.ts`、`managed-model-rebuild.ts`、`manual-model-selection.ts`、`manual-sync-guard.ts`、`useModelFetcher.ts`）。
- 聚合元数据服务：`aihubmix.ts`、`tencent.ts`、`baidu.ts`、`cloudflare.ts` 等。
- 服务端同步：`app/utils/server/provider-model-sync.ts`。

### 多 API Key 管理

- **`app/utils/multi-key.ts`** - 多 Key 轮询与失败切换。
- **`app/utils/model-api-key-memory.ts`** - 记忆可用 Key 分组。
- **`app/utils/access-profiles.ts`** / **`access-snapshot.ts`** - 访问配置多档位。

### 关键组件

位于 `app/components/`：

- **聊天**：`chat.tsx`（主界面）、`chat-list.tsx`、`chat.module.scss`、`search-chat.tsx`、`new-chat.tsx`。
- **侧边栏**：`sidebar.tsx`、`sidebar-context.ts`。
- **设置/配置**：`settings.tsx`、`api-config.tsx`、`model-config.tsx`、`add-model-modal.tsx`、`tts-config.tsx`。
- **Mask**：`mask.tsx`；**Artifacts**：`artifacts.tsx`；**导出**：`exporter.tsx`、`message-selector.tsx`。
- **插件/MCP**：`plugin.tsx`、`mcp-market.tsx`。
- **绘画**：`draw/`；**实时语音**：`realtime-chat/`；**声纹**：`voice-print/`。
- **首页/用户**：`home.tsx`、`home-entry.tsx`、`user-menu.tsx`、`auto-sync.tsx`。
- **通用 UI**：`ui-lib.tsx`、`button.tsx`、`input-range.tsx`、`emoji.tsx`、`error.tsx`、`markdown.tsx`。

### MCP (Model Context Protocol)

位于 `app/mcp/`：`actions.ts`（动作执行与工具获取）、`client.ts`（客户端管理）、`types.ts`。通过 `ENABLE_MCP` 环境变量启用。

### 插件系统

`app/store/plugin.ts` + `app/components/plugin.tsx`。插件仓库：`https://github.com/ChatGPTNextWeb/NextChat-Awesome-Plugins`。

### 实时聊天与声纹

- **实时语音**：`app/components/realtime-chat/`，基于 Azure Realtime Audio SDK（`rt-client`，`vendor/rt-client-0.5.0.tgz`），配置在 `app/store/config.ts` 的 `realtimeConfig`。
- **声纹**：`app/components/voice-print/`，音频工具 `app/lib/audio.ts`、`app/utils/audio.ts`。

### Tauri 桌面应用

桌面相关代码在 `src-tauri/`，使用 Tauri 1.x API（`@tauri-apps/api` v2）。

## 当前聊天 UI 注意事项

- 移动端流式输出时，用户轻微上滑应立即暂停自动贴底，不需要大幅滑动。
- 点击页面空白只负责收起输入焦点，不应触发自动回到底部。
- "回到底部"按钮采用类似点击标题滚到顶部的两帧滚动方式，避免虚拟消息窗口切换时出现大块空白。
- 点击标题滚到顶部时，即使正在流式输出，也必须暂停自动贴底。
- Token 用量行允许自动换行，窄屏或文本过长时不能撑破消息宽度。

## 清理规则

- 不提交临时调试文件、历史 `.bak` 文件、截图/浏览器误生成的空 `div*` 文件。
- 不提交一次性测试文件；如需验证，优先使用针对性脚本并在完成后清理。
- 当前仓库不维护 Jest 测试目录，相关文档不要再引用 `test/`、`jest.config.ts`、`jest.setup.ts`。

## 环境变量

关键环境变量（见 `.env.template` / `.env.docker.example`，服务端类型定义在 `app/config/server.ts`）：

- **访问控制**：`CODE`（访问密码，逗号分隔多个）、`HIDE_USER_API_KEY`
- **OpenAI**：`OPENAI_API_KEY`、`BASE_URL`、`OPENAI_ORG_ID`
- **数据库（PostgreSQL）**：`DATABASE_URL` 或 `PGHOST`/`PGPORT`/`PGDATABASE`/`PGUSER`/`PGPASSWORD`/`PGSSL`/`PGSSLMODE`，连接池/超时：`PGPOOL_MAX`、`PG_CONNECT_TIMEOUT_MS`、`PG_IDLE_TIMEOUT_MS`，重试：`PG_RETRY_COUNT`
- **各提供商密钥**：`ANTHROPIC_API_KEY`、`GOOGLE_API_KEY`、`AZURE_API_KEY`、`BAIDU_*`、`STABILITY_API_KEY` 等
- **功能开关**：`ENABLE_MCP`（MCP）
- **模型**：`CUSTOM_MODELS`、`DEFAULT_MODEL`、`VISION_MODELS`、`DISABLE_GPT4`
- **构建/部署**：`BUILD_MODE`（standalone/export）、`BUILD_APP`、`PROXY_URL`（docker only）

## 部署

线上默认使用宝塔 DockerSite（详见 [DEPLOY.md](./DEPLOY.md)、[README_BAOTA.md](./README_BAOTA.md)、[docs/baota-chat-dyxcloud-runbook.md](./docs/baota-chat-dyxcloud-runbook.md)）：

- 部署路径：`/www/dk_project/my_NextChat`
- Compose：`docker-compose.baota.yml`，环境变量：`.env.baota`
- 域名：`https://chat.dyxcloud.com`，上游：`http://127.0.0.1:3000`

仓库内 Compose 文件：`docker-compose.yml`（默认）、`docker-compose.baota.yml`（宝塔）、`docker-compose.postgres.yml`。非宝塔部署参考 [docs/docker-deploy-cn.md](./docs/docker-deploy-cn.md)。

## 样式系统

- **SCSS** - 使用 `sass` 包
- **CSS Modules** - `.module.scss` 文件
- **全局样式** - `app/styles/` 目录

## 工具函数

`app/utils/` 关键模块：

- **存储/同步**：`store.ts`、`database-state-storage.ts`、`indexeddb-state-storage.ts`、`sync.ts`、`chat-sync.ts`、`chat-sync-state.ts`、`chat-persist-storage.ts`、`sync-store-keys.ts`、`sync-user-client.ts`、`sync-tab-coordination.ts`
- **聊天**：`chat.ts`、`chat-session-model.ts`、`chat-session-merge.ts`、`new-chat.ts`、`stream.ts`、`token.ts`、`clone.ts`、`merge.ts`
- **模型**：见上文「模型管理」
- **绘画参数**：`draw-model-params.ts`
- **访问/Key**：`access-profiles.ts`、`multi-key.ts`、`model-api-key-memory.ts`
- **服务端**：`app/utils/server/`（见「数据库 Repository 层」）
- **通用**：`object.ts`、`format.ts`、`url.ts`、`hmac.ts`、`logger.ts`、`perf.ts`、`hooks.ts`、`safe-local-storage.ts`

## 构建模式

通过 `BUILD_MODE` 环境变量控制：

- `standalone` - 独立部署模式（默认）
- `export` - 静态导出模式

## 开发注意事项

1. **修改 store 后**：确保更新对应的 `version` 号和 `migrate` 函数（持久化 store）。
2. **修改数据库结构**：更新 `app/utils/server/postgres.ts` 的 `SYNC_STORAGE_SCHEMA_VERSION` 并保证迁移可重复执行；提供迁移/回滚脚本（`scripts/` 下）。
3. **添加新平台 API**：在 `app/constant.ts` 的 `ServiceProvider` 添加枚举，在 `app/client/platforms/` 创建实现，在 `ClientApi` 构造函数添加 case。
4. **新增数据库逻辑**：优先复用 `app/utils/server/` 的 Repository 封装，不直接写裸 SQL。
5. **Mask 系统**：Masks 是 prompt 模板，存储在 `app/masks/` 目录。
6. **国际化**：语言文件在 `app/locales/` 目录（`cn.ts` 为简体中文，`index.ts` 汇总）。
7. **路由**：新增页面用普通路径（`react-router-dom`），不使用 hash 路由；服务端通过 `app/[...path]/page.tsx` catch-all 兜底。

### 每个功能完成后必须立即更新文档

新功能 / 行为变更 / 新页面 / 新增 API / 新增数据库表 / 新增配置项 / 删除 / 重命名，只要会改变使用者或后续 AI 的认知，都必须在「同一轮提交」内同步更新文档，**不允许**只改代码、留下一份过期文档留给下次清理。

需要更新或审视的文档（按优先级）：

1. `README.md`：项目概述、功能概览、页面路由、数据库存储实现、API 路由、文档入口
2. `README_BAOTA.md`、`DEPLOY.md`：仅当变更涉及部署 / 域名 / 路径 / 密钥 / 端口时
3. `docs/development.md`：开发架构、目录结构、API 分层、数据表、注意事项
4. `docs/local-dev-guide.md`：本地启动、调试入口
5. `docs/quality-checklist.md`：质量检查、部署后验证清单
6. `docs/user-admin-guide.md`：多用户 / 登录 / 站点访问 / 用户切换 / 密码
7. `docs/baota-postgres-guide.md`：宝塔 PostgreSQL 安装 / 连接 / 备份 / 还原 / 迁移
8. `docs/baota-dockersite-guide.md`：宝塔 DockerSite 页面操作（建站、反代、SSL、清理、验证）
9. `docs/baota-chat-dyxcloud-runbook.md`、`docs/baota-dockersite-guide.md`、`docs/baota-postgres-guide.md`：宝塔专题 Runbook（域名切换、DockerSite 页面操作、PostgreSQL、SSL 数据库）
10. `docs/db/data-storage-sync-matrix.md`：新增 / 变更数据表或字段必须更新；新增 schema 版本必须同步
11. `docs/db/local-first-sync-rules.md`：存储分层和合并策略变化时
12. `docs/db/postgres-docker-deploy.md`：直连 / 隧道部署与健康检查字段
13. `docs/db/nextchat-postgres-schema.sql`：新增 / 变更表 DDL 必须同步
14. `docs/db/provider-model-auto-refresh.md`：模型刷新链路与触发方式
15. `docs/user-manual-cn.md`、`docs/sync-usage-guide.md`、`docs/yuto-balance-query.md`、`docs/draw-model-parameter-matrix.md` 等功能说明
16. 任何新增或重命名的文档必须在 `README.md` 的「文档入口」中登记

执行要求：

- 完成功能后，**先**在代码 commit 里把对应文档改完，再执行提交；不允许「下次再补」式延期。
- 如果删除了文档或页面，必须在仓库里彻底移除对应文件，并从 README / CLAUDE.md 文档入口清除链接，不保留死链。
- 同步矩阵、PostgreSQL schema 文件、CLAUDE.md 与代码一起视为「一组改动」，schema 版本、文件头注释日期、文档顶部「以代码为准」日期要保持同步。
- 不要为了凑文档而堆模板；只写仍然准确、能帮助未来 AI / 工程师快速理解的内容；过期 / 与代码无关 / 历史审计型文档直接删除而不是保留。
- 提交或部署前必须自检：所有新增 / 修改的功能点是否都有对应文档段落；README 文档入口是否仍然完整。

### 删除操作强制确认规则（本项目层）

**所有删除动作都必须用户单独确认**，不得用「清理过期」「顺手」「按规则」等理由批量执行。完整规则见全局 `~/.claude/CLAUDE.md`（或对应全局 AI md）§16.3，本节只列重点：

例外：当用户明确说出「这次的全部都要」时，必须先完整列出本次剩余删除对象及影响，并再发起一次批量确认；用户确认后，该次确认可覆盖清单内全部对象。此授权仅对当次列出的清单有效。

- **文档 / 脚本 / 配置**：删除 `docs/`、`scripts/`、`*.yml`、`*.json`、`*.ts`、`*.tsx`、`.env*`、`Dockerfile`、`next.config.mjs`、`tsconfig.json`、`package.json`、`yarn.lock`、`.github/**` 等；删除前必须**逐路径列出**让用户确认，**不能批量删除**。
- **数据库 / Schema**：`DROP TABLE / DATABASE`、`TRUNCATE`、`DELETE FROM ... 无 WHERE`、`ALTER TABLE DROP COLUMN / CONSTRAINT`、直接 SQL 修改宝塔数据库（docker.db / site.db / ssl_data.db）；删除前必须打印 SQL + 影响行数 + 备份状态。
- **容器 / 镜像 / 卷 / 网络**：`docker rm / rm -f`、`docker image rm`、`docker volume rm`、`docker network rm`、`docker system prune`；**禁止全局 prune**。
- **构建产物 / 缓存**：`rm -rf .next / dist / build / node_modules`、`yarn cache clean`、`docker builder prune`。
- **Git stash / branch / tag / reflog**：`git stash drop`、`git branch -D`、`git tag -d`、`git reflog expire --expire=now --all`、`git filter-branch / filter-repo`。
- **远程推送 / 强推**：`git push`、`git push --force`、`git push --force-with-lease`、`git push origin --delete <branch>`；一律禁止，逐项单独授权。
- **宝塔数据库 / 配置 / 证书**：docker.db / site.db / ssl_data.db 的 DELETE / UPDATE / INSERT、Nginx vhost、证书目录。

执行要求：删除前必须先备份（`cp -a <path> /root/<path>.bak-<TS>` 或 `git mv` 到暂存区）；最终交付摘要逐行列出已删除对象；用户单字确认「是 / 好 / 继续」**只对当下那一个具体项有效**。
