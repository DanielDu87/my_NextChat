# 数据存储、同步与更新总表

> 本文档以当前仓库代码为准。
> 当前实现的云端主存储不是统一的 `sync_artifacts` 表，而是按数据类型拆分到了多个 PostgreSQL 表和 `app_settings` 的 JSONB 列中。

## 1. 当前实现总览

### 1.1 存储分层

| 存储层 | 当前用途 | 备注 |
| --- | --- | --- |
| `IndexedDB` | 前端业务数据本地工作副本 | Zustand 持久化主入口 |
| `localStorage` | 纯本地 UI 偏好和临时态 | 不参与云端同步 |
| PostgreSQL | 云端共享副本、敏感配置、模型目录、运行状态 | 当前主云端存储 |

### 1.2 当前实际 PostgreSQL 表映射

| 数据/功能 | PostgreSQL 表 | 列/结构 | 代码入口 |
| --- | --- | --- | --- |
| 同步用户映射 | `app_users` | `external_id`、`id` | `sync-app-user.ts` |
| 聊天索引状态 | `app_settings` | `chat_settings -> '__chat-index-state__'` | `sync-store-repository.ts` |
| 聊天会话正文主表 | `conversations` + `messages` | 会话与消息规范化存储 | `chat-conversation-repository.ts` |
| 配置主 store | `app_settings` | `model_settings -> 'app-config'` | `app-settings-repository.ts` |
| 模型缓存 | `app_settings` | `model_settings -> 'model-cache-store'` | `app-settings-repository.ts` |
| 插件 store | `app_settings` | `plugin_settings -> 'chat-next-web-plugin'` | `app-settings-repository.ts` |
| 同步状态 | `app_settings` | `sync_settings -> 'sync'` | `app-settings-repository.ts` |
| Access store 公开部分 | `app_settings` | `security_settings -> 'access-control'` | `app-settings-repository.ts` |
| Mask store | `app_settings` | `extra_settings -> 'mask-store'` | `app-settings-repository.ts` |
| Prompt store | `app_settings` | `extra_settings -> 'prompt-store'` | `app-settings-repository.ts` |
| 更新状态 | `app_settings` | `extra_settings -> 'chat-update'` | `app-settings-repository.ts` |
| 绘图记录 | `app_settings` | `extra_settings -> 'sd-list'` | `app-settings-repository.ts` |
| Access store 结构化 provider 配置 | `provider_configs` | 每个 profile 一行 | `provider-config-repository.ts` |
| Access store 密钥 | `provider_api_keys` | 每类 key 一行 | `provider-config-repository.ts` |
| 额外敏感配置加密存储 | `sync_secrets` | `encrypted_payload` | `sync-secrets.ts` |
| 模型刷新最新状态 | `user_model_refresh_states` | `refresh_key = 'latest'` | `model-refresh-state-repository.ts` |
| 平台余额快照 | `user_provider_balance_snapshots` | `balance_key` + `payload_json` | `provider-balance-repository.ts` |
| 模型来源索引快照 | `model_source_index_snapshots` | `source_key` + `payload_json` | `model-source-index-repository.ts` |
| 模型目录主表 | `model_catalog` | 每个 `provider_id + model_name` 一行 | `model-catalog-repository.ts` |
| 模型同步运行记录 | `model_sync_runs` | 每次刷新任务一行 | `provider-model-sync.ts` |

### 1.3 `app_settings` 列到 store 的固定映射

| Store Key | 表 | 列 | JSON 子 key |
| --- | --- | --- | --- |
| `app-config` | `app_settings` | `model_settings` | `app-config` |
| `model-cache-store` | `app_settings` | `model_settings` | `model-cache-store` |
| `chat-next-web-plugin` | `app_settings` | `plugin_settings` | `chat-next-web-plugin` |
| `sync` | `app_settings` | `sync_settings` | `sync` |
| `access-control` | `app_settings` | `security_settings` | `access-control` |
| `mask-store` | `app_settings` | `extra_settings` | `mask-store` |
| `prompt-store` | `app_settings` | `extra_settings` | `prompt-store` |
| `chat-update` | `app_settings` | `extra_settings` | `chat-update` |
| `sd-list` | `app_settings` | `extra_settings` | `sd-list` |

### 1.4 不对应 PostgreSQL 表的存储

| 数据 | 存储介质 | 实际落点 |
| --- | --- | --- |
| 本地业务缓存 | `IndexedDB` | `nextchat-local-cache.state-cache` |
| 页面宽度 | `localStorage` | `sidebarWidth` |
| 语言 | `localStorage` | `lang` |
| 横幅关闭状态 | `localStorage` | `bannerDismissed` |
| 输入草稿 | `localStorage` | `unfinished-input-*` |

