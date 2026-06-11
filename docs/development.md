# NextChat 开发指南

本仓库的 Docker 开发与部署以 Profile 为中心，文档以“仓库实际可用的流程”为准，避免与历史脚本/环境分叉。

## 文档入口

- Docker 部署与本地开发（权威）：[docs/docker-deploy-cn.md](docker-deploy-cn.md)
- 部署入口与统一规则：[DEPLOY.md](../DEPLOY.md)

## 本地 Docker 热加载开发（推荐）

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev logs -f nextchat-dev
```

访问：<http://localhost:3000>

停止：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev down
```

热加载规则：

- 普通业务代码修改后依赖热加载生效，不要重启容器，不要重新构建镜像。
- 只有 `package.json`、`yarn.lock`、`Dockerfile` 变更时，才重新执行 `... build`。

## 环境变量与安全

- 开发/部署默认使用 `.env.docker`，不要把真实密钥、数据库密码写进仓库。
- 如果需要启用数据库同步，优先在 `.env.docker` 填写 `DATABASE_URL` 或 `PG*` 参数（示例见 [.env.docker.example](../.env.docker.example)）。

## 生产部署

生产部署默认使用 `--profile no-proxy`，并通过仓库脚本在服务器侧构建与启动：

- [scripts/deploy-production-no-proxy.sh](../scripts/deploy-production-no-proxy.sh)

具体步骤与常见故障排查见：

- [docs/docker-deploy-cn.md](docker-deploy-cn.md)

## 质量检查

```bash
yarn lint
yarn build
npx tsc --noEmit --pretty false
```

说明：仓库已移除 Jest 配置和 `test/` 目录，不再默认使用 `yarn test` / `yarn test:ci`。

## 移动端聊天滚动约定

- 流式输出中轻微上滑应立即暂停自动贴底。
- 点击页面空白不应自动回到底部。
- 回到底部按钮采用两帧滚动到底部，避免虚拟消息窗口切换时出现空白。
- 点击标题滚到顶部时应暂停流式自动贴底。
- Token 用量行在窄屏或长文本时允许自动换行。
