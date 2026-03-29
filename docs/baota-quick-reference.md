# NextChat 宝塔部署快速参考指南

本指南提供了 NextChat 在宝塔面板部署的核心步骤和关键配置点。

## 🎯 部署架构概览

```
┌─────────────────────────────────────────────────────────┐
│                     用户浏览器                            │
│                  https://ngpt.chat                       │
└─────────────────────┬───────────────────────────────────┘
                      │
                      │ HTTPS (443)
                      ▼
┌─────────────────────────────────────────────────────────┐
│                  宝塔 Nginx                              │
│  - SSL 终止                                              │
│  - 反向代理                                               │
│  - WebSocket 支持                                        │
└─────────────────────┬───────────────────────────────────┘
                      │ HTTP (3000)
                      ▼
┌─────────────────────────────────────────────────────────┐
│              NextChat Docker 容器                         │
│  - 端口: 3000                                            │
│  - 网络: nextchat_nextchat-network                       │
└─────────────────────┬───────────────────────────────────┘
                      │
                      │ PostgreSQL 协议
                      ▼
┌─────────────────────────────────────────────────────────┐
│           PostgreSQL Docker 容器                          │
│  - 端口: 5432                                            │
│  - 网络: nextchat_nextchat-network                       │
└─────────────────────────────────────────────────────────┘
```

## 📝 部署流程（5 分钟版）

### 第一步：准备环境变量（2 分钟）

```bash
cd /www/wwwroot/nextchat
cp .env.baota .env.baota.local
nano .env.baota.local
```

**必填项：**
```bash
CODE=your-password-here                    # 访问密码
PGPASSWORD=db-password-here                # 数据库密码
NEXTCHAT_DEFAULT_USER_ID=single-user       # 用户ID
DEFAULT_SYNC_USER_ID=single-user
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=single-user
PGHOST=nextchat-postgres                   # 数据库主机
```

### 第二步：启动容器（3 分钟）

```bash
# 启动数据库
docker-compose -f docker-compose.postgres.yml up -d

# 构建并启动 NextChat
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy build
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy up -d

# 验证
curl http://127.0.0.1:3000
```

### 第三步：宝塔面板配置（2 分钟）

1. **Docker → Docker 网站 → 添加网站**
   - 类型：反向代理
   - 域名：`your-domain.com`

2. **配置反向代理**
   - 目标URL：`http://127.0.0.1:3000`
   - ✅ 启用 WebSocket 支持

3. **申请 SSL 证书**
   - SSL → Let's Encrypt → 申请
   - ✅ 开启强制 HTTPS

### 完成！访问 https://your-domain.com

---

## ⚙️ 关键配置点

### 1. 环境变量（`.env.baota.local`）

```bash
# ========== 必填配置 ==========
CODE=your-password                    # 访问密码
PGPASSWORD=db-password                # 数据库密码

# 用户标识（三个必须一致！）
NEXTCHAT_DEFAULT_USER_ID=single-user
DEFAULT_SYNC_USER_ID=single-user
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=single-user

# 数据库连接
PGHOST=nextchat-postgres
PGPORT=5432
PGDATABASE=nextchat
PGUSER=nextchat_user
PGPASSWORD=db-password

# ========== 可选配置 ==========
# AI 服务商（如果服务器已配置可留空）
OPENAI_API_KEY=
BASE_URL=

# 功能开关
HIDE_USER_API_KEY=false         # 允许用户配置 API Key
DISABLE_GPT4=false              # 不禁用 GPT-4
ENABLE_GOOGLE_FONTS=false       # 国内建议关闭
```

### 2. Docker 网络

**确保两个容器在同一网络：**

```yaml
# docker-compose.baota.yml
services:
  nextchat:
    networks:
      - nextchat-network

networks:
  nextchat-network:
    name: nextchat_nextchat-network
    external: true
```

**验证：**
```bash
docker network inspect nextchat_nextchat-network
docker exec nextchat ping nextchat-postgres
```

### 3. WebSocket 支持

**Nginx 配置必须包含：**

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;

    # WebSocket 支持（必需！）
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;

    proxy_buffering off;
}
```

**在宝塔面板中：**
- 网站设置 → 反向代理 → 启用 WebSocket 支持

### 4. SSL 证书配置

**证书位置：**
```
/www/server/panel/vhost/cert/your-domain/
├── fullchain.pem    # 完整证书链
└── privkey.pem      # 私钥
```

**Nginx 配置：**
```nginx
ssl_certificate /www/server/panel/vhost/cert/your-domain/fullchain.pem;
ssl_certificate_key /www/server/panel/vhost/cert/your-domain/privkey.pem;
ssl_protocols TLSv1.2 TLSv1.3;
```

---

## 🔍 故障排查速查表

| 问题 | 可能原因 | 检查命令 | 解决方案 |
|------|---------|---------|---------|
| 容器无法启动 | 端口占用/配置错误 | `docker logs nextchat` | 检查端口、环境变量 |
| 数据库连接失败 | 网络不通/密码错误 | `docker exec nextchat ping nextchat-postgres` | 检查网络、密码 |
| 网站无法访问 | Nginx配置错误 | `nginx -t` | 检查配置、重载Nginx |
| WebSocket失败 | 缺少WebSocket配置 | `grep Upgrade /path/to/nginx.conf` | 添加WebSocket支持 |
| SSL申请失败 | 域名未解析/防火墙 | `ping your-domain.com` | 检查DNS、防火墙 |
| 密码错误 | CODE配置错误 | `cat .env.baota.local \| grep CODE` | 修改密码、重启容器 |

---

## 📁 重要路径

### 项目文件
```
/www/wwwroot/nextchat/                    # 项目目录
├── .env.baota.local                      # 环境变量配置
├── docker-compose.baota.yml              # NextChat Compose 配置
└── docker-compose.postgres.yml           # PostgreSQL Compose 配置
```

### 宝塔配置
```
/www/dk_project/sites/your-domain/        # 网站配置
└── your-domain.json                      # 网站配置文件

