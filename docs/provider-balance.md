# 余额查询

余额查询页路径为 `/balances`，真实数据 owner 是 PostgreSQL 的 `provider_configs` 与 `provider_balance_configs`。余额页和对话页都直接读取数据库余额，不使用浏览器持久化余额缓存。

## 数据流

- `GET /api/db/provider-balance`：无参数时读取全局供应商列表、查询配置、最近余额和错误；携带 `profileId` 时只返回该 Profile 的数据库余额和错误，供对话页使用。
- `PUT /api/db/provider-balance`：一次请求原子保存管理 Key、自定义查询 URL、New-API-User 开关和 User ID。管理 Key 单独加密保存，User ID 存入 `new_api_user_id`，不再拼接后由浏览器传回查询接口。
- `POST /api/db/provider-balance`：只接收 `profileId`。服务端重新从数据库读取全部查询配置，成功后保存余额与成功路径，失败时保留旧余额并更新错误和查询时间。

页面首开只读取并显示数据库中的余额与配置，不自动发起余额查询；仅在用户点击单项“更新”或“全部更新”时查询。单项与批量查询遇到未保存表单时要求先保存。批量查询超时会取消前端请求，短暂网络或上游错误不会清空页面和聊天页已有余额。查询成功时余额立即替换为接口返回的新数字并显示绿色；查询失败时保留旧余额但将数字显示为红色。查询 URL 始终显示完整地址；自动探测路径、缓存成功路径和 New-API-User 默认路径都只是自动填充，输入框保持可编辑，保存后以用户填写值为准。已有固定 URL 时输入框使用绿色文字标识，尚未探测且为空时保持默认颜色。

对话页按当前 `profileId` 从数据库读取余额；没有数据库余额时显示“无”。自动刷新仍通过同一个 `POST /api/db/provider-balance`，只提交 Profile ID，因此固定 URL、New-API-User、上次成功路径和自动探测顺序与余额页完全共用。查询失败时接口返回数据库中的旧余额，对话页继续显示旧值；数据库读取本身失败时保留当前内存值，不把网络故障误判为“无余额”。

## 供应商路径

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
