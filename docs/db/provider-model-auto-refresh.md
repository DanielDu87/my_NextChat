# 模型供应商自动更新

## 推荐触发方式

### 方式一：宝塔计划任务执行脚本

在应用容器内执行：

```bash
docker compose exec -T chatgpt-next-web-dev yarn db:refresh-provider-models
```

建议频率：

- 模型数据：每 6 小时一次

### 方式二：调用受控接口

接口：

```bash
POST /api/db/models/refresh
```

如果设置了 `MODEL_SYNC_TOKEN`，调用方式：

```bash
curl -X POST http://127.0.0.1:3000/api/db/models/refresh \
  -H "Authorization: Bearer $MODEL_SYNC_TOKEN"
```

## 更新来源

- 来源于云端 `access-control` 的结构化 provider 配置
- 实际读取来源为：
  - `provider_configs`
  - `provider_api_keys`
  - `sync_secrets`
- 仅处理已配置 `baseUrl + apiKey` 的 profile
- 自动更新实现采用“注册表 + 默认兼容策略”
  - 已知供应商走固定 preset
  - 新增供应商如果提供 OpenAI 兼容 `/models` 或 `/pricing` 接口，不需要改同步主流程
  - 只要出现在 `apiProfiles` 里，就会被自动纳入刷新任务
- 只有当新供应商的模型列表接口完全不兼容现有候选路径时，才需要补一个新的 fetch adapter
- 拉取后会更新：
  - PostgreSQL `model_catalog`
  - PostgreSQL `model_sync_runs`
  - PostgreSQL `app_settings.model_settings` 中的 `app-config`
  - PostgreSQL `app_settings.model_settings` 中的 `model-cache-store`

## 结果

- 页面不会在加载时直接请求供应商接口
- 本地只做版本检查
- 供应商模型变化会先进入 PostgreSQL
- 页面下次检查到版本变化时，再按需同步到本地
