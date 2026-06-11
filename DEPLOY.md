# NextChat 部署入口

旧的部署说明已经废弃，当前仓库统一使用下面两份文档：

- 中文部署文档：[docs/docker-deploy-cn.md](docs/docker-deploy-cn.md)
- 宝塔专项文档：[docs/baota-docker-guide.md](docs/baota-docker-guide.md)
- 仓库文档入口：[README.md](README.md)

统一规则：

- 默认使用 `.env.docker`
- 默认使用 `./scripts/docker-compose-safe.sh`
- 生产直连数据库使用 `--profile no-proxy`
- 通过跳板机访问数据库时叠加 `--profile ssh-tunnel`
- 本地开发使用 `--profile dev`
- 宝塔专用部署文档见 [README_BAOTA.md](README_BAOTA.md)
- `docker-compose.baota.yml` 只用于宝塔专用部署，不参与 `--profile no-proxy`

最常用命令：

```bash
cp .env.docker.example .env.docker
HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= ./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy logs -f nextchat-production
```

服务器 `ss` 的标准宝塔 DockerSite 部署：

```bash
ssh ss 'cd /www/dk_project/my_NextChat && docker compose -f docker-compose.baota.yml --env-file .env.baota build nextchat && docker compose -f docker-compose.baota.yml --env-file .env.baota up -d nextchat'
```

如果担心 SSH 在 `yarn build` 期间断开，优先放进 `tmux`：

```bash
ssh ss 'tmux new-session -d -s nextchat-baota-deploy "cd /www/dk_project/my_NextChat && docker compose -f docker-compose.baota.yml --env-file .env.baota build nextchat && docker compose -f docker-compose.baota.yml --env-file .env.baota up -d nextchat 2>&1 | tee /tmp/nextchat-baota-deploy.log"'
ssh ss 'tmux capture-pane -t nextchat-baota-deploy -p -S -120'
```

构建注意事项：

- `.env.docker` 中的 `HTTP_PROXY=http://host.docker.internal:7890` 在 Docker 构建阶段
  可能无法解析，导致 `yarn install` 失败。构建时必须覆盖为空。
- 如果 npmmirror 在构建阶段连接异常，可临时切换 NPM_REGISTRY 为 npmjs.org。
- `yarn install` 阶段耗时较长（5~10 分钟），建议使用 `tmux` 或 `nohup` 避免 SSH 超时。

宝塔专用更新命令：

```bash
ssh ss 'tmux new-session -d -s nextchat-baota-deploy "cd /www/dk_project/my_NextChat && git pull --ff-only && export BUILDX_CONFIG=/tmp/nextchat-docker-buildx && mkdir -p /tmp/nextchat-docker-buildx && docker compose -f docker-compose.baota.yml --env-file .env.baota build nextchat && docker compose -f docker-compose.baota.yml --env-file .env.baota up -d nextchat 2>&1 | tee /tmp/nextchat-baota-deploy.log"'
ssh ss 'tmux capture-pane -t nextchat-baota-deploy -p -S -120'
```

宝塔 DockerSite 必须同步/保留的服务器路径：

- 项目目录：`/www/dk_project/my_NextChat`
- 环境变量：`/www/dk_project/my_NextChat/.env.baota`
- 宝塔 Compose：`/www/server/panel/data/compose/my_nextchat/docker-compose.yaml`
- 宝塔 Compose env：`/www/server/panel/data/compose/my_nextchat/.env`
- DockerSite 数据库：`/www/server/panel/data/db/docker.db`
- 普通站点冲突库：`/www/server/panel/data/db/site.db`
- DockerSite JSON：`/www/dk_project/sites/chat.dyxcloud.com/chat.dyxcloud.com.json`
- Nginx vhost：`/www/server/panel/vhost/nginx/chat.dyxcloud.com.conf`
- SSL 证书目录：`/www/server/panel/vhost/cert/chat.dyxcloud.com/`

完整宝塔流程以 `README_BAOTA.md` 为准。

最新排障结论：

- 如果 `https://chat.dyxcloud.com` 打不开，但服务器本机 `curl -k -I https://chat.dyxcloud.com/` 返回 `200`，
  但外部无代理访问 `chat.dyxcloud.com` 被 reset 或跳转到 DNSPod webblock，
  说明宝塔 nginx、证书和 NextChat 上游都正常，剩余问题在腾讯云/DNSPod/安全策略的域名公网链路拦截。
- 如果服务器本机 `curl -I http://127.0.0.1:3000/` 返回 `connection refused`，说明不是域名问题，而是 NextChat
  上游进程/容器没在跑。优先重新执行 `./scripts/deploy-production-no-proxy.sh`。
- 如果访问 IP 正常、访问域名失败，必须额外检查带 SNI 的 TLS：

```bash
env -u https_proxy -u http_proxy -u HTTPS_PROXY -u HTTP_PROXY -u all_proxy -u ALL_PROXY \
  openssl s_client -connect 42.193.15.117:443 -servername chat.dyxcloud.com -brief
```

- 如果无 SNI 直连 IP 正常、带 `-servername chat.dyxcloud.com` 立刻 reset，而服务器本机 SNI 正常，
  说明 reset 发生在外部链路，不在 NextChat 进程内部。

## chat.dyxcloud.com 宝塔全流程 Runbook

详细的域名切换、DockerSite、普通站点兼容记录、SSL 证书数据库、缓存开关重复 listen 修复步骤见：

- [docs/baota-chat-dyxcloud-runbook.md](docs/baota-chat-dyxcloud-runbook.md)
