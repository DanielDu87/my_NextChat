# 本地优先同步规则

## 存储分层

- `IndexedDB`
  - 作为业务数据的本地工作副本
  - 覆盖：对话、设置、模型配置、模型缓存、插件、Prompt、Mask、更新状态、绘图记录、同步状态
- `localStorage`
  - 只保留纯 UI 偏好和临时态
  - 例如：侧边栏宽度、语言、横幅关闭状态、输入草稿
- `PostgreSQL`
  - 作为云端共享副本和最终可信源
  - 当前真实落点不是统一的 `sync_artifacts`
  - 聊天数据写入：
    - `conversations`
    - `messages`
    - `app_settings.chat_settings`
  - 其余 store 主要写入：
    - `app_settings`（4 个 JSONB 列：`chat_settings / plugin_settings / security_settings / extra_settings`）
    - `provider_configs`
    - `provider_api_keys`
    - `sync_secrets`
  - 绘图与文件数据写入：
    - `user_draw_stores`（绘画任务历史快照，`payload_json`）
    - `user_draw_images`（绘画生成图片二进制：`data` 原图 + `thumb_data` 缩略图，按 `md5(data)` 去重；通过 `/api/db/draw-image` 单独上传/读取，不随 store 同步）
    - `cache_file_blobs` / `user_cache_files`（上传文件内容去重和用户文件记录；通过 `/api/cache/*` 写入/读取）
  - API 配置备份写入：
    - `api_config_backup_settings` / `api_config_backups`（Access store 保存时按设置自动备份，也支持手动备份/恢复）
  - 模型数据写入（v4 优化后）：
    - `app_settings.security_settings -> 'access-control'` 的 `apiProfiles[*].cachedModels`
    - `app_settings.extra_settings -> 'model-cache-store'` 的缓存
    - `app-config.models` 上传前会被剥离，不再作为云端模型集合持久化入口
- 模型供应商 API
  - 只作为模型数据更新来源
  - 不作为页面运行时直接主数据源

## 页面加载规则

- 页面先读取本地 `IndexedDB`
- 立即渲染本地数据
- 后台只检查当前页面相关 store 的云端元信息：
  - `updatedAt`
  - `checksum`
  - `sizeBytes`
- 若云端版本与本地记录一致：
  - 不下载正文
- 若云端版本不同且本地无未同步修改：
  - 下载云端数据并刷新本地
- 若云端版本不同且本地存在未同步修改：
  - 标记冲突，不自动覆盖
- 自动同步覆盖会话、非模型业务数据，以及模型缓存
- 模型配置页只读取本地模型缓存，不在页面加载时自动刷新模型

## 手动操作规则

### 保存并同步

- 强制把本地数据上传到 PostgreSQL
- 上传成功后刷新本地记录的云端版本信息

### 从数据库下载

- 强制用 PostgreSQL 覆盖本地缓存
- 下载后刷新本地记录的云端版本信息

### 上传到数据库

- 只上传本地
- 不主动下载云端

## 冲突处理规则

- 模型和设置：
  - 默认按按钮语义处理
  - 不做复杂自动三方合并
- 会话：
  - 若本地和云端都在上次同步后发生变化
  - 不自动静默覆盖
  - 后续页面应提示用户选择上传本地或下载云端

## 模型自动更新规则

- 页面加载不直接请求供应商 API
- 后台脚本或受控接口负责从供应商拉模型
- 拉取后更新两类云端数据（**v4 优化后不再写 `model_catalog` / `model_sync_runs`，`app-config.models` 上传前会被剥离**）：
  - `app_settings.security_settings -> 'access-control'` 的 `apiProfiles[*].cachedModels`
  - `app_settings.extra_settings -> 'model-cache-store'` 的缓存
- `access-control` 只保留 profile 主配置，`cachedModels` 是当前模型数据的**唯一**持久化入口
- 应用启动或直接进入 API 配置页时，会自动把历史 `cachedModels` / `modelCount` 迁移到 `model-cache-store`
- 前端在页面启动时会自动同步模型缓存到本地，并据此重建模型列表

## 当前实现

- 本地业务持久化：`IndexedDB`
- 轻量版本检查接口：`/api/db/sync-meta`
- 自动同步入口：`syncStore.autoSync()`
- 模型专用同步入口：`syncStore.syncModels()`
- 手动模型刷新脚本：`yarn db:refresh-provider-models`
- 旧聊天数据迁移脚本：`yarn db:migrate-chat-store`
- 手动模型刷新接口：`POST /api/db/models/refresh`
- 若配置了 `MODEL_SYNC_TOKEN`，接口必须带：
  - `Authorization: Bearer <MODEL_SYNC_TOKEN>`
- 运行时初始化保证：应用启动时 `ensureSyncStorageSchema()` 会自动建表 + 补齐所需列：
  - v4 优化：`provider_configs.api_path / api_format`、`provider_api_keys.last_verified_at`、`messages.reasoning_text / tool_calls / metadata_json`；清理已下线的 4 张模型表 + 3 个冗余索引。
  - draw-thumb-v1（2026-06-22）：新建 `user_draw_images` 表（含 `thumb_data` 列），删除重复行并补 `(user_id, content_type, md5(data))` 唯一索引。
  - api-config-backup-counts（2026-06-28）：补 `cache_file_blobs` / `user_cache_files`、`api_config_backup_settings` / `api_config_backups` 及相关索引。
  - `auth_sessions` / `site_access_settings` 分别由 `ensureAuthSchemaAndSeed()` / `ensureSitePasswordConfigured()` 维护。
  - 完整 schema SQL 和运行时初始化保持同步维护。
