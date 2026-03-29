# NextChat - 宝塔面板部署说明

本项目是 NextChat AI 聊天应用的宝塔面板部署版本。

## 📦 已包含的配置文件

| 文件 | 说明 |
|------|------|
| `.env.baota` | 环境变量配置模板 |
| `docker-compose.baota.yml` | Docker Compose 配置（宝塔专用）|
| `nginx/baota-nextchat.conf` | Nginx 反向代理配置 |

## 🚀 快速开始

### 1. 配置环境变量

复制 `.env.baota` 为 `.env.baota.local` 并修改：

```bash
# 必须修改的配置
CODE=your-access-password
OPENAI_API_KEY=your-api-key
PGPASSWORD=your-db-password
```

### 2. 在宝塔面板部署

#### Docker 管理器部署

1. **Docker** -> **Compose 项目**
2. **添加项目**
3. 填写信息：
   - 名称：`NextChat`
   - 路径：`/www/wwwroot/nextchat`
   - Compose 文件：`docker-compose.baota.yml`
   - 环境文件：`.env.baota.local`

#### 命令行部署

```bash
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local up -d --build
```

## 📚 详细文档

- [快速上手指南](docs/baota-quick-start.md)
- [图形界面部署指南](docs/baota-gui-deploy.md)
- [数据库配置指南](docs/baota-database-setup.md)
- [部署注意事项](docs/baota-deploy-checklist.md)

## 🔧 宝塔面板管理

| 功能 | 位置 |
|------|------|
| 容器管理 | Docker -> 容器 |
| 网站管理 | 网站 -> 列表 |
| 数据库管理 | 数据库 -> PostgreSQL |

## ⚠️ 重要提示

1. **用户 ID 配置**：三个变量必须保持一致
   - `NEXTCHAT_DEFAULT_USER_ID`
   - `DEFAULT_SYNC_USER_ID`
   - `NEXT_PUBLIC_DEFAULT_SYNC_USER_ID`

2. **环境变量修改后**：必须重新构建容器
   ```bash
   docker-compose -f docker-compose.baota.yml --env-file .env.baota.local build
   docker-compose -f docker-compose.baota.yml --env-file .env.baota.local up -d
   ```

3. **数据库初始化**：首次启动自动创建表结构，无需手动操作

## 🐛 故障排查

### 查看容器日志
```bash
docker logs -f nextchat
```

### 检查数据库连接
```bash
PGPASSWORD=your_password psql -h 127.0.0.1 -U nextchat_user -d nextchat
```

### 重启容器
```bash
docker restart nextchat
```

## 📞 支持

- GitHub Issues: https://github.com/ChatGPTNextWeb/NextChat/issues
- 项目文档: https://github.com/ChatGPTNextWeb/NextChat
