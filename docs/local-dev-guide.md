# NextChat 本地开发指南

本文档为本地开发入口。当前默认开发方式是 Docker `dev` profile 热加载，不再默认启动本地 PostgreSQL。

## 标准启动

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev logs -f nextchat-dev
```

访问：<http://localhost:3000>

常用页面地址：

- 聊天页：<http://localhost:3000/chat>
- 绘图页：<http://localhost:3000/draw>
- 绘图历史：<http://localhost:3000/draw/history>
- API 配置：<http://localhost:3000/api-config>

项目当前统一使用普通路径 URL。旧的 `/#/draw`、`/#/settings`、`/#/auth` 等 hash 地址会自动跳转到对应普通路径。

停止：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev down
```

## 热加载规则

- 普通业务代码修改后依赖 `next dev` 热加载，不要重启容器，不要重新构建镜像。
- 只有 `package.json`、`yarn.lock`、`Dockerfile` 变更时，才重新执行 build。
- `WATCHPACK_POLLING` 和 `CHOKIDAR_USEPOLLING` 默认保持 `false`。

## 数据库说明

- 当前默认使用 `.env.docker` 中配置的外部 PostgreSQL 或 `DATABASE_URL`。
- `local-db` profile 是历史兼容选项，默认不要启用。
- 如用户明确要求本地 PostgreSQL，再检查 `docker-compose.yml`、`.env.docker` 和数据风险后叠加 `--profile local-db`。

## 验证

```bash
curl http://localhost:3000/api/config
curl http://localhost:3000/api/db/health
```

更多部署与故障排查见：

- [docs/development.md](development.md)
- [docs/docker-deploy-cn.md](docker-deploy-cn.md)