## 2. 数据分类总表

| 数据类型 | 典型 key / 表 | 本地存储 | 云端存储 | 页面加载策略 | 手动同步策略 | 自动更新来源 |
| --- | --- | --- | --- | --- | --- | --- |
| 对话数据 | `chat-next-web-store` | `IndexedDB` | PostgreSQL `app_settings.chat_settings` + `conversations` + `messages` | 先读本地，再检查云端版本；云端变更且本地无脏数据时下载 | `保存并同步` 上传本地；`从数据库下载` 覆盖本地 | 无外部来源 |
| 插件数据 | `chat-next-web-plugin` | `IndexedDB` | PostgreSQL `app_settings.plugin_settings` | 同上 | 同上 | 无外部来源 |
| API / 平台配置 | `access-control` | `IndexedDB` | PostgreSQL `app_settings.security_settings` + `provider_configs` + `provider_api_keys` + `sync_secrets` | 先读本地，再检查云端版本 | 同上 | 用户手动保存、同步按钮 |
| 模型配置 | `app-config` | `IndexedDB` | PostgreSQL `app_settings.model_settings` | 先读本地，再检查云端版本 | 同上 | 模型刷新任务会回写最新模型列表 |
| 模型缓存 | `model-cache-store` | `IndexedDB` | PostgreSQL `app_settings.model_settings` | API 配置页优先读本地缓存，不自动刷新模型 | 点击“获取模型数据”或“保存并同步”时更新 | 模型刷新任务、模型获取按钮、服务端刷新脚本 |
| Mask | `mask-store` | `IndexedDB` | PostgreSQL `app_settings.extra_settings` | 同上 | 同上 | 无外部来源 |
| Prompt | `prompt-store` | `IndexedDB` | PostgreSQL `app_settings.extra_settings` | 先读本地，再检查云端版本 | 同上 | 无外部来源 |
| 更新状态 | `chat-update` | `IndexedDB` | PostgreSQL `app_settings.extra_settings` | 先读本地，再检查云端版本 | 同上 | 无外部来源 |
| 绘图记录 | `sd-list` | `IndexedDB` | PostgreSQL `app_settings.extra_settings` | 先读本地，再检查云端版本 | 同上 | 无外部来源 |
| 同步元信息 | `sync` | `IndexedDB` | 可选云端快照 | 本地直接读取 | 随同步动作更新 | `/api/db/sync-meta` |
| 模型目录主表 | `model_catalog` | 无直接本地副本 | PostgreSQL `model_catalog` | 不在页面直接读整表；通过 `app-config.models` 进入前端 | 由模型刷新脚本/接口维护 | 供应商 API / 导入脚本 |
| 模型同步运行记录 | `model_sync_runs` | 无 | PostgreSQL `model_sync_runs` | 不在页面直接读 | 由后台任务写入 | 供应商刷新脚本、模型导入脚本 |
| 页面宽度 | `sidebarWidth` | `localStorage` | 无 | 只读本地 | 不参与云端同步 | 无 |
| 语言 | `lang` | `localStorage` | 无 | 只读本地 | 不参与云端同步 | 无 |
| 横幅关闭状态 | `bannerDismissed` | `localStorage` | 无 | 只读本地 | 不参与云端同步 | 无 |
| 输入草稿 | `unfinished-input-*` | `localStorage` | 无 | 只读本地 | 不参与云端同步 | 无 |

## 3. 页面加载规则表

| 页面 / 模块 | 先读本地 | 云端检查内容 | 何时下载云端正文 | 是否直接访问供应商 API |
| --- | --- | --- | --- | --- |
| 聊天页 | 是 | `chat-next-web-store` 的 `updatedAt/checksum` | 云端版本不同且本地无冲突时 | 否 |
| API 配置页 | 是 | `app-config`、`access-control`、`model-cache-store` 的 `updatedAt/checksum` | 云端版本不同且本地无冲突时 | 否 |
| 插件页 | 是 | `chat-next-web-plugin` 的 `updatedAt/checksum` | 云端版本不同且本地无冲突时 | 否 |
| Prompt / Mask 页 | 是 | 对应 store 的 `updatedAt/checksum` | 云端版本不同且本地无冲突时 | 否 |
| 绘图页 | 是 | `sd-list` 的 `updatedAt/checksum` | 云端版本不同且本地无冲突时 | 否 |

## 4. 手动同步动作表

| 操作 | 本地数据 | 云端数据 | 结果 |
| --- | --- | --- | --- |
| 保存并同步 | 作为源数据 | 被本地覆盖 | 上传完成后刷新本地记录的云端版本信息 |
| 上传到数据库 | 作为源数据 | 被本地覆盖 | 只上传，不下载 |
| 从数据库下载 | 被云端覆盖 | 作为源数据 | 强制用云端快照覆盖本地 |
| 页面自动校验 | 先本地渲染 | 只检查版本 | 仅当版本不同才下载正文 |

