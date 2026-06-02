# NextChat

仓库文档现已统一只保留中文版本。

## 文档入口

### 开发相关

- **🚀 开发指南：[docs/development.md](docs/development.md)** - 本地开发和远程部署完整指南
  - 本地开发环境配置（通过 SSH 隧道连接远程数据库）
  - 远程服务器部署配置（直接连接本地数据库）
  - Docker 和热加载两种启动方式
  - 数据库连接规范和故障排查

### 部署相关

- **🔥 本地开发部署：[docs/local-dev-guide.md](docs/local-dev-guide.md)** - Docker + PostgreSQL 本地开发环境（旧版）
- **🔥 宝塔面板部署：[docs/BAOTA_INSTALL_GUIDE.md](docs/BAOTA_INSTALL_GUIDE.md)** - 推荐！使用宝塔面板图形界面一键部署
- 部署说明：[DEPLOY.md](DEPLOY.md)
- Docker 部署指南：[docs/docker-deploy-cn.md](docs/docker-deploy-cn.md)
- PostgreSQL Docker 部署：[docs/db/postgres-docker-deploy.md](docs/db/postgres-docker-deploy.md)

### 宝塔面板部署专题

- 📖 完整安装指南：[docs/BAOTA_INSTALL_GUIDE.md](docs/BAOTA_INSTALL_GUIDE.md)
- 🚀 快速开始：[docs/baota-quick-start.md](docs/baota-quick-start.md)
- 🐳 Docker 管理指南：[docs/baota-docker-guide.md](docs/baota-docker-guide.md)
- 🗄️ 数据库配置：[docs/baota-database-setup.md](docs/baota-database-setup.md)
- 📋 注意事项清单：[docs/baota-deploy-checklist.md](docs/baota-deploy-checklist.md)

### 其他文档
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
- 生产部署默认不使用代理，统一使用 `./scripts/deploy-production-no-proxy.sh`
- 默认使用 `./scripts/docker-compose-safe.sh`
- 默认使用 `.env.docker`
- 如果宝塔环境要复用已有外部 PostgreSQL，不要直接使用 `docker-compose.baota.yml`，应改用 `docker-compose.yml + .env.docker + --profile no-proxy`

生产部署：

```bash
cp .env.docker.example .env.docker
./scripts/deploy-production-no-proxy.sh
```

查看日志：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy logs -f nextchat-production
```
