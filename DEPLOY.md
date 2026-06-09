# NextChat 部署入口

旧的部署说明已经废弃，当前仓库统一使用下面两份文档：

- 中文部署文档：[docs/docker-deploy-cn.md](/Users/dyx/Code/NextChat/docs/docker-deploy-cn.md)
- 宝塔专项文档：[docs/baota-docker-guide.md](/Users/dyx/Code/NextChat/docs/baota-docker-guide.md)
- 仓库文档入口：[README.md](/Users/dyx/Code/NextChat/README.md)

统一规则：

- 默认使用 `.env.docker`
- 默认使用 `./scripts/docker-compose-safe.sh`
- 生产直连数据库使用 `--profile no-proxy`
- 通过跳板机访问数据库时叠加 `--profile ssh-tunnel`
- 本地开发使用 `--profile dev`
- 宝塔专用部署文档见 [README_BAOTA.md](/Users/dyx/Code/NextChat/README_BAOTA.md)
- `docker-compose.baota.yml` 只用于宝塔专用部署，不参与 `--profile no-proxy`

最常用命令：

```bash
cp .env.docker.example .env.docker
HTTP_PROXY= HTTPS_PROXY= ALL_PROXY= ./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy logs -f nextchat-production
```

服务器 `sss` 的标准生产部署：

```bash
ssh sss 'cd /www/dk_project/my_NextChat && ./scripts/deploy-production-no-proxy.sh'
```

如果担心 SSH 在 `yarn build` 期间断开，优先放进 `tmux`：

```bash
ssh sss 'tmux new-session -d -s nextchat-deploy "cd /www/dk_project/my_NextChat && ./scripts/deploy-production-no-proxy.sh 2>&1"'
ssh sss 'tmux capture-pane -t nextchat-deploy -p -S -80'
```

构建注意事项：

- `.env.docker` 中的 `HTTP_PROXY=http://host.docker.internal:7890` 在 Docker 构建阶段
  可能无法解析，导致 `yarn install` 失败。构建时必须覆盖为空。
- 如果 npmmirror 在构建阶段连接异常，可临时切换 NPM_REGISTRY 为 npmjs.org。
- `yarn install` 阶段耗时较长（5~10 分钟），建议使用 `tmux` 或 `nohup` 避免 SSH 超时。

宝塔专用更新命令：

```bash
cd /www/dk_project/my_NextChat
git pull
export BUILDX_CONFIG=/tmp/nextchat-docker-buildx
mkdir -p "$BUILDX_CONFIG"
docker compose -f docker-compose.baota.yml --env-file .env.baota build nextchat
docker compose -f docker-compose.baota.yml --env-file .env.baota up -d nextchat
docker inspect nextchat --format '{{.State.Health.Status}}'
```

最新排障结论：

- 如果 `https://ngpt.chat` 打不开，但服务器本机 `curl -k -I -H "Host: ngpt.chat" https://127.0.0.1/` 返回 `200`，
  说明宝塔 nginx、证书和 NextChat 上游都正常，剩余问题更可能在公网链路、运营商路径或 SNI/TLS。
- 如果服务器本机 `curl -I http://127.0.0.1:3000/` 返回 `connection refused`，说明不是域名问题，而是 NextChat
  上游进程/容器没在跑。优先重新执行 `./scripts/deploy-production-no-proxy.sh`。
- 如果访问 IP 正常、访问域名失败，必须额外检查带 SNI 的 TLS：

```bash
env -u https_proxy -u http_proxy -u HTTPS_PROXY -u HTTP_PROXY -u all_proxy -u ALL_PROXY \
  openssl s_client -connect 42.193.15.117:443 -servername ngpt.chat -brief
```

- 如果无 SNI 直连 IP 正常、带 `-servername ngpt.chat` 立刻 reset，而服务器本机 SNI 正常，
  说明 reset 发生在外部链路，不在 NextChat 进程内部。