/www/server/panel/vhost/nginx/            # Nginx 配置
└── your-domain.conf                      # 网站 Nginx 配置

/www/server/panel/vhost/cert/your-domain/ # SSL 证书
├── fullchain.pem
└── privkey.pem
```

### 日志文件
```
docker logs nextchat                      # NextChat 日志
docker logs nextchat-postgres             # PostgreSQL 日志
/www/wwwlogs/your-domain.log              # Nginx 访问日志
/www/wwwlogs/your-domain.error.log        # Nginx 错误日志
```

---

## 🛠️ 常用命令

### 容器管理
```bash
# 查看容器状态
docker ps

# 查看容器日志
docker logs -f nextchat

# 重启容器
docker restart nextchat

# 停止容器
docker stop nextchat

# 启动容器
docker start nextchat
```

### 服务更新
```bash
cd /www/wwwroot/nextchat

# 拉取最新代码
git pull

# 重新构建
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy build

# 重启服务
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy up -d
```

### 数据库操作
```bash
# 进入数据库
docker exec -it nextchat-postgres psql -U nextchat_user -d nextchat

# 备份数据库
docker exec nextchat-postgres pg_dump -U nextchat_user nextchat > backup.sql

# 恢复数据库
docker exec -i nextchat-postgres psql -U nextchat_user nextchat < backup.sql
```

### 网络测试
```bash
# 测试容器间连接
docker exec nextchat ping nextchat-postgres

# 测试本地访问
curl http://127.0.0.1:3000

# 测试域名访问
curl -I https://your-domain.com

# 检查端口占用
netstat -tlnp | grep 3000
```

---

## ⚠️ 避坑指南

### 1. 环境变量修改后必须重建

❌ **错误做法：**
```bash
# 修改 .env.baota.local
docker restart nextchat  # ❌ 不会生效！
```

✅ **正确做法：**
```bash
# 修改 .env.baota.local
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy build
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy up -d
```

### 2. 用户ID 必须一致

❌ **错误配置：**
```bash
NEXTCHAT_DEFAULT_USER_ID=user1
DEFAULT_SYNC_USER_ID=user2          # ❌ 不一致！
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=user3
```

✅ **正确配置：**
```bash
NEXTCHAT_DEFAULT_USER_ID=single-user
DEFAULT_SYNC_USER_ID=single-user
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=single-user  # ✅ 一致
```

### 3. 不要忘记 WebSocket 配置

❌ **缺少 WebSocket：**
```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    # ❌ 缺少 WebSocket 配置
}
```

✅ **包含 WebSocket：**
```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection $connection_upgrade;
}
```

### 4. SSL 证书路径要正确

❌ **错误路径：**
```nginx
ssl_certificate /etc/letsencrypt/live/your-domain/fullchain.pem;  # ❌
```

✅ **宝塔路径：**
```nginx
ssl_certificate /www/server/panel/vhost/cert/your-domain/fullchain.pem;  # ✅
```

---

## 📊 性能优化建议

### 1. 容器资源限制

```yaml
# docker-compose.baota.yml
services:
  nextchat:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
```

### 2. 数据库连接池

```bash
# .env.baota.local
PGPOOL_MAX=10
PG_CONNECT_TIMEOUT_MS=10000
PG_IDLE_TIMEOUT_MS=30000
```

### 3. Nginx 缓存

在宝塔面板网站设置中启用：
- 静态文件缓存
- Gzip 压缩
- HTTP/2

---

## 🔐 安全建议

1. **使用强密码**：CODE 至少 12 位
2. **启用 HTTPS**：必须配置 SSL
3. **定期备份**：每天备份数据库
4. **防火墙配置**：只开放必要端口
5. **更新维护**：定期更新系统和 Docker

---

## 📞 获取帮助

- **项目文档**: [README_BAOTA.md](../README_BAOTA.md)
- **完整指南**: [baota-deploy-guide-updated.md](./baota-deploy-guide-updated.md)
- **注意事项**: [baota-deploy-checklist-updated.md](./baota-deploy-checklist-updated.md)
- **GitHub**: https://github.com/ChatGPTNextWeb/NextChat/issues

---

**记住最重要的一点：先通过命令行部署好容器，然后在宝塔面板中配置网站和SSL！** 🎯
