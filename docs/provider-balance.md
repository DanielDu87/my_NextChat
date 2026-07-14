# 余额查询

余额查询页路径为 `/balances`，真实数据 owner 是 PostgreSQL 的 `provider_configs` 与 `provider_balance_configs`。浏览器 `localStorage` 只保存非敏感的 Profile 标识、名称和余额快照，用于首屏立即显示；管理 Key、User ID 和完整查询配置仍只从数据库读取。

## 数据流

- `GET /api/db/provider-balance`：无参数时读取全局供应商列表、查询配置、最近余额和错误；携带 `profileId` 时只返回该 Profile 的数据库余额和错误，供对话页使用。
- `PUT /api/db/provider-balance`：一次请求原子保存管理 Key、自定义查询 URL、New-API-User 开关和 User ID。管理 Key 单独加密保存，User ID 存入 `new_api_user_id`，不再拼接后由浏览器传回查询接口。
- `POST /api/db/provider-balance`：只接收 `profileId`。服务端重新从全局数据库供应商列表读取查询配置；当前访问态中存在同 ID Profile 时复用其认证扩展，否则直接使用数据库中的名称、Base URL、管理 Key 和余额配置构造查询，避免 GET 能看到而 POST 报 `provider_not_found`。固定 URL、根地址探测和普通自动探测成功后都保存真实路径、Base URL 与认证方式；失败时保留旧余额并更新错误和查询时间。

页面首开同步读取本地余额缓存并立即显示，同时在后台读取数据库余额与配置；数据库返回后覆盖 UI 和本地缓存，但不自动发起上游余额查询。仅在用户点击单项“更新”或“全部更新”时查询。单项与批量查询遇到未保存表单时要求先保存；自定义路径和自动路径在查询中统一显示“正在查询余额...”。批量模式并发启动各供应商，但不再用前端 30 秒总超时截断尚未走完的服务端探测队列，单个上游请求仍受服务端 15 秒超时和有限重试约束。短暂网络或上游错误不会清空页面和聊天页已有余额。查询成功时余额立即替换为接口返回的新数字并同步更新本地缓存，余额文字显示绿色并在左侧显示较大、较粗的绿色 SVG 勾；查询失败时保留旧余额，余额文字显示红色并在左侧显示红色叉；未触发查询的缓存或数据库余额保持默认蓝色且不显示状态图标。查询 URL 始终显示完整地址；自动探测路径、缓存成功路径和 New-API-User 默认路径都只是自动填充，输入框保持可编辑，保存后以用户填写值为准。已有固定 URL 时输入框使用绿色文字标识，尚未探测且为空时保持默认颜色。

对话页先按当前 `profileId` 或供应商名称同步读取本地余额并立即显示，再在后台精确匹配数据库 Profile；兼容旧对话或本地配置 ID 不一致的情况，精确匹配失败时按供应商名称解析数据库中的标准 Profile ID。执行顺序固定为“显示本地缓存 → 解析数据库 ID → 读取数据库旧余额并更新缓存/UI → 再允许既有自动查询”，避免查询刷新与旧值读取互相取消。随后只按该数据库 ID 通过同一个 `POST /api/db/provider-balance` 自动刷新，因此固定 URL、New-API-User、上次成功路径和自动探测顺序与余额页完全共用。没有缓存和数据库余额时显示“无”；刷新成功时更新缓存和 UI，刷新失败时保留数据库中的旧余额，数据库读取本身失败时保留本地缓存或当前内存值，不把网络故障误判为“无余额”。对话页的余额始终使用普通默认样式，不显示查询状态颜色或勾叉图标；绿色勾和红色叉仅用于 `/balances` 余额查询页。

移动端（宽度不超过 `700px`）使用紧凑卡片布局：页面主标题和副标题整体居中，关闭按钮固定在右上角；卡片标题区保持供应商、New-API-User 和余额可读；字段标签与输入框使用固定标签列加自适应输入列，User ID 自动换到独立行；“全部查询”、“保存”和“更新”按钮保留图标与文字并撑满可用宽度，图标与文字内容组同时保持水平、垂直居中。

## 供应商路径

路径判定和查询顺序：

1. 用户填写的完整 URL 含非根路径时视为固定路径，只查询该路径；查询参数完整保留，但会尝试已缓存认证方式、Profile 认证方式及 Bearer、Raw Authorization、API Key、X-API-Key、Query-Key 等兼容认证。
2. 用户只填写域名或根地址时，使用该地址自动探测；如果该地址已有成功缓存且 Base URL 匹配，先直查缓存路径，失败后再进入完整探测。
3. 未填写 URL 时，先按数据库中的 `cached_path + cached_base_url + cached_auth_type` 直查；缓存失效后执行供应商专用路径和通用候选队列，成功后自动修正数据库缓存。
4. 通用队列先让高频路径覆盖全部认证组合，再保证全部声明路径至少可达一次，最后用剩余配额补齐其他组合；候选去重、分批执行并保持总量上限。
5. 解析器拒绝把 `null`、空字符串或布尔值误判为余额 `0`，同时兼容数字字符串、直接数值、嵌套余额、quota 折算和无限额度。

- YutoAPI、CherryIN：默认自动填充完整的 `/api/user/self` 地址，Bearer Key，并附带 `New-API-User`；默认地址可编辑。
- AihubMix / Inferera 镜像：使用数据库中保存的完整查询 URL，兼容管理 Key 鉴权方式。
- OpenRouter：`https://openrouter.ai/api/v1/credits`，Bearer Manage Key。
- 晴辰云：`POST /portal/login` 建立会话，再读取 `/portal/models` 或 `/portal/info`。
- 其他供应商：先使用数据库缓存的成功路径；无缓存时按有限候选路径与认证方式探测。

## 数据库字段

`provider_balance_configs` 以 `provider_config_id` 为主键，包含：

- `encrypted_management_key` / `masked_management_key`
- `balance_snapshot` / `last_error` / `queried_at` / `query_started_at`（防止旧慢请求覆盖新结果）
- `cached_path` / `cached_base_url` / `cached_auth_type`
- `custom_balance_url`
- `use_new_api_user_format` / `new_api_user_id`

API 配置备份的 `balanceEntries` 同步包含这些字段；恢复旧备份时，旧 payload 缺失的新字段不会覆盖数据库当前值。
