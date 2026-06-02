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
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev logs -f nextchat-dev
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

- 用户说"部署"时，默认部署到 SSH alias 为 `sss` 的服务器
- 默认部署路径为 `/www/dk_project/my_NextChat`
- 部署前先在服务器目标路径拉取最新代码：

```bash
ssh sss 'cd /www/dk_project/my_NextChat && git pull'
```

- 拉取完成后在服务器目标路径执行生产构建和启动：

```bash
ssh sss 'cd /www/dk_project/my_NextChat && HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= http_proxy= https_proxy= all_proxy= ./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build && ./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d'
```

- 部署后检查容器状态和日志：

```bash
ssh sss 'cd /www/dk_project/my_NextChat && ./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy ps'
ssh sss 'cd /www/dk_project/my_NextChat && ./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy logs --tail=80 nextchat-production'
```

- 生产部署统一使用 `--profile no-proxy`
- 部署和启动流程默认不使用代理
- 生产部署也默认使用 [scripts/docker-compose-safe.sh](./scripts/docker-compose-safe.sh)
- 默认使用固定 PostgreSQL 直连，不依赖 `postgres-ssh-tunnel`
- 当前固定数据库配置保存在 `.env.docker`
- 后续部署时优先保留并沿用 `.env.docker` 中已有的数据库连接参数
- 只有用户明确要求通过跳板机访问数据库时，才启用 `--profile ssh-tunnel`
- 生产容器必须保留 `HOSTNAME=0.0.0.0`
  否则 Next.js standalone 进程在部分 Docker 环境中可能报 `getaddrinfo EAI_AGAIN`

### 构建注意事项

- `.env.docker` 中 `HTTP_PROXY=http://host.docker.internal:7890` 会被传入 Docker build args
  `host.docker.internal` 在构建阶段可能无法解析，导致 `yarn install` 网络失败
  构建时务必通过 `HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= ` 覆盖为空
- 如果 `NPM_REGISTRY=https://registry.npmmirror.com/` 导致 `yarn install` 反复报网络错误
  临时切换为 `NPM_REGISTRY=https://registry.npmjs.org` 可绕开，但速度较慢
  （npmmirror 可能在容器构建环境下存在连接限制）
- `yarn install --frozen-lockfile` 阶段耗时最长（约 5~10 分钟），SSH 容易超时断开
  部署时先启动 `tmux` 或 `nohup` 保持构建在后台运行：

```bash
ssh sss 'tmux new-session -d -s nextchat-build "cd /www/dk_project/my_NextChat && HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= NPM_REGISTRY=https://registry.npmjs.org ./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build 2>&1"'
# 查看进度
ssh sss 'tmux capture-pane -t nextchat-build -p -S -20'
# 构建完成后重启容器
ssh sss 'cd /www/dk_project/my_NextChat && ./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d'
```

### 验证步骤

```bash
# 检查容器状态
ssh sss 'cd /www/dk_project/my_NextChat && ./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy ps'
# 查看最近日志确认 Next.js 已就绪
ssh sss 'cd /www/dk_project/my_NextChat && ./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy logs --tail=20 nextchat-production'
# 容器内自检
ssh sss 'docker exec nextchat wget -S -O - http://127.0.0.1:3000 2>&1 | head -5'
```

## AI 部署注意事项

- 构建时优先使用仓库内置的 `vendor/rt-client-0.5.0.tgz`
- 默认关闭 Google Fonts、ShareGPT、MCP 市场、Edge TTS 等海外运行期依赖，除非用户明确要求开启
- 如果 Docker 生产构建失败，先检查 `buildx`、`.dockerignore`、构建上下文和环境变量，不要先假设是外网问题
- 版本号来自 `package.json`
  如果页面里出现 `vundefined`，先检查 `package.json` 的 `version`
- 如果宿主机访问 `127.0.0.1:3000` 异常，但容器日志显示 `Ready`
  先在容器内执行 `wget http://127.0.0.1:3000`，再判断是不是宿主机代理或端口转发干扰
