# Docker 部署指南

本文档只保留当前仓库实际可用的一套 Docker 部署规则，避免文档与配置分叉。

## 1. 当前支持的 Profile

- `dev`
  本地开发热加载。
- `local-db`
  可选，本地 PostgreSQL，仅在开发时需要本地库才启用。
- `no-proxy`
  生产部署默认 profile，表示应用容器直连外部服务，不额外启用 SSH 隧道。
- `ssh-tunnel`
  可选，仅在数据库必须通过跳板机访问时叠加启用。
- `official`
  使用官方镜像快速运行。

推荐规则：

- 本地开发：`--profile dev`
- 本地开发且需要本地 PostgreSQL：`--profile dev --profile local-db`
- 生产部署默认：`--profile no-proxy`
- 生产部署走跳板机：`--profile no-proxy --profile ssh-tunnel`

## 2. 关键文件

- Compose 文件：[docker-compose.yml](../docker-compose.yml)
- Docker 构建文件：[Dockerfile](../Dockerfile)
- 环境变量模板：[.env.docker.example](../.env.docker.example)
- 安全包装脚本：[scripts/docker-compose-safe.sh](../scripts/docker-compose-safe.sh)

不要直接执行 `docker compose build`。默认使用包装脚本，避免部分环境在 `~/.docker/buildx/activity` 上报权限错误。

## 3. 首次生产部署

### 3.1 准备环境文件

```bash
cp .env.docker.example .env.docker
```

### 3.2 编辑 `.env.docker`

最少需要填写：

```dotenv
OPENAI_API_KEY=sk-xxxx
CODE=你的访问密码
```

如果启用数据库同步，推荐直接填写固定 PostgreSQL：

```dotenv
PGHOST=数据库地址
PGPORT=5432
PGDATABASE=nextchat
PGUSER=数据库用户名
PGPASSWORD=数据库密码
PGSSL=
PGSSLMODE=
```

也可以直接写：

```dotenv
DATABASE_URL=postgres://user:password@host:5432/dbname
```

如需覆盖构建镜像源，优先使用官方源：

```dotenv
APK_MIRROR=https://dl-cdn.alpinelinux.org/alpine
NPM_REGISTRY=https://registry.npmjs.org/
```

如果数据库必须通过跳板机访问：

```dotenv
PGHOST=postgres-ssh-tunnel
PGPORT=5432
PGDATABASE=nextchat
PGUSER=数据库用户名
PGPASSWORD=数据库密码

SSH_TUNNEL_HOST=跳板机地址
SSH_TUNNEL_PORT=222
SSH_TUNNEL_USER=登录用户
SSH_TUNNEL_PASSWORD=登录密码
SSH_TUNNEL_REMOTE_HOST=目标数据库地址
SSH_TUNNEL_REMOTE_PORT=5432
SSH_TUNNEL_LOCAL_PORT=5432
```

### 3.3 构建并启动

固定 PostgreSQL 直连：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d
```

通过 SSH 隧道访问数据库：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy --profile ssh-tunnel build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy --profile ssh-tunnel up -d
```

### 3.4 当前生产构建约定

- 生产环境默认直接在远程服务器执行 Docker 官方构建。
- 构建源默认使用官方仓库：
  - `APK_MIRROR=https://dl-cdn.alpinelinux.org/alpine`
  - `NPM_REGISTRY=https://registry.npmjs.org/`
- 不再把第三方 Alpine / npm 镜像源作为默认文档路径。
- 如果服务器性能允许，优先使用远程服务器本地构建再 `up -d`，减少本地跨架构构建和镜像传输的不确定性。

## 4. 验证部署

查看容器状态：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker ps
```

查看应用日志：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy logs -f nextchat-production
```

检查应用健康：

```bash
curl http://127.0.0.1:3000/api/config
```

检查数据库健康：

```bash
curl http://127.0.0.1:3000/api/db/health
```

期望返回大致为：

- `ok: true`
- `postgres.configuredHost`
- `postgres.configuredPort`
- `postgres.database`
- `postgres.user`
- `modelCatalogCount`

如果宿主机访问 `127.0.0.1:3000` 异常，但容器已经 `Up`，优先在容器内验证：

```bash
docker exec nextchat wget -S -O - http://127.0.0.1:3000
```

如果容器内返回 `HTTP/1.1 200 OK`，通常说明应用已经启动，问题更可能在宿主机代理、端口转发或外层网关。

## 5. 后续维护

仅重启：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy restart
```

代码更新后重新部署：

```bash
git pull
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d
```

停止服务：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy down
```

## 6. 本地 Docker 开发

启动开发环境：

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev up -d
```

如果需要本地 PostgreSQL：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile local-db up -d
```

查看开发日志：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev logs -f nextchat-dev
```

说明：

- 普通业务代码改动后依赖热加载，不要重启容器。
- 只有 `package.json`、`yarn.lock`、`Dockerfile` 变更时，才建议重新 build。
- `WATCHPACK_POLLING` 和 `CHOKIDAR_USEPOLLING` 默认保持 `false`，只有 Docker Desktop 文件监听不稳定时再开启。
- 首次访问开发环境可能需要等待首轮编译完成。

## 7. 官方镜像快速运行

如果不需要自建镜像：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile official up -d
```

或直接使用 Docker：

```bash
docker run -d -p 3000:3000 \
  -e OPENAI_API_KEY=sk-xxxx \
  -e CODE=你的访问密码 \
  yidadaa/chatgpt-next-web
```
