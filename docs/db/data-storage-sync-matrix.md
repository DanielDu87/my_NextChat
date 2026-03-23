# 数据存储、同步与更新总表

## 1. 数据分类总表

| 数据类型         | 典型 key / 表          | 本地存储       | 云端存储                     | 页面加载策略                                           | 手动同步策略                                   | 自动更新来源                               |
| ---------------- | ---------------------- | -------------- | ---------------------------- | ------------------------------------------------------ | ---------------------------------------------- | ------------------------------------------ |
| 对话数据         | `chat-next-web-store`  | `IndexedDB`    | PostgreSQL `sync_artifacts`  | 先读本地，再检查云端版本；云端变更且本地无脏数据时下载 | `保存并同步` 上传本地；`从数据库下载` 覆盖本地 | 无外部来源                                 |
| 插件数据         | `chat-next-web-plugin` | `IndexedDB`    | PostgreSQL `sync_artifacts`  | 同上                                                   | 同上                                           | 无外部来源                                 |
| API / 平台配置   | `access-control`       | `IndexedDB`    | PostgreSQL `sync_artifacts`  | 先读本地，再检查云端版本                               | 同上                                           | 用户手动保存、同步按钮                     |
| 模型配置         | `app-config`           | `IndexedDB`    | PostgreSQL `sync_artifacts`  | 先读本地，再检查云端版本                               | 同上                                           | 模型刷新任务会回写最新模型列表             |
| 模型缓存         | `model-cache-store`    | `IndexedDB`    | PostgreSQL `sync_artifacts`  | API 配置页优先读本地缓存，不自动刷新模型               | 点击“获取模型数据”或“保存并同步”时更新         | 模型刷新任务、模型获取按钮、服务端刷新脚本 |
| Mask             | `mask-store`           | `IndexedDB`    | PostgreSQL `sync_artifacts`  | 先读本地，再检查云端版本                               | 同上                                           | 无外部来源                                 |
| Prompt           | `prompt-store`         | `IndexedDB`    | PostgreSQL `sync_artifacts`  | 先读本地，再检查云端版本                               | 同上                                           | 无外部来源                                 |
| 更新状态         | `chat-update`          | `IndexedDB`    | PostgreSQL `sync_artifacts`  | 先读本地，再检查云端版本                               | 同上                                           | 无外部来源                                 |
| 绘图记录         | `sd-list`              | `IndexedDB`    | PostgreSQL `sync_artifacts`  | 先读本地，再检查云端版本                               | 同上                                           | 无外部来源                                 |
| 同步元信息       | `sync`                 | `IndexedDB`    | 可选云端快照                 | 本地直接读取                                           | 随同步动作更新                                 | `/api/db/sync-meta`                        |
| 模型目录主表     | `model_catalog`        | 无直接本地副本 | PostgreSQL `model_catalog`   | 不在页面直接读整表；通过 `app-config.models` 进入前端  | 由模型刷新脚本/接口维护                        | 供应商 API / WebDAV 迁移                   |
| 模型同步运行记录 | `model_sync_runs`      | 无             | PostgreSQL `model_sync_runs` | 不在页面直接读                                         | 由后台任务写入                                 | 供应商刷新脚本、模型导入脚本               |
| 同步快照元数据   | `sync_artifacts`       | 无             | PostgreSQL `sync_artifacts`  | 页面只读 `meta` 时访问                                 | 手动同步时写入                                 | 各 store 同步 / 模型刷新                   |
| 页面宽度         | `sidebarWidth`         | `localStorage` | 无                           | 只读本地                                               | 不参与云端同步                                 | 无                                         |
| 语言             | `lang`                 | `localStorage` | 无                           | 只读本地                                               | 不参与云端同步                                 | 无                                         |
| 横幅关闭状态     | `bannerDismissed`      | `localStorage` | 无                           | 只读本地                                               | 不参与云端同步                                 | 无                                         |
| 输入草稿         | `unfinished-input-*`   | `localStorage` | 无                           | 只读本地                                               | 不参与云端同步                                 | 无                                         |

## 2. 页面加载规则表

