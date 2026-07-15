# NextChat 部署入口

当前仓库统一使用以下部署入口：

- 宝塔专项文档：[README_BAOTA.md](README_BAOTA.md)
- 生产固定路径、命令与验证：[AGENTS.md](AGENTS.md) 的“生产部署”章节
- 仓库文档入口：[README.md](README.md)

统一规则：

- 本地 Docker 开发默认使用 `.env.docker`
- 本地 Docker 开发默认使用 `./scripts/docker-compose-safe.sh`
- 本地开发使用 `--profile dev`
- 当前线上生产默认使用宝塔 DockerSite：`docker-compose.baota.yml` + `.env.baota`
- 非宝塔生产直连数据库可使用 `--profile no-proxy`
- 通过跳板机访问数据库时叠加 `--profile ssh-tunnel`
- 宝塔专用部署文档见 [README_BAOTA.md](README_BAOTA.md)
- 页面 URL 统一使用普通路径，例如 `/draw`、`/api_config`；旧 `/api-config` 和 `/#/...` 链接会自动迁移。

非宝塔 Docker 常用命令：

```bash
cp .env.docker.example .env.docker
HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= ./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy logs -f nextchat-production
```

服务器 `ss` 的标准宝塔 DockerSite 部署：

```bash
ssh ss 'tmux new-session -d -s nextchat-baota-deploy "cd /www/dk_project/my_NextChat && git pull --ff-only && ./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota build nextchat && (docker rm -f nextchat 2>/dev/null || true) && (docker image rm nextchat:latest 2>/dev/null || true) && ./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota up -d --force-recreate nextchat && ./scripts/sync-baota-dockersite-container-id.sh 2>&1 | tee /tmp/nextchat-baota-deploy.log"'
ssh ss 'tmux capture-pane -t nextchat-baota-deploy -p -S -120'
ssh ss 'tail -120 /tmp/nextchat-baota-deploy.log'
```

如果担心 SSH 在 `yarn build` 期间断开，优先放进 `tmux`：

```bash
ssh ss 'tmux new-session -d -s nextchat-baota-deploy "cd /www/dk_project/my_NextChat && ./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota build nextchat && ./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota up -d nextchat && ./scripts/sync-baota-dockersite-container-id.sh 2>&1 | tee /tmp/nextchat-baota-deploy.log"'
ssh ss 'tmux capture-pane -t nextchat-baota-deploy -p -S -120'
```

构建注意事项：

- `.env.docker` 中的 `HTTP_PROXY=http://host.docker.internal:7890` 在 Docker 构建阶段
  可能无法解析，导致 `yarn install` 失败。构建时必须覆盖为空。
- 如果 npmmirror 在构建阶段连接异常，可临时切换 NPM_REGISTRY 为 npmjs.org。
- `yarn install` 阶段耗时较长（5~10 分钟），建议使用 `tmux` 或 `nohup` 避免 SSH 超时。

宝塔专用更新命令：

```bash
ssh ss 'tmux new-session -d -s nextchat-baota-deploy "cd /www/dk_project/my_NextChat && git pull --ff-only && ./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota build nextchat && (docker rm -f nextchat 2>/dev/null || true) && (docker image rm nextchat:latest 2>/dev/null || true) && ./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota up -d --force-recreate nextchat && ./scripts/sync-baota-dockersite-container-id.sh 2>&1 | tee /tmp/nextchat-baota-deploy.log"'
ssh ss 'tmux capture-pane -t nextchat-baota-deploy -p -S -120'
```

宝塔 DockerSite 必须同步/保留的服务器路径：

- 项目目录：`/www/dk_project/my_NextChat`
- 环境变量：`/www/dk_project/my_NextChat/.env.baota`
- 宝塔 Compose：`/www/server/panel/data/compose/my_nextchat/docker-compose.yaml`
- 宝塔 Compose env：`/www/server/panel/data/compose/my_nextchat/.env`
- DockerSite 数据库：`/www/server/panel/data/db/docker.db`
- 普通站点冲突库：`/www/server/panel/data/db/site.db`
- DockerSite JSON：`/www/dk_project/sites/chat.dyxcloud.com/chat.dyxcloud.com.json`
- Nginx vhost：`/www/server/panel/vhost/nginx/chat.dyxcloud.com.conf`
- SSL 证书目录：`/www/server/panel/vhost/cert/chat.dyxcloud.com/`

完整宝塔流程以 `README_BAOTA.md` 为准。

最新排障结论：

