# NextChat 宝塔 DockerSite 部署指南

当前宝塔部署的权威文档已经统一到仓库根目录：

- [README_BAOTA.md](../README_BAOTA.md)
- [DEPLOY.md](../DEPLOY.md)

后续 AI 或人工部署 `chat.dyxcloud.com` 时，请以 `README_BAOTA.md` 为准，不要使用历史方案。

## 当前线上固定信息

| 项 | 当前值 |
|---|---|
| SSH alias | `ss` |
| 服务器公网 IP | `42.193.15.117` |
| 项目目录 | `/www/dk_project/my_NextChat` |
| 域名 | `chat.dyxcloud.com` |
| Docker 容器名 | `nextchat` |
| 宝塔 DockerSite 站点名 | `chat.dyxcloud.com` |
| 宝塔 Compose 显示名 | `my_nextchat` |
| Nginx 反代目标 | `http://127.0.0.1:3000` |
| 线上环境变量 | `/www/dk_project/my_NextChat/.env.baota` |

## 必须保留的宝塔路径

- `/www/server/panel/data/compose/my_nextchat/docker-compose.yaml`
- `/www/server/panel/data/compose/my_nextchat/.env`
- `/www/server/panel/data/db/docker.db`
- `/www/server/panel/data/db/site.db`
- `/www/dk_project/sites/chat.dyxcloud.com/chat.dyxcloud.com.json`
- `/www/server/panel/vhost/nginx/chat.dyxcloud.com.conf`
- `/www/server/panel/vhost/cert/chat.dyxcloud.com/fullchain.pem`
- `/www/server/panel/vhost/cert/chat.dyxcloud.com/privkey.pem`

注意：`/www/server/panel/data/docker.db` 不是当前宝塔 DockerSite 数据源，不要修改。

## 快速部署

```bash
ssh ss 'tmux new-session -d -s nextchat-baota-deploy "cd /www/dk_project/my_NextChat && git pull --ff-only && export BUILDX_CONFIG=/tmp/nextchat-docker-buildx && mkdir -p /tmp/nextchat-docker-buildx && docker compose -f docker-compose.baota.yml --env-file .env.baota build nextchat && (docker rm -f nextchat 2>/dev/null || true) && (docker image rm nextchat:latest 2>/dev/null || true) && docker compose -f docker-compose.baota.yml --env-file .env.baota up -d --force-recreate nextchat 2>&1 | tee /tmp/nextchat-baota-deploy.log"'
ssh ss 'tmux capture-pane -t nextchat-baota-deploy -p -S -120'
```

完整的 DockerSite 注册、清理、重建、验证和域名拦截排障步骤见 [README_BAOTA.md](../README_BAOTA.md)。
