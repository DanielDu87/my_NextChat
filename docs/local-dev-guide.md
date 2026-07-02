# NextChat 本地开发指南

本文档是本地开发快速入口；架构细节见 [开发指南](development.md)。当前默认开发方式是 Docker `dev` profile 热加载，不默认启动本地 PostgreSQL。

## 标准启动（推荐）

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile ssh-tunnel up -d --build postgres-ssh-tunnel
NEXTCHAT_DISABLE_AUTH=true NEXTCHAT_LOCAL_BYPASS_USER=ccc PGHOST=postgres-ssh-tunnel PGPORT=5432 SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel logs -f nextchat-dev
```

访问：<http://localhost:3000>

常用页面地址：

- 聊天页：<http://localhost:3000/chat>
- 指定会话：`http://localhost:3000/chat/<session-id>`
- 绘图页：<http://localhost:3000/draw>
- 绘图历史：<http://localhost:3000/draw/history>
- API 配置：<http://localhost:3000/api-config>
- API 配置备份：<http://localhost:3000/api-config/backups>

项目统一使用普通路径 URL。旧的 `/#/draw`、`/#/settings`、`/#/auth` 等 hash 地址会自动跳转到对应普通路径。

停止：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev down
```

## 热加载规则

- 普通业务代码修改后依赖 `next dev` 热加载，不要重启容器，不要重新构建镜像。
- 只有 `package.json`、`yarn.lock`、`Dockerfile` 变更时，才重新执行 build。
- `WATCHPACK_POLLING` 和 `CHOKIDAR_USEPOLLING` 默认保持 `false`；只有 Docker Desktop 文件监听异常时再开启。

## 本地鉴权与用户

- 本地热加载默认临时覆盖 `NEXTCHAT_DISABLE_AUTH=true`，避免登录流程阻塞回归。
- 免登录用户由 `NEXTCHAT_LOCAL_BYPASS_USER=ccc` 决定，读写和同步都按 `ccc` 处理。
- 该变量只允许用于本地 dev，不要写入 `.env.baota` 或生产环境变量。
- 生产/宝塔环境默认用正常密码鉴权进入 `admin`。

## 数据库说明

- 默认通过 `postgres-ssh-tunnel` 容器连接远端 PostgreSQL，开发容器使用 `PGHOST=postgres-ssh-tunnel PGPORT=5432`。
- `local-db` profile 是历史兼容选项，默认不要启用。
- 如用户明确要求本地 PostgreSQL，再检查 `docker-compose.yml`、`.env.docker` 和数据风险后叠加 `--profile local-db`。
- 表结构由运行时自动建表/迁移：同步 schema 当前为 `2026-06-28-api-config-backup-counts`，认证 schema 当前为 `2026-06-11-auth-last-chat`。
- 常用维护脚本：`yarn db:health`、`yarn db:refresh-provider-models`、`yarn db:migrate-*`，完整列表见 [package.json](../package.json) 的 `db:*` 脚本。

## 前后端开发入口

- 前端入口：`app/components/home.tsx`、`app/components/chat.tsx`、`app/components/draw/`、`app/components/api-config.tsx`。
- 状态入口：`app/store/chat.ts`、`app/store/access.ts`、`app/store/config.ts`、`app/store/draw.ts`。
- 同步入口：`app/utils/sync-store-keys.ts`、`app/utils/chat-sync.ts`、`app/utils/provider-sync.ts`。
- 服务端 API：`app/api/*`。
- 数据库 repository：`app/utils/server/*`。

## 验证

```bash
curl http://localhost:3000/api/config
curl http://localhost:3000/api/db/health
yarn lint
yarn build
```

如果只改前端交互，优先在浏览器手工验证目标页面；当前仓库不再使用 `yarn test` / `yarn test:ci` 作为默认验证命令。

更多文档：

- [docs/development.md](development.md)
- [docs/docker-deploy-cn.md](docker-deploy-cn.md)
- [docs/db/data-storage-sync-matrix.md](db/data-storage-sync-matrix.md)