| 页面 / 模块      | 先读本地 | 云端检查内容                                                                | 何时下载云端正文           | 是否直接访问供应商 API |
| ---------------- | -------- | --------------------------------------------------------------------------- | -------------------------- | ---------------------- |
| 聊天页           | 是       | `chat-next-web-store` 的 `updatedAt/checksum`                               | 云端版本不同且本地无冲突时 | 否                     |
| API 配置页       | 是       | `app-config`、`access-control`、`model-cache-store` 的 `updatedAt/checksum` | 云端版本不同且本地无冲突时 | 否                     |
| 插件页           | 是       | `chat-next-web-plugin` 的 `updatedAt/checksum`                              | 云端版本不同且本地无冲突时 | 否                     |
| Prompt / Mask 页 | 是       | 对应 store 的 `updatedAt/checksum`                                          | 云端版本不同且本地无冲突时 | 否                     |
| 绘图页           | 是       | `sd-list` 的 `updatedAt/checksum`                                           | 云端版本不同且本地无冲突时 | 否                     |

## 3. 手动同步动作表

| 操作         | 本地数据   | 云端数据   | 结果                                 |
| ------------ | ---------- | ---------- | ------------------------------------ |
| 保存并同步   | 作为源数据 | 被本地覆盖 | 上传完成后刷新本地记录的云端版本信息 |
| 上传到数据库 | 作为源数据 | 被本地覆盖 | 只上传，不下载                       |
| 从数据库下载 | 被云端覆盖 | 作为源数据 | 强制用云端快照覆盖本地               |
| 页面自动校验 | 先本地渲染 | 只检查版本 | 仅当版本不同才下载正文               |

## 3.1 保存并同步时的合并策略表

| 数据类型               | 典型 key / 表                                | 保存并同步策略 | 说明                                             |
| ---------------------- | -------------------------------------------- | -------------- | ------------------------------------------------ |
| 对话数据               | `chat-next-web-store`                        | 双向合并       | 按会话和消息去重，避免覆盖历史对话               |
| 插件数据               | `chat-next-web-plugin`                       | 双向合并       | 按插件 key 合并                                  |
| API Profiles           | `access-control.apiProfiles`                 | 双向合并       | 按 profile `id` 合并，不再承载模型缓存主数据     |
| 模型缓存               | `model-cache-store.profiles`                 | 双向合并       | 按 profile `id` 合并，`updatedAt` 较新的缓存优先 |
| 模型集合               | `app-config.models`                          | 双向合并       | 按 `model.name + provider.id` 合并               |
| 页面主设置             | `app-config` 其他字段                        | 本地覆盖云端   | 以当前设备用户显式保存的设置为准                 |
| Prompt                 | `prompt-store`                               | 双向合并       | 按 key 合并                                      |
| Mask                   | `mask-store`                                 | 双向合并       | 按 key / id 合并                                 |
| 绘图记录               | `sd-list`                                    | 双向合并       | 按记录 id 合并                                   |
| 更新状态               | `chat-update`                                | 云端覆盖本地   | 控制面状态不做本地优先 merge                     |
| 同步元信息             | `sync`                                       | 云端覆盖本地   | 版本状态由云端与本地校验流程驱动                 |
| 页面宽度 / 语言 / 草稿 | `sidebarWidth`、`lang`、`unfinished-input-*` | 不参与云端同步 | 始终只保留本地                                   |

## 3.2 自动刷新/同步说明

- `app/components/auto-sync.tsx` 在每次页面加载时会驱动一次 `syncStore.autoSync()`，先完成“本地优先”展示，再自动同步会话和非模型业务数据；
- 自动同步不会触发模型刷新，也不会自动同步 `app-config.models` / `model-cache-store`；
- `API 配置页` 页面打开时只展示本地模型缓存，不自动刷新模型；模型刷新只会在你点击“获取模型数据”或“保存并同步”时触发。

## 4. 云端版本判断表

| 判断项        | 来源                                   | 用途                     |
| ------------- | -------------------------------------- | ------------------------ |
| `updatedAt`   | PostgreSQL `sync_artifacts.updated_at` | 判断云端快照是否变更     |
| `checksum`    | `md5(payload_json::text)`              | 判断内容是否真的变化     |
| `sizeBytes`   | `pg_column_size(payload_json)`         | 辅助诊断和日志展示       |
| `validatedAt` | 本地 `sync.database.cacheMeta`         | 记录最近一次版本校验时间 |

