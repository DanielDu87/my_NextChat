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
- 生产无代理部署脚本：[scripts/deploy-production-no-proxy.sh](../scripts/deploy-production-no-proxy.sh)

不要直接执行 `docker compose build`。默认使用包装脚本，避免部分环境在 `~/.docker/buildx/activity` 上报权限错误。

构建环境约定：

- `Dockerfile` 采用官方 `node:20.19.0-alpine3.20` 作为构建与运行阶段基础镜像，避免 Alpine 仓库的 `nodejs` 版本过旧导致依赖 `engines.node` 不匹配。
- 依赖管理使用 `corepack + yarn@1.22.22`（构建阶段激活），以确保构建可复现。

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
./scripts/deploy-production-no-proxy.sh
```

脚本会自动执行：

- `git pull --ff-only`
- 清空 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 及小写代理变量
- 使用 `NPM_REGISTRY=https://registry.npmjs.org`
- 使用 `ALPINE_MIRROR=https://mirrors.aliyun.com/alpine`
- 调用 `scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build`
- 调用 `scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d`
- 等待容器健康
- 在容器内请求 `http://127.0.0.1:3000/api/config` 做 HTTP 自检

如果只想测试脚本但不拉取代码：

```bash
SKIP_PULL=1 ./scripts/deploy-production-no-proxy.sh
```

如需临时覆盖 registry 或 Alpine 镜像：

```bash
NPM_REGISTRY=https://registry.npmjs.org \
ALPINE_MIRROR=https://mirrors.aliyun.com/alpine \
./scripts/deploy-production-no-proxy.sh
```

通过 SSH 隧道访问数据库：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy --profile ssh-tunnel build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy --profile ssh-tunnel up -d
```

服务器 `sss` 的推荐执行方式：

```bash
ssh sss 'cd /www/dk_project/my_NextChat && ./scripts/deploy-production-no-proxy.sh'
```

如果担心 SSH 在远程 `next build` 阶段断开，优先放到 `tmux`：

```bash
ssh sss 'tmux new-session -d -s nextchat-deploy "cd /www/dk_project/my_NextChat && ./scripts/deploy-production-no-proxy.sh 2>&1"'
ssh sss 'tmux capture-pane -t nextchat-deploy -p -S -80'
```

### 3.4 当前生产构建约定

- 生产环境默认直接在远程服务器执行 Docker 官方构建。
- 生产部署默认不使用代理，不依赖 `.env.docker` 中的代理变量。
- 部署脚本会显式清空代理变量，避免 `host.docker.internal` 在 Docker build 阶段无法解析。
- 当前实测最快稳定方式是保留 Docker 构建缓存，避免触发冷依赖安装。
- 不要为了每次部署写入 commit metadata 而传入会影响 `base/deps` 层的 build args；这会打穿依赖缓存。
- `package.json`、`yarn.lock`、`Dockerfile` 或构建源变更时，可能触发较慢的冷构建。
- 如果服务器性能允许，优先使用远程服务器本地构建再 `up -d`，减少本地跨架构构建和镜像传输的不确定性。

近期远程实测结果：

- 无代码变化、全部缓存命中：约 `8.78s`
- 有代码变化、依赖缓存命中：约 `3:40.54`，主要耗时是 `next build`
- 冷依赖安装：无代理下不稳定，容易停在 `yarn install` 的 `[2/4] Fetching packages...`

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

容器内自检：

```bash
docker exec nextchat wget -q -O /dev/null http://127.0.0.1:3000/api/config && echo ok
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
./scripts/deploy-production-no-proxy.sh
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

## 8. 构建故障排查

### yarn install 反复报网络错误

**现象**：`yarn install` 阶段一直卡在 `[2/4] Fetching packages...`，反复输出 `info There appears to be trouble with your network connection. Retrying...`。

**可能原因和解决**：

1. **构建代理无法解析** — `.env.docker` 中的 `HTTP_PROXY=http://host.docker.internal:7890`
   会被传入 Docker build args，但 `host.docker.internal` 在构建阶段通常无法解析。
   构建时覆盖代理变量即可：

   ```bash
   HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= http_proxy= https_proxy= all_proxy= \
     ./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build
   ```

2. **npmmirror 连接限制** — `NPM_REGISTRY=https://registry.npmmirror.com/` 在容器构建
   环境下可能存在连接限制。临时切换为官方 registry：

   ```bash
   NPM_REGISTRY=https://registry.npmjs.org \
     ./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build
   ```

   官方源速度较慢（特别是国内服务器），但连接稳定。

### SSH 构建超时

**现象**：构建进行到 `yarn install` 或 `next build` 时 SSH 连接断开。

**解决**：优先使用部署脚本；如果 SSH 环境会断开，放到 `tmux` 后台运行：

```bash
ssh sss 'tmux new-session -d -s nextchat-deploy "cd /www/dk_project/my_NextChat && ./scripts/deploy-production-no-proxy.sh 2>&1"'
# 随时查看进度
ssh sss 'tmux capture-pane -t nextchat-deploy -p -S -80'
```

如果只剩旧的手动部署方式可用，才使用：

```bash
HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= http_proxy= https_proxy= all_proxy= \
  NPM_REGISTRY=https://registry.npmjs.org \
  ./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d
```

### 域名打不开，但 IP 地址正常

先不要直接认定是 DNS 问题，按下面顺序排查：

1. 检查应用上游是否在线：

```bash
curl -I http://127.0.0.1:3000/
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

如果这里已经 `connection refused`，说明 NextChat 容器/进程没跑起来，优先重新部署。

2. 检查服务器本机经 nginx + Host 访问是否正常：

```bash
curl -k -I -H "Host: ngpt.chat" https://127.0.0.1/
```

如果这里返回 `200`，说明：

- nginx 正常
- 证书正常
- `ngpt.chat -> 127.0.0.1:3000` 反代正常

3. 再区分是不是公网 443 的 SNI/TLS 链路问题：

```bash
env -u https_proxy -u http_proxy -u HTTPS_PROXY -u HTTP_PROXY -u all_proxy -u ALL_PROXY \
  openssl s_client -connect 42.193.15.117:443 -brief

env -u https_proxy -u http_proxy -u HTTPS_PROXY -u HTTP_PROXY -u all_proxy -u ALL_PROXY \
  openssl s_client -connect 42.193.15.117:443 -servername ngpt.chat -brief
```

如果无 SNI 正常、带 `-servername ngpt.chat` 被 reset，而服务器本机测试又正常，
那么问题在服务器外部链路，不在 NextChat 应用进程内部。
