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
- 自动同步只覆盖会话和非模型业务数据
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
- 拉取后更新三份云端数据：
  - `model_catalog`
  - `app-config` 的模型集合快照
  - `model-cache-store` 的模型缓存快照
- `access-control` 只保留 profile 主配置，旧的 `cachedModels` / `modelCount` 字段仅用于兼容历史数据
- 应用启动或直接进入 API 配置页时，会自动把历史 `cachedModels` / `modelCount` 迁移到 `model-cache-store`
- 前端只在下次版本检查时发现云端变化，再按需同步到本地

## 当前实现

- 本地业务持久化：`IndexedDB`
- 轻量版本检查接口：`/api/db/sync-meta`
- 自动同步入口：`syncStore.autoSync()`
- 模型专用同步入口：`syncStore.syncModels()`
- 手动模型刷新脚本：`yarn db:refresh-provider-models`
- 手动模型刷新接口：`POST /api/db/models/refresh`
- 若配置了 `MODEL_SYNC_TOKEN`，接口必须带：
  - `Authorization: Bearer <MODEL_SYNC_TOKEN>`
