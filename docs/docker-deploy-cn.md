# Docker 部署指南（AI 优化）

本指南面向两类读者：

- 人工部署
- AI / 自动化代理执行部署

为了提高 AI 执行成功率，本文档遵循以下原则：

- 所有文件名写死
- 所有命令可直接复制
- 区分“首次部署”“后续更新”“仅重启”
- 明确使用哪个 `docker compose profile`
- 所有国内加速变量单独列出

## 1. 部署方式

本项目支持两种 Docker 部署方式：

1. 官方镜像
适合不改代码、只想快速运行。

2. 本仓库自建镜像
适合以下场景：
- 你修改了代码
- 你要使用国内加速源
- 你要使用本仓库内置的 `docker-compose.yml`
- 你需要数据库 / WebDAV / SSH 隧道等扩展配置

如果你是 AI / 自动化代理，优先使用“本仓库自建镜像”方式。

## 2. 先决条件

服务器建议：

- 仅运行已构建镜像：`2C4G`
- 服务器本机执行 `docker build`：建议 `4C8G`

软件要求：

```bash
docker --version
docker compose version
```

## 3. 关键文件

AI 在执行部署时，优先使用以下文件：

- Compose 文件：[docker-compose.yml](../docker-compose.yml)
- Docker 镜像定义：[Dockerfile](../Dockerfile)
- Docker 环境变量模板：[.env.docker.example](../.env.docker.example)

## 4. 推荐的 Compose Profile

本项目 `docker-compose.yml` 中有三个 profile：

- `no-proxy`
适用于部署与生产运行。推荐默认使用。

- `dev`
仅用于开发，不用于服务器正式部署。

生产部署时：

- 一律使用 `--profile no-proxy`
- 不要在生产服务器上使用 `--profile dev`

## 5. 首次部署

### 5.1 复制部署环境文件

```bash
cp .env.docker.example .env.docker
```

### 5.2 编辑 `.env.docker`

最少需要填写：

```dotenv
OPENAI_API_KEY=sk-xxxx
CODE=你的访问密码
```

数据库部署约定：

- 本项目默认使用固定 PostgreSQL 直连
- 不默认启用 `postgres-ssh-tunnel`
- 后续服务器部署时，优先沿用 `.env.docker` 中现有的数据库连接配置
- 只有明确需要跳板机时，才额外启用 `--profile ssh-tunnel`

当前推荐的数据库填写方式是：

```dotenv
PGHOST=数据库固定地址
PGPORT=5432
PGDATABASE=数据库名
PGUSER=数据库用户名
PGPASSWORD=数据库密码
```

也可以直接填写：

```dotenv
DATABASE_URL=postgres://user:password@host:5432/dbname
```

国内服务器推荐同时填写：

```dotenv
ALPINE_MIRROR=https://mirrors.aliyun.com/alpine
NPM_REGISTRY=https://registry.npmmirror.com/
RT_CLIENT_TGZ_URL=https://你自己的国内地址/rt-client-0.5.0.tgz
```

说明：

- `ALPINE_MIRROR`
Alpine `apk` 包源。Dockerfile 已支持通过 build arg 替换。

- `NPM_REGISTRY`
npm / yarn registry。默认值已是 `https://registry.npmmirror.com/`。

- `RT_CLIENT_TGZ_URL`
`rt-client` 的 tgz 下载地址。默认是 GitHub release 直链，国内服务器建议替换成你自己的 OSS / COS / CDN / 制品库地址。

### 5.3 构建并启动

```bash
docker compose --env-file .env.docker --profile no-proxy build
docker compose --env-file .env.docker --profile no-proxy up -d
```

## 6. 验证部署是否成功

### 6.1 查看容器状态

```bash
docker compose --env-file .env.docker ps
```

### 6.2 查看应用日志

无代理部署：

```bash
docker compose --env-file .env.docker logs -f chatgpt-next-web
```

### 6.3 检查数据库健康接口

如果启用了数据库同步，可检查：

```bash
curl http://127.0.0.1:3000/api/db/health
```

期望结果应包含：

- `ok: true`
- `configuredHost`
- `configuredPort`
- `database`
- `user`

## 7. 后续维护

### 7.1 仅重启服务

```bash
docker compose --env-file .env.docker --profile no-proxy restart
```

### 7.2 更新代码后重新部署

```bash
git pull
docker compose --env-file .env.docker --profile no-proxy build
docker compose --env-file .env.docker --profile no-proxy up -d
```

### 7.3 停止服务

```bash
docker compose --env-file .env.docker --profile no-proxy down
```

## 8. 官方镜像快速运行

如果不需要自建镜像，可以直接运行官方镜像：

```bash
docker pull yidadaa/chatgpt-next-web

docker run -d -p 3000:3000 \
  -e OPENAI_API_KEY=sk-xxxx \
  -e CODE=你的访问密码 \
  yidadaa/chatgpt-next-web
```

## 9. 面向 AI 的执行建议

如果以后由 AI 自动部署，建议严格按下面顺序执行：

1. 读取 [docker-compose.yml](../docker-compose.yml)
2. 复制 [.env.docker.example](../.env.docker.example) 为 `.env.docker`
3. 补齐 `.env.docker` 的必填变量
4. 使用 `--profile no-proxy`
5. 执行 `docker compose --env-file .env.docker --profile no-proxy build`
6. 执行 `docker compose --env-file .env.docker --profile no-proxy up -d`
7. 执行 `docker compose --env-file .env.docker ps`
8. 如果启用了数据库，同步检查 `curl http://127.0.0.1:3000/api/db/health`

数据库规则补充：

- 默认沿用 `.env.docker` 中已有的固定数据库配置
- 不要在部署时改回 `postgres-ssh-tunnel`
- 不要默认启用 `ssh-tunnel` profile

AI 不应在生产服务器使用 `dev` profile。

AI 不应假设每次启动都需要重新构建镜像。

正确规则：

- 首次部署：需要 `build`
- 代码更新：需要 `build`
- 仅重启：不需要 `build`

## 10. 本地 Docker 开发与热加载

如果目标是本地开发，而不是生产部署，使用 `dev` profile：

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker --profile dev build
docker compose --env-file .env.docker --profile dev up -d
```

开发模式特点：

- 使用源码挂载
- 启动 `next dev`
- 修改大多数文件后会自动热更新
- 不需要每次手动重启容器
- 不需要每次重新构建镜像

### 热加载相关变量

`.env.docker.example` 中已经提供以下开发变量：

```dotenv
WATCHPACK_POLLING=false
WATCHPACK_POLLING_INTERVAL=1000
CHOKIDAR_USEPOLLING=false
CHOKIDAR_INTERVAL=1000
```

推荐规则：

- Linux 本地开发 / 大多数服务器开发环境：
  保持 `false`
- Docker Desktop（macOS / Windows）如果发现改文件后不能及时热更新：
  再改成 `true`

说明：

- 默认关闭 polling，优先使用原生文件事件，热更新更快、CPU 更低
- 只有文件监听异常时，才建议打开 polling

### 面向 AI 的开发规则

如果任务是“本地开发 + 热加载”，AI 应执行：

1. 使用 `--profile dev`
2. 不要使用生产 profile
3. 不要在每次改文件后执行 `docker compose build`
4. 不要在每次改文件后重启容器
5. 只有以下情况才重新 build：
   - `package.json` / `yarn.lock` 变更
   - `Dockerfile` 变更
   - 需要重建基础依赖层