## 5. 保存并同步时的合并策略表

| 数据类型 | 典型 key / 表 | 保存并同步策略 | 说明 |
| --- | --- | --- | --- |
| 对话数据 | `chat-next-web-store` | 双向合并 | 按会话和消息去重，避免覆盖历史对话 |
| 插件数据 | `chat-next-web-plugin` | 双向合并 | 按插件 key 合并 |
| API Profiles | `access-control.apiProfiles` | 双向合并 | 按 profile `id` 合并，不再承载模型缓存主数据 |
| 模型缓存 | `model-cache-store.profiles` | 双向合并 | 按 profile `id` 合并，`updatedAt` 较新的缓存优先 |
| 模型集合 | `app-config.models` | 双向合并 | 按 `model.name + provider.id` 合并 |
| 页面主设置 | `app-config` 其他字段 | 本地覆盖云端 | 以当前设备用户显式保存的设置为准 |
| Prompt | `prompt-store` | 双向合并 | 按 key 合并 |
| Mask | `mask-store` | 双向合并 | 按 key / id 合并 |
| 绘图记录 | `sd-list` | 双向合并 | 按记录 id 合并 |
| 更新状态 | `chat-update` | 云端覆盖本地 | 控制面状态不做本地优先 merge |
| 同步元信息 | `sync` | 云端覆盖本地 | 版本状态由云端与本地校验流程驱动 |
| 页面宽度 / 语言 / 草稿 | `sidebarWidth`、`lang`、`unfinished-input-*` | 不参与云端同步 | 始终只保留本地 |

## 6. 自动刷新/同步说明

- `app/components/auto-sync.tsx` 在每次页面加载时会驱动一次 `syncStore.autoSync()`，先完成“本地优先”展示，再自动同步会话、非模型业务数据和 `model-cache-store`。
- 自动同步不会触发模型刷新，也不会自动同步 `app-config.models`；页面会在拿到 `model-cache-store` 后重建本地模型列表。
- `API 配置页` 页面打开时只展示本地模型缓存，不自动刷新模型；模型刷新只会在点击“获取模型数据”或“保存并同步”时触发。

## 7. 云端版本判断表

| 判断项 | 来源 | 用途 |
| --- | --- | --- |
| `updatedAt` | PostgreSQL 各目标表的 `updated_at` | 判断云端快照是否变更 |
| `checksum` | `md5(payload_json::text)` 或对应 JSONB 子对象 | 判断内容是否真的变化 |
| `sizeBytes` | `pg_column_size(payload_json)` 或对应 JSONB 子对象 | 辅助诊断和日志展示 |
| `validatedAt` | 本地 `sync.database.cacheMeta` | 记录最近一次版本校验时间 |

## 8. 模型更新链路表

| 环节 | 来源 | 写入目标 | 触发方式 |
| --- | --- | --- | --- |
| 供应商实时拉取 | AihubMix / YutoAPI / Ocoolai / 未来新增供应商 | 内存结果 | 后台脚本或受控接口 |
| 归一化模型数据 | 服务端模型拉取器 | `SyncedLLMModel[]` | 拉取后立即处理 |
| 模型目录持久化 | 归一化模型结果 | PostgreSQL `model_catalog` | `refresh-provider-models.ts` / `/api/db/models/refresh` |
| 前端模型快照更新 | 归一化模型结果 | PostgreSQL `app_settings.model_settings -> 'app-config'` | 同上 |
| 前端模型缓存更新 | 归一化模型结果 | PostgreSQL `app_settings.model_settings -> 'model-cache-store'` | 同上 |
| 页面本地更新 | 云端版本变化 | `IndexedDB` (`app-config` + `model-cache-store`) | 下次页面版本校验时按需下载 |

## 9. 模型供应商自动更新兼容策略

| 场景 | 是否需要改代码 | 说明 |
| --- | --- | --- |
| 新增一个 OpenAI 兼容供应商 profile | 否 | 只要 `apiProfiles` 中配置了 `baseUrl + apiKey`，且接口兼容 `/models` 或 `/pricing`，自动纳入刷新 |
| 新增一个已知内置供应商 | 通常否 | 若走默认 OpenAI 兼容策略即可直接纳入 |
| 新增一个接口完全不兼容的新供应商 | 是 | 只需要在服务端拉取注册表里补一个 adapter，不需要改同步主流程 |
| 已有供应商接口偶发返回较少模型 | 当前会按本次结果写入 | 下一步建议补“收缩保护”策略，避免误删过多模型 |

