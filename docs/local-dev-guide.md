# NextChat 本地开发部署指南

本文档说明如何在本地使用 Docker + PostgreSQL 进行开发部署。

## 架构说明

```
┌─────────────────────────────────────────────────────────┐
│                     Docker 网络                          │
│  ┌──────────────────┐        ┌──────────────────────┐  │
│  │ nextchat-dev     │ ────>  │ nextchat-postgres    │  │
│  │ (热加载开发服务器) │        │ (PostgreSQL 数据库)  │  │
│  │ 端口: 3000       │        │ 端口: 5432          │  │
│  └──────────────────┘        └──────────────────────┘  │
│         ▲                                            │  │
│         │ 映射到宿主机                               │  │
│         ▼                                            │  │
│  http://localhost:3000                               │  │
└─────────────────────────────────────────────────────────┘
```

## 环境要求

- Docker
- Docker Compose
- Git

## 快速开始

### 1. 克隆项目

```bash
git clone <repository-url>
cd NextChat
```

### 2. 配置环境变量

创建 `.env.local` 文件：

```bash
# 复制模板
cp .env .env.local
```

编辑 `.env.local`，配置以下关键变量：

```env
# 访问密码（必填）
CODE=your-access-password

# 数据库配置（使用 Docker 内置数据库）
PGHOST=postgres
PGPORT=5432
PGDATABASE=nextchat
PGUSER=postgres
PGPASSWORD=postgres
PGSSL=false
PGSSLMODE=disable

# 用户标识配置（三个变量必须保持一致）
NEXTCHAT_DEFAULT_USER_ID=single-user
DEFAULT_SYNC_USER_ID=single-user
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=single-user

# 应用密钥（请修改为随机字符串）
APP_SECRET=your-random-app-secret-key-here
```

### 3. 启动服务

**首次启动**（会创建并启动所有容器）：

```bash
# 启动数据库
docker-compose --profile local-db up -d postgres

# 等待数据库启动完成（约 5-10 秒）
sleep 10

# 启动开发服务器
docker-compose --profile dev up -d nextchat-dev
```

**或一次性启动所有服务**：

```bash
docker-compose --profile local-db --profile dev up -d
```

### 4. 验证部署

**检查容器状态**：

```bash
docker ps --filter name=nextchat
```

应该看到两个容器在运行：
- `nextchat-dev` - 开发服务器
- `nextchat-postgres` - 数据库

**检查服务健康**：

```bash
# 检查开发服务器
curl http://localhost:3000/api/config

# 检查数据库连接
curl http://localhost:3000/api/db/health
```

### 5. 访问应用

打开浏览器访问：http://localhost:3000

## 开发体验

### 热加载

代码修改后会自动刷新，无需重启容器：

- 修改 `app/` 目录下的文件：自动同步到容器并刷新
- 修改 `package.json`：自动重启容器
- Mask 文件修改：自动重新构建

### 查看日志

```bash
# 查看开发服务器日志
docker logs -f nextchat-dev

# 查看数据库日志
docker logs -f nextchat-postgres
```

### 进入容器调试

```bash
# 进入开发服务器容器
docker exec -it nextchat-dev sh

# 进入数据库容器
docker exec -it nextchat-postgres psql -U postgres -d nextchat
```

## 常用命令

### 启动服务

```bash
# 启动所有服务
docker-compose --profile local-db --profile dev up -d

# 仅启动数据库
docker-compose --profile local-db up -d postgres

# 仅启动开发服务器
docker-compose --profile dev up -d nextchat-dev
```

### 停止服务

```bash
# 停止所有服务
docker-compose --profile local-db --profile dev down

# 停止但保留数据
docker-compose --profile local-db --profile dev stop
```

### 重启服务

```bash
# 重启开发服务器
docker-compose --profile dev restart nextchat-dev

# 重启数据库
docker-compose --profile local-db restart postgres
```

### 清理数据

```bash
# 停止并删除所有容器和数据卷
docker-compose --profile local-db --profile dev down -v

# ⚠️ 警告：这会删除所有数据库数据！
```

## 目录结构

