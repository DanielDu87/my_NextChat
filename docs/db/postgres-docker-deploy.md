# NextChat PostgreSQL Docker 部署说明

这套接入分成两层：

- 应用容器继续用 Docker 跑 NextChat
- 主数据落 PostgreSQL

当前仓库已经提供：

- 表结构 SQL：[nextchat-postgres-schema.sql](/Users/dyx/Code/NextChat/docs/db/nextchat-postgres-schema.sql)
- PostgreSQL 健康检查接口：`/api/db/health`
- 模型目录同步脚本：`yarn db:sync-models`

## 1. Docker 环境变量

在部署容器时至少传这些变量：

```env
PGHOST=postgres-ssh-tunnel
PGPORT=5432
PGDATABASE=nextchat
PGUSER=dyx
PGPASSWORD=your_password
PGSSL=false
PGPOOL_MAX=10
PG_CONNECT_TIMEOUT_MS=10000
PG_IDLE_TIMEOUT_MS=30000
SSH_TUNNEL_HOST=42.193.15.117
SSH_TUNNEL_PORT=222
SSH_TUNNEL_USER=root
SSH_TUNNEL_PASSWORD=your_ssh_password
SSH_TUNNEL_REMOTE_HOST=127.0.0.1
SSH_TUNNEL_REMOTE_PORT=5432
SSH_TUNNEL_LOCAL_PORT=5432
```

也可以直接用：

```env
DATABASE_URL=postgresql://dyx:your_password@postgres-ssh-tunnel:5432/nextchat
```

## 2. 模型目录同步

如果模型目录仍然放在 WebDAV，再加：

```env
WEBDAV_BASE_URL=https://webdav.example.com/chatgpt-next-web
WEBDAV_USERNAME=your_webdav_user
WEBDAV_PASSWORD=your_webdav_password
```

然后执行：

```bash
yarn db:sync-models
```

脚本会把 `models/index.json` 以及各 provider 的模型文件同步进 `model_catalog`。

## 3. 健康检查

应用启动后可以检查：

```bash
curl http://127.0.0.1:3000/api/db/health
```

返回内容包括：

- PostgreSQL 版本
- 当前数据库名
- 当前用户
- `model_catalog` 行数

## 4. 迁移顺序建议

不要一次性把前端本地存储全部硬切到数据库，建议按这个顺序：

1. `model_catalog / model_sync_* / app_settings(model_settings)`
2. `provider_configs / provider_api_keys`
3. `conversations / messages / message_attachments`
4. `app_settings(extra/plugin/sync/security) / auth_* / usage_logs / audit_logs`

这样可以先把服务端只读和后台数据迁过去，再迁聊天主链路。
