# NextChat 部署入口

旧的部署说明已经废弃，当前仓库统一使用下面两份文档：

- 中文部署文档：[docs/docker-deploy-cn.md](/Users/dyx/Code/NextChat/docs/docker-deploy-cn.md)
- 仓库文档入口：[README.md](/Users/dyx/Code/NextChat/README.md)

统一规则：

- 默认使用 `.env.docker`
- 默认使用 `./scripts/docker-compose-safe.sh`
- 生产直连数据库使用 `--profile no-proxy`
- 通过跳板机访问数据库时叠加 `--profile ssh-tunnel`
- 本地开发使用 `--profile dev`

最常用命令：

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy logs -f nextchat-production
```
