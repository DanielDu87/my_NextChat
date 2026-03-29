# NextChat

仓库文档现已统一只保留中文版本。

## 文档入口

- 部署说明：[DEPLOY.md](/Users/dyx/Code/NextChat/DEPLOY.md)
- Docker 部署指南：[docs/docker-deploy-cn.md](/Users/dyx/Code/NextChat/docs/docker-deploy-cn.md)
- PostgreSQL Docker 部署：[docs/db/postgres-docker-deploy.md](/Users/dyx/Code/NextChat/docs/db/postgres-docker-deploy.md)
- 常见问题：[docs/faq-cn.md](/Users/dyx/Code/NextChat/docs/faq-cn.md)
- Vercel 配置：[docs/vercel-cn.md](/Users/dyx/Code/NextChat/docs/vercel-cn.md)
- Cloudflare Pages 旧方案：[docs/cloudflare-pages-cn.md](/Users/dyx/Code/NextChat/docs/cloudflare-pages-cn.md)
- 聊天记录同步说明：[docs/synchronise-chat-logs-cn.md](/Users/dyx/Code/NextChat/docs/synchronise-chat-logs-cn.md)
- 用户手册：[docs/user-manual-cn.md](/Users/dyx/Code/NextChat/docs/user-manual-cn.md)
- 新增翻译说明：[docs/translation.md](/Users/dyx/Code/NextChat/docs/translation.md)

## 当前部署约定

- 本地开发使用 `--profile dev`
- 生产部署默认使用 `--profile no-proxy`
- 仅在数据库必须通过跳板机访问时叠加 `--profile ssh-tunnel`
- 默认使用 `./scripts/docker-compose-safe.sh`
- 默认使用 `.env.docker`

最常用命令：

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy logs -f nextchat-production
```
