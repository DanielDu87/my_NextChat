# NextChat PostgreSQL Docker 部署说明

当前仓库默认方案是：

- 应用容器继续使用 Docker 运行 NextChat
- 数据库存储默认直连固定 PostgreSQL
- 只有必须通过跳板机访问数据库时，才额外启用 `ssh-tunnel` profile

## 1. 直连 PostgreSQL

推荐直接在 `.env.docker` 中填写：

```env
PGHOST=your-db-host
PGPORT=5432
PGDATABASE=nextchat
PGUSER=your_db_user
PGPASSWORD=your_db_password
PGSSL=
PGSSLMODE=
PGPOOL_MAX=10
PG_CONNECT_TIMEOUT_MS=10000
PG_IDLE_TIMEOUT_MS=30000
```

也可以直接使用：

```env
DATABASE_URL=postgresql://your_db_user:your_db_password@your-db-host:5432/nextchat
```

启动方式：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d
```

## 2. 通过 SSH 隧道访问 PostgreSQL

只有数据库无法直连时，才启用该方案。

`.env.docker` 示例：

```env
PGHOST=postgres-ssh-tunnel
PGPORT=5432
PGDATABASE=nextchat
PGUSER=your_db_user
PGPASSWORD=your_db_password

SSH_TUNNEL_HOST=jump-host
SSH_TUNNEL_PORT=222
SSH_TUNNEL_USER=root
SSH_TUNNEL_PASSWORD=your_ssh_password
SSH_TUNNEL_REMOTE_HOST=real-db-host
SSH_TUNNEL_REMOTE_PORT=5432
SSH_TUNNEL_LOCAL_PORT=5432
```

启动方式：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy --profile ssh-tunnel up -d
```

这里的 `postgres-ssh-tunnel` 是 compose 服务名，不是外部主机名。

## 3. 模型目录同步（v4 优化后）

模型目录同步在 v4 优化（2026-06-11）后**不再写 `model_catalog`**，全部收敛到 `app_settings` JSONB：

- `app_settings.security_settings -> 'access-control'` 的 `apiProfiles[*].cachedModels`
- `app_settings.extra_settings -> 'app-config'` 的 `models` 集合
- `app_settings.extra_settings -> 'model-cache-store'` 的缓存

历史脚本 `yarn db:sync-models` 已改为 no-op（仅输出 `skipped: true`），因为 `provider-model-sync.ts` 在拉取时已经把模型数据合并到 `access-control` JSONB，无需额外落盘。

如果需要重新触发一次模型刷新：

```bash
yarn db:refresh-provider-models
# 或
curl -X POST http://127.0.0.1:3000/api/db/models/refresh \
  -H "Authorization: Bearer $MODEL_SYNC_TOKEN"
```

## 4. 健康检查

应用启动后可以检查：

```bash
curl http://127.0.0.1:3000/api/db/health
```

返回结构包含：

- `ok`
- `postgres.now`
- `postgres.version`
- `postgres.database`
- `postgres.user`
- `postgres.configuredHost`
- `postgres.configuredPort`
- `schemaVersion`（v4 优化后输出，例：`2026-06-11-sync-storage-v4`）
- ~~`modelCatalogCount`~~（v4 优化后已移除；模型计数请改读 `app_settings.security_settings -> 'access-control' -> apiProfiles[*].cachedModels.length`）

## 5. 迁移顺序建议

不要一次性把前端本地存储全部硬切到数据库，建议按这个顺序：

1. `app_settings(chat/plugin/security/extra) / provider_configs / provider_api_keys`（结构化云端）
2. `conversations / messages`
3. `sync_secrets / auth_sessions / site_access_settings`
4. ~~`model_catalog / model_sync_runs`~~（v4 已下线）
5. ~~`message_attachments / tags / share_links / model_aliases`~~（历史表已下线）

这样可以先迁移服务端只读和后台数据，再迁移聊天主链路。
