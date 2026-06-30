# NextChat 开发指南

本仓库的 Docker 开发与部署以 Profile 为中心，文档以“仓库实际可用的流程”为准，避免与历史脚本/环境分叉。

## 文档入口

- Docker 部署与本地开发（权威）：[docs/docker-deploy-cn.md](docker-deploy-cn.md)
- 部署入口与统一规则：[DEPLOY.md](../DEPLOY.md)

## 本地 Docker 热加载开发（推荐）

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile ssh-tunnel up -d --build postgres-ssh-tunnel
NEXTCHAT_DISABLE_AUTH=true NEXTCHAT_LOCAL_BYPASS_USER=ccc PGHOST=postgres-ssh-tunnel PGPORT=5432 SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel logs -f nextchat-dev
```

访问：<http://localhost:3000>

本地热加载测试默认免登录，避免账号登录阻塞 UI 回归。仅对本地 `dev` profile 使用命令行临时覆盖 `NEXTCHAT_DISABLE_AUTH=true`；默认就是 `ccc` 用户，读写和操作都按 `ccc` 处理，用户切换等功能应保持正常。远端 PostgreSQL 只监听服务器本机和 Docker 内网，本地读取聊天记录时通过项目内 `postgres-ssh-tunnel` 容器建立 SSH key 隧道，并用 `PGHOST=postgres-ssh-tunnel PGPORT=5432` 启动开发容器。远程部署、宝塔部署、生产环境必须恢复密码鉴权，不要把该值写入 `.env.baota` 或生产环境变量；部署后默认仍按正常鉴权进入 `admin`。

常用页面：

- 聊天页：<http://localhost:3000/chat>
- 绘图页：<http://localhost:3000/draw>
- 绘图历史：<http://localhost:3000/draw/history>
- API 配置：<http://localhost:3000/api-config>

路由约定：

- 当前使用普通路径 URL，不再新增 `/#/...` hash 链接。
- 旧 hash 地址会在客户端启动时自动迁移到普通路径。
- 直接刷新 `/draw`、`/api-config` 等页面应正常进入应用。

停止：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev down
```

热加载规则：

- 普通业务代码修改后依赖热加载生效，不要重启容器，不要重新构建镜像。
- 只有 `package.json`、`yarn.lock`、`Dockerfile` 变更时，才重新执行 `... build`。

## 环境变量与安全

- 开发/部署默认使用 `.env.docker`，不要把真实密钥、数据库密码写进仓库。
- 本地热加载如需重新创建开发容器，继续使用 `NEXTCHAT_DISABLE_AUTH=true NEXTCHAT_LOCAL_BYPASS_USER=ccc PGHOST=postgres-ssh-tunnel PGPORT=5432 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel up -d`，不要为了免登录修改生产配置。
- 如果需要启用数据库同步，优先在 `.env.docker` 填写 `DATABASE_URL` 或 `PG*` 参数（示例见 [.env.docker.example](../.env.docker.example)）。

## 生产部署

当前线上默认使用宝塔 DockerSite：

- 部署路径：`/www/dk_project/my_NextChat`
- Compose：`docker-compose.baota.yml`
- 环境变量：`.env.baota`
- 域名：`https://chat.dyxcloud.com`
- 上游：`http://127.0.0.1:3000`

非宝塔 Docker 部署仍可参考 [docs/docker-deploy-cn.md](docker-deploy-cn.md)，但线上 `ss` 服务器以 [README_BAOTA.md](../README_BAOTA.md) 和 [docs/baota-chat-dyxcloud-runbook.md](baota-chat-dyxcloud-runbook.md) 为准。

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