```
NextChat/
├── app/                    # 应用代码（热加载）
├── public/                 # 静态资源
├── docker-compose.yml      # Docker Compose 配置
├── .env.local             # 本地环境变量（不提交到 Git）
├── .env                   # 环境变量模板
└── docs/
    └── local-dev-guide.md  # 本文档
```

## 环境变量说明

### 必填变量

| 变量名 | 说明 | 默认值 |
|--------|------|--------|
| `CODE` | 访问密码 | - |
| `APP_SECRET` | 应用密钥（用于加密） | - |
| `PGHOST` | 数据库主机 | postgres |
| `PGDATABASE` | 数据库名称 | nextchat |
| `PGUSER` | 数据库用户 | postgres |
| `PGPASSWORD` | 数据库密码 | postgres |

### 用户标识变量

以下三个变量必须保持一致：

```env
NEXTCHAT_DEFAULT_USER_ID=single-user
DEFAULT_SYNC_USER_ID=single-user
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=single-user
```

### 可选变量

```env
# AI 服务商 API Key（可选，用户可在界面配置）
OPENAI_API_KEY=
GOOGLE_API_KEY=
ANTHROPIC_API_KEY=

# 功能开关
HIDE_USER_API_KEY=true
DISABLE_GPT4=false
ENABLE_BALANCE_QUERY=false
ENABLE_MCP=false
```

## 故障排查

### 问题 1：容器无法启动

**检查端口占用**：

```bash
# 检查 3000 端口
lsof -i :3000

# 检查 5432 端口
lsof -i :5432
```

**解决方案**：停止占用端口的服务或修改 `.env.local` 中的 `PORT` 和 `PGPORT`。

### 问题 2：数据库连接失败

**检查数据库容器状态**：

```bash
docker ps --filter name=postgres
docker logs nextchat-postgres
```

**测试数据库连接**：

```bash
docker exec -it nextchat-postgres psql -U postgres -d nextchat -c "SELECT 1;"
```

### 问题 3：热加载不生效

**检查文件挂载**：

```bash
docker inspect nextchat-dev | grep -A 10 "Mounts"
```

应该看到 `/app` 目录已挂载。

**重启开发服务器**：

```bash
docker-compose --profile dev restart nextchat-dev
```

### 问题 4：API 返回 500 错误

**查看详细日志**：

```bash
docker logs -f nextchat-dev | grep -i error
```

**检查数据库健康**：

```bash
curl http://localhost:3000/api/db/health
```

## 数据持久化

数据库数据存储在 Docker 卷中：

```bash
# 查看数据卷
docker volume ls | grep nextchat

# 备份数据库
docker exec nextchat-postgres pg_dump -U postgres nextchat > backup.sql

# 恢复数据库
cat backup.sql | docker exec -i nextchat-postgres psql -U postgres nextchat
```

## 性能优化

### 增加内存限制

在 `docker-compose.yml` 中添加：

```yaml
services:
  nextchat-dev:
    # ...
    deploy:
      resources:
        limits:
          memory: 4G
```

### 启用缓存

```env
# .env.local
NODE_OPTIONS=--max-old-space-size=4096
```

## 与生产环境的区别

| 特性 | 本地开发 | 生产环境 |
|------|----------|----------|
| 配置文件 | `.env.local` | `.env.baota.local` |
| Docker Compose 文件 | `docker-compose.yml` | `docker-compose.baota.yml` |
| Profile | `dev` + `local-db` | `no-proxy` |
| 数据库 | Docker 内置 | 远程 PostgreSQL |
| 热加载 | ✅ 启用 | ❌ 禁用 |
| 代码挂载 | ✅ 启用 | ❌ 禁用 |

## 更新项目

```bash
# 拉取最新代码
git pull

# 重建并重启开发服务器
docker-compose --profile dev up -d --build nextchat-dev
```

## 相关文档

- [宝塔部署指南](README_BAOTA.md)
- [Docker 部署指南](docs/docker-deploy-cn.md)
- [数据库配置指南](docs/database-quick-fix.md)

## 技术支持

如遇问题，请检查：

1. Docker 和 Docker Compose 版本是否满足要求
2. 端口是否被占用
3. 环境变量是否正确配置
4. 容器日志中的错误信息