- 如果 `https://chat.dyxcloud.com` 打不开，但服务器本机 `curl -k -I https://chat.dyxcloud.com/` 返回 `200`，
  但外部无代理访问 `chat.dyxcloud.com` 被 reset 或跳转到 DNSPod webblock，
  说明宝塔 nginx、证书和 NextChat 上游都正常，剩余问题在腾讯云/DNSPod/安全策略的域名公网链路拦截。
- 如果服务器本机 `curl -I http://127.0.0.1:3000/` 返回 `connection refused`，说明不是域名问题，而是 NextChat
  上游进程/容器没在跑。宝塔环境优先重新执行上面的宝塔专用更新命令。
- 如果访问 IP 正常、访问域名失败，必须额外检查带 SNI 的 TLS：

```bash
env -u https_proxy -u http_proxy -u HTTPS_PROXY -u HTTP_PROXY -u all_proxy -u ALL_PROXY \
  openssl s_client -connect 42.193.15.117:443 -servername chat.dyxcloud.com -brief
```

- 如果无 SNI 直连 IP 正常、带 `-servername chat.dyxcloud.com` 立刻 reset，而服务器本机 SNI 正常，
  说明 reset 发生在外部链路，不在 NextChat 进程内部。

## chat.dyxcloud.com 宝塔运维入口

域名、DockerSite、证书、数据库路径和当前验证步骤统一维护在 [README_BAOTA.md](README_BAOTA.md) 与 [AGENTS.md](AGENTS.md)，不再引用已移除的拆分 Runbook。

## 独立备份数据库（BACKUP_*）

自 2026-07-09 起，对话备份和 API 配置备份迁移到独立备份库，与主业务库物理隔离，避免
单点事故波及备份。生产部署必须显式配置以下环境变量（`.env.baota` 已包含示例）：

| 变量 | 必填 | 说明 |
| --- | --- | --- |
| `BACKUP_DATABASE_URL` | 优先 | 备份库完整连接字符串，覆盖其他 `BACKUP_PG*` |
| `BACKUP_PGHOST` | 是 | 备份库主机（未设置 `BACKUP_DATABASE_URL` 时使用） |
| `BACKUP_PGPORT` | 否 | 备份库端口，默认 `5432` |
| `BACKUP_PGDATABASE` | 是 | 备份库名（建议 `nextchat_backup`） |
| `BACKUP_PGUSER` | 是 | 备份库用户名 |
| `BACKUP_PGPASSWORD` | 是 | 备份库密码 |
| `BACKUP_PGSSL` | 否 | 是否启用 SSL（true/1/yes/on） |
| `BACKUP_PGSSLMODE` | 否 | SSL 模式；`require` 启用 SSL，`disable` 关闭 |
| `BACKUP_PGPOOL_MAX` | 否 | 连接池上限，默认 `5` |
| `BACKUP_PG_CONNECT_TIMEOUT_MS` | 否 | 连接超时，默认 `10000` |
| `BACKUP_PG_IDLE_TIMEOUT_MS` | 否 | 空闲超时，默认 `30000` |
| `BACKUP_PG_RETRY_COUNT` | 否 | 重试次数，默认 `3` |

未配置 `BACKUP_*` 时站内备份功能会**静默不可用**（调度器 try/catch 兜底）。生产灾备
仍以 PostgreSQL `pg_dump` / 宝塔计划任务为准，**主库和备份库都要纳入备份范围**。

### ⚠️ 部署检查清单（避免备份库连接失败）

**1. 密码必须一致**
- `BACKUP_PGPASSWORD` 必须与 PostgreSQL 中该用户对备份库的密码一致
- 如果备份库和主库是同一个 PostgreSQL 实例，`BACKUP_PGPASSWORD` 应与 `PGPASSWORD` 相同

**2. pg_hba.conf 必须允许容器 IP**
- Docker 容器使用网桥 IP（如 `172.17.0.x`）连接宿主机 PostgreSQL
- 必须在 `/www/server/pgsql/data/pg_hba.conf` 中添加对应网段规则：
  ```
  host    nextchat         dyx    172.17.0.0/16    md5
  host    nextchat_backup  dyx    172.17.0.0/16    md5
  ```
- 修改后执行 `su - postgres -c "/www/server/pgsql/bin/pg_ctl reload -D /www/server/pgsql/data"` 重载配置

**3. 环境变量变更需要重建容器**
- `docker restart` 不会重新读取 `.env` 文件
- 修改 `.env.baota` 后必须 `docker rm -f nextchat` 销毁旧容器，再用 `docker run` 或 `docker-compose up -d --force-recreate` 创建新容器
