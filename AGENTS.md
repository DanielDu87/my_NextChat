# NextChat 仓库约定

## 本地 Docker 开发

- 本项目本地 Docker 开发统一使用 `dev` profile
- 默认使用 [scripts/docker-compose-safe.sh](./scripts/docker-compose-safe.sh) 包装 `docker compose`
- 不要直接执行 `docker compose build`
  因为部分环境会在 `~/.docker/buildx/activity` 报权限错误；包装脚本会自动把 `BUILDX_CONFIG` 指向 `/tmp/nextchat-docker-buildx`
- 启动命令：

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev up -d
```

- 查看日志：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev logs -f chatgpt-next-web-dev
```

- 停止开发容器：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev down
```

## 热加载规则

- 普通业务代码修改后，不要重启容器，不要重新构建镜像
- 开发容器内使用 `next dev`，应依赖热加载生效
- 只有 `package.json`、`yarn.lock`、`Dockerfile` 变更时，才重新执行 `docker compose ... build`
- `WATCHPACK_POLLING` 和 `CHOKIDAR_USEPOLLING` 默认保持 `false`
- 只有在 Docker Desktop 等环境下文件监听不稳定时，才开启 polling

## 生产部署

- 生产部署统一使用 `--profile no-proxy`
- 部署和启动流程默认不使用代理
- 生产部署也默认使用 [scripts/docker-compose-safe.sh](./scripts/docker-compose-safe.sh)
- 默认使用固定 PostgreSQL 直连，不依赖 `postgres-ssh-tunnel`
- 当前固定数据库配置保存在 `.env.docker`
- 后续部署时优先保留并沿用 `.env.docker` 中已有的数据库连接参数
- 只有用户明确要求通过跳板机访问数据库时，才启用 `--profile ssh-tunnel`
- 生产容器必须保留 `HOSTNAME=0.0.0.0`
  否则 Next.js standalone 进程在部分 Docker 环境中可能报 `getaddrinfo EAI_AGAIN`

## AI 部署注意事项

- 构建时优先使用仓库内置的 `vendor/rt-client-0.5.0.tgz`
- 默认关闭 Google Fonts、ShareGPT、MCP 市场、Edge TTS 等海外运行期依赖，除非用户明确要求开启
- 如果 Docker 生产构建失败，先检查 `buildx`、`.dockerignore`、构建上下文和环境变量，不要先假设是外网问题
- 版本号来自 `package.json`
  如果页面里出现 `vundefined`，先检查 `package.json` 的 `version`
- 如果宿主机访问 `127.0.0.1:3000` 异常，但容器日志显示 `Ready`
  先在容器内执行 `wget http://127.0.0.1:3000`，再判断是不是宿主机代理或端口转发干扰