## 5. 模型更新链路表

| 环节             | 来源                                          | 写入目标                                         | 触发方式                                                |
| ---------------- | --------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------- |
| 供应商实时拉取   | AihubMix / YutoAPI / Ocoolai / 未来新增供应商 | 内存结果                                         | 后台脚本或受控接口                                      |
| 归一化模型数据   | 服务端模型拉取器                              | `SyncedLLMModel[]`                               | 拉取后立即处理                                          |
| 模型目录持久化   | 归一化模型结果                                | PostgreSQL `model_catalog`                       | `refresh-provider-models.ts` / `/api/db/models/refresh` |
| 前端模型快照更新 | 归一化模型结果                                | PostgreSQL `sync_artifacts.app-config`           | 同上                                                    |
| 前端模型缓存更新 | 归一化模型结果                                | PostgreSQL `sync_artifacts.model-cache-store`    | 同上                                                    |
| 页面本地更新     | 云端版本变化                                  | `IndexedDB` (`app-config` + `model-cache-store`) | 下次页面版本校验时按需下载                              |

## 6. 模型供应商自动更新兼容策略

| 场景                               | 是否需要改代码       | 说明                                                                                             |
| ---------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------ |
| 新增一个 OpenAI 兼容供应商 profile | 否                   | 只要 `apiProfiles` 中配置了 `baseUrl + apiKey`，且接口兼容 `/models` 或 `/pricing`，自动纳入刷新 |
| 新增一个已知内置供应商             | 通常否               | 若走默认 OpenAI 兼容策略即可直接纳入                                                             |
| 新增一个接口完全不兼容的新供应商   | 是                   | 只需要在服务端拉取注册表里补一个 adapter，不需要改同步主流程                                     |
| 已有供应商接口偶发返回较少模型     | 当前会按本次结果写入 | 下一步建议补“收缩保护”策略，避免误删过多模型                                                     |

## 7. 当前关键实现文件

| 逻辑                   | 文件                                                                                              |
| ---------------------- | ------------------------------------------------------------------------------------------------- |
| 本地业务持久化         | [indexeddb-state-storage.ts](/Users/dyx/Code/NextChat/app/utils/indexeddb-state-storage.ts)       |
| Zustand 持久化入口     | [store.ts](/Users/dyx/Code/NextChat/app/utils/store.ts)                                           |
| 云端版本元信息接口     | [route.ts](/Users/dyx/Code/NextChat/app/api/db/sync-meta/route.ts)                                |
| 云端 store 快照接口    | [route.ts](/Users/dyx/Code/NextChat/app/api/db/sync/[key]/route.ts)                               |
| 同步元信息状态         | [sync.ts](/Users/dyx/Code/NextChat/app/store/sync.ts)                                             |
| API 配置页本地优先逻辑 | [api-config.tsx](/Users/dyx/Code/NextChat/app/components/api-config.tsx)                          |
| 服务端模型拉取         | [provider-model-fetch.ts](/Users/dyx/Code/NextChat/app/utils/server/provider-model-fetch.ts)      |
| 服务端模型刷新编排     | [provider-model-sync.ts](/Users/dyx/Code/NextChat/app/utils/server/provider-model-sync.ts)        |
| 本地模型缓存 Store     | [model-cache.ts](/Users/dyx/Code/NextChat/app/store/model-cache.ts)                               |
| 模型刷新脚本           | [refresh-provider-models.ts](/Users/dyx/Code/NextChat/scripts/refresh-provider-models.ts)         |
| 模型刷新接口           | [route.ts](/Users/dyx/Code/NextChat/app/api/db/models/refresh/route.ts)                           |
| 同步规则说明           | [local-first-sync-rules.md](/Users/dyx/Code/NextChat/docs/db/local-first-sync-rules.md)           |
| 模型自动更新说明       | [provider-model-auto-refresh.md](/Users/dyx/Code/NextChat/docs/db/provider-model-auto-refresh.md) |
