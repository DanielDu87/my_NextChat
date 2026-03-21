# NextChat 仓库约定

## 本地 Docker 开发

- 本项目本地 Docker 开发统一使用 `dev` profile
- 启动命令：

```bash
cp .env.docker.example .env.docker
docker compose --env-file .env.docker --profile dev build
docker compose --env-file .env.docker --profile dev up -d
```

- 查看日志：

```bash
docker compose --env-file .env.docker --profile dev logs -f chatgpt-next-web-dev
```

- 停止开发容器：

```bash
docker compose --env-file .env.docker --profile dev down
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
- 默认使用固定 PostgreSQL 直连，不依赖 `postgres-ssh-tunnel`
- 当前固定数据库配置保存在 `.env.docker`
- 后续部署时优先保留并沿用 `.env.docker` 中已有的数据库连接参数
- 只有用户明确要求通过跳板机访问数据库时，才启用 `--profile ssh-tunnel`