## 10. 当前关键实现文件

| 逻辑 | 文件 |
| --- | --- |
| 本地业务持久化 | [indexeddb-state-storage.ts](/Users/dyx/Code/NextChat/app/utils/indexeddb-state-storage.ts) |
| Zustand 持久化入口 | [store.ts](/Users/dyx/Code/NextChat/app/utils/store.ts) |
| 云端版本元信息接口 | [route.ts](/Users/dyx/Code/NextChat/app/api/db/sync-meta/route.ts) |
| 云端 store 快照接口 | [route.ts](/Users/dyx/Code/NextChat/app/api/db/sync/[key]/route.ts) |
| 聊天增量同步接口 | [route.ts](/Users/dyx/Code/NextChat/app/api/db/chat-sync/route.ts) |
| 同步元信息状态 | [sync.ts](/Users/dyx/Code/NextChat/app/store/sync.ts) |
| API 配置页本地优先逻辑 | [api-config.tsx](/Users/dyx/Code/NextChat/app/components/api-config.tsx) |
| 服务端模型拉取 | [provider-model-fetch.ts](/Users/dyx/Code/NextChat/app/utils/server/provider-model-fetch.ts) |
| 服务端模型刷新编排 | [provider-model-sync.ts](/Users/dyx/Code/NextChat/app/utils/server/provider-model-sync.ts) |
| 本地模型缓存 Store | [model-cache.ts](/Users/dyx/Code/NextChat/app/store/model-cache.ts) |
| 模型刷新脚本 | [refresh-provider-models.ts](/Users/dyx/Code/NextChat/scripts/refresh-provider-models.ts) |
| 模型刷新接口 | [route.ts](/Users/dyx/Code/NextChat/app/api/db/models/refresh/route.ts) |
| 同步规则说明 | [local-first-sync-rules.md](/Users/dyx/Code/NextChat/docs/db/local-first-sync-rules.md) |
| PostgreSQL 完整 schema | [nextchat-postgres-schema.sql](/Users/dyx/Code/NextChat/docs/db/nextchat-postgres-schema.sql) |

## 11. 文档与代码差异说明

### 11.1 已存在但当前主流程未使用或仅预留的业务表

以下表定义在 [nextchat-postgres-schema.sql](/Users/dyx/Code/NextChat/docs/db/nextchat-postgres-schema.sql)，但当前仓库主流程没有把聊天主数据写入这些规范化表：

- `auth_accounts`
- `auth_sessions`
- `message_attachments`
- `tags`
- `share_links`
- `model_aliases`

当前聊天索引状态保存在：

- `app_settings.chat_settings`

当前聊天正文主存储已经切到：

- `conversations`
- `messages`

### 11.2 一个需要特别注意的实现细节

- `provider-model-sync.ts` 会写 `model_catalog` 和 `model_sync_runs`
- `postgres.ts` 里的 `ensureSyncStorageSchema()` 现在会自动补齐这两张表
- 完整 SQL 仍然应与运行时初始化保持一致：
  - [nextchat-postgres-schema.sql](/Users/dyx/Code/NextChat/docs/db/nextchat-postgres-schema.sql)

如果后续再给完整 SQL 新增字段或表，也必须同步回 `ensureSyncStorageSchema()`，否则仍会重新产生“文档有、运行时没建”的漂移问题。

## 12. 当前建议优化项

### 12.1 高优先级

- 统一文档和实现，彻底移除过时的 `sync_artifacts` 说法，避免继续误导维护者。
- 把 `model_catalog`、`model_sync_runs`、`model_aliases` 的建表语句并入 `ensureSyncStorageSchema()`，避免“最小初始化可启动，但模型刷新一跑就缺表”。
- 为 `app_settings` 补充更明确的约束说明，避免后续继续把太多异构 store 无上限塞进 `extra_settings`。

### 12.2 中优先级

- 聊天数据已经收敛到 `conversations` / `messages` + `app_settings.chat_settings`，后续如需继续优化，可再考虑把索引状态进一步并入更明确的聊天专用设置模型。
- `access-control` 当前已经收敛为结构化 provider 数据写 `provider_configs` / `provider_api_keys` / `sync_secrets`，`app_settings` 只保留非结构化补充配置；后续需要保持这条边界不被重新打破。
- `app_settings` 现在承担了太多 store 的聚合存储，后续若某些字段增长过快，建议拆表，而不是继续扩大单行 JSONB。

### 12.3 低优先级

- `provider_configs` / `provider_api_keys` 可补充更多唯一约束和审计字段，便于排查 profile 变更。
- 当前 `model_sync_runs` 只记录 run 级结果；如果以后要排查单 provider 失败，建议增加明细表。
