# NextChat 宝塔面板部署注意事项清单

本文档总结了实际部署过程中的关键配置点和常见问题，请在部署前后仔细检查。

## 🚨 关键配置（必须正确配置）

### 1. 用户标识配置 ⚠️

**问题：** 如果配置不正确，会导致数据无法加载或数据隔离错误

**必须配置的环境变量：**
```bash
# 三个变量必须保持一致
NEXTCHAT_DEFAULT_USER_ID=single-user
DEFAULT_SYNC_USER_ID=single-user
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=single-user  # 前端需要
```

**说明：**
- `NEXTCHAT_DEFAULT_USER_ID` - 后端使用
- `DEFAULT_SYNC_USER_ID` - 后端备用
- `NEXT_PUBLIC_DEFAULT_SYNC_USER_ID` - **前端使用，必须以 NEXT_PUBLIC_ 开头**

### 2. Docker 网络配置 ⚠️

**问题：** PostgreSQL 和 NextChat 容器必须在同一网络中才能通信

**解决方案：**

**方法 1：使用外部网络**（推荐）
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

**方法 2：使用 host.docker.internal**
```bash
# .env.baota.local
PGHOST=host.docker.internal
```

**验证网络连接：**
```bash
# 检查容器网络
docker network inspect nextchat_nextchat-network

# 测试容器间连接
docker exec nextchat ping nextchat-postgres
```

### 3. WebSocket 配置 ⚠️

**问题：** NextChat 使用 WebSocket 实现实时对话，Nginx 必须正确配置

**Nginx 必需配置：**
```nginx
proxy_http_version 1.1;
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection $connection_upgrade;
proxy_buffering off;
```

**在宝塔面板中配置：**
1. 网站设置 → 反向代理
2. 启用 WebSocket 支持
3. 或在高级配置中手动添加上述配置

### 4. 环境变量修改后重建 ⚠️

**问题：** `NEXT_PUBLIC_*` 变量在构建时嵌入代码，修改后必须重新构建

**修改环境变量后的步骤：**
```bash
# 1. 停止容器
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy down

# 2. 重新构建（重要！）
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy build

# 3. 启动容器
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy up -d
```

### 5. 容器健康检查 ⚠️

**问题：** 健康检查端点可能不可用，导致容器显示 unhealthy

**当前配置：**
```yaml
healthcheck:
  test: ["CMD", "sh", "-c", "wget -q -O /dev/null http://localhost:3000/api/config || exit 1"]
```

**注意：** 即使显示 unhealthy，只要服务可访问即可正常使用。

---

## 🔧 常见问题排查

### 1. 访问密码错误

**原因：** CODE 配置的密码会经过 MD5 加存储

**解决方案：**
- 确保 CODE 配置正确
- 多个密码用逗号分隔：`CODE=password1,password2`
- 密码区分大小写

**忘记密码时的处理：**
```bash
# 查看当前密码
cat /www/wwwroot/nextchat/.env.baota.local | grep CODE

# 修改密码
nano /www/wwwroot/nextchat/.env.baota.local
# 修改 CODE=your-new-password

# 重启容器
docker restart nextchat
```

### 2. 数据库连接失败

**检查项：**
```bash
# 1. 检查 PostgreSQL 是否运行
docker ps | grep postgres

# 2. 测试连接
docker exec -it nextchat-postgres psql -U nextchat_user -d nextchat

# 3. 检查网络连接
docker network inspect nextchat_nextchat-network

# 4. 检查环境变量
docker exec nextchat env | grep PG
```

**常见错误：**
- `ENOTFOUND`: 数据库主机名错误，检查 PGHOST
- `EAI_AGAIN`: 网络连接问题，确保容器在同一网络
- `password authentication failed`: 密码错误，检查 PGPASSWORD

### 3. 镜像拉取失败（国内服务器）

**解决方案：**
```json
// /etc/docker/daemon.json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.1panel.live"
  ]
}
```

**应用配置：**
```bash
# 重启 Docker
systemctl restart docker

# 重新拉取镜像
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local pull
```

### 4. 端口冲突

**检查：**
```bash
# 检查 3000 端口占用
netstat -tlnp | grep 3000

# 或
ss -tlnp | grep 3000
```

**修改端口：**
```bash
# .env.baota.local
PORT=3001

# docker-compose.baota.yml 也要相应修改
ports:
  - "${PORT:-3000}:3000"
```

### 5. SSL 证书申请失败

**常见原因：**

**域名未解析**
```bash
# 检查域名解析
ping your-domain.com
nslookup your-domain.com
```

**防火墙阻止**
```bash
# 检查防火墙
ufw status
iptables -L

# 开放端口
ufw allow 80/tcp
ufw allow 443/tcp
```

**宝塔面板申请错误**
- 确保在 Docker 网站中申请，不是普通网站
- 使用文件验证方式（最简单）
- 域名必须在 /www/dk_project/wwwroot/ 目录下有 .well-known 目录

**证书位置：**
```bash
# 宝塔面板证书目录
/www/server/panel/vhost/cert/your-domain/

# Nginx 配置中的路径
ssl_certificate /www/server/panel/vhost/cert/your-domain/fullchain.pem;
ssl_certificate_key /www/server/panel/vhost/cert/your-domain/privkey.pem;
```

### 6. 宝塔面板显示错误

**问题：** `KeyError` 或 `AttributeError`

**原因：** 数据库记录不完整或字段类型错误

**检查项：**
```bash
# 检查 docker_sites 表
sqlite3 /www/server/panel/data/db/docker.db "SELECT * FROM docker_sites WHERE name='your-site';"

# 检查类型字段，必须是以下之一
# php, java, go, python, proxy, app, nodejs
```

**修复方法：**
```bash
# 更新类型为 proxy
sqlite3 /www/server/panel/data/db/docker.db "UPDATE docker_sites SET type='proxy' WHERE id=1;"
```

---

## 📋 部署前检查清单

### 环境检查

- [ ] Docker 已安装并运行
  ```bash
  docker --version
  docker ps
  ```

- [ ] Docker Compose 已安装
  ```bash
  docker-compose --version
  ```

- [ ] 服务器有足够磁盘空间（至少 10GB 可用）
  ```bash
  df -h
  ```

- [ ] 服务器有足够内存（至少 2GB 可用）
  ```bash
  free -h
  ```

### 配置检查

- [ ] CODE 已配置（访问密码）
  ```bash
  cat /www/wwwroot/nextchat/.env.baota.local | grep CODE
  ```

- [ ] 用户 ID 三个变量已配置且一致
  ```bash
  grep NEXTCHAT_DEFAULT_USER_ID /www/wwwroot/nextchat/.env.baota.local
  grep DEFAULT_SYNC_USER_ID /www/wwwroot/nextchat/.env.baota.local
  grep NEXT_PUBLIC_DEFAULT_SYNC_USER_ID /www/wwwroot/nextchat/.env.baota.local
  ```

- [ ] 数据库连接信息正确
  ```bash
  grep -E "PGHOST|PGPORT|PGDATABASE|PGUSER|PGPASSWORD" /www/wwwroot/nextchat/.env.baota.local
  ```

- [ ] 端口 3000 未被占用
  ```bash
  netstat -tlnp | grep 3000
  ```

### 网络检查

- [ ] 防火墙已放行必要端口
  ```bash
  ufw status
  # 或
  iptables -L -n
  ```

- [ ] 域名已解析到服务器（如使用域名）
  ```bash
  ping your-domain.com
  ```

- [ ] 云服务器安全组已开放端口（阿里云/腾讯云等）

### 容器检查

- [ ] PostgreSQL 容器正在运行
  ```bash
  docker ps | grep postgres
  ```

- [ ] NextChat 容器正在运行
  ```bash
  docker ps | grep nextchat
  ```

- [ ] 容器在同一网络中
  ```bash
  docker network inspect nextchat_nextchat-network
  ```

### 网站配置检查

- [ ] 反向代理已配置
  ```bash
  cat /www/server/panel/vhost/nginx/your-domain.conf | grep proxy_pass
  ```

- [ ] WebSocket 支持已启用
  ```bash
  cat /www/server/panel/vhost/nginx/your-domain.conf | grep "Upgrade"
  ```

- [ ] SSL 证书已申请（如使用 HTTPS）
  ```bash
  ls -la /www/server/panel/vhost/cert/your-domain/
  ```

---

## 🚀 快速部署命令

### 完整部署流程

```bash
# 1. 进入项目目录
cd /www/wwwroot/nextchat

# 2. 配置环境变量
cp .env.baota .env.baota.local
nano .env.baota.local  # 修改必填配置

# 3. 启动 PostgreSQL
docker-compose -f docker-compose.postgres.yml up -d

# 4. 构建并启动 NextChat
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy build
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy up -d

# 5. 验证部署
docker ps | grep nextchat
curl http://127.0.0.1:3000
```

### 然后在宝塔面板中

1. Docker → Docker 网站 → 添加网站
2. 选择反向代理类型
3. 配置代理到 `http://127.0.0.1:3000`
4. 启用 WebSocket 支持
5. 申请 SSL 证书

---

## 📝 配置文件对照表

### 环境变量说明

| 环境变量 | 用途 | 是否必填 | 默认值 |
|---------|------|---------|--------|
| CODE | 访问密码 | ✅ 必填 | 无 |
| OPENAI_API_KEY | OpenAI API密钥 | ❌ 可选 | 无 |
| BASE_URL | API代理地址 | ❌ 可选 | 无 |
| NEXTCHAT_DEFAULT_USER_ID | 用户ID（后端） | ✅ 必填 | 无 |
| DEFAULT_SYNC_USER_ID | 用户ID（后端备用） | ✅ 必填 | 无 |
| NEXT_PUBLIC_DEFAULT_SYNC_USER_ID | 用户ID（前端） | ✅ 必填 | 无 |
| PGHOST | 数据库地址 | ✅ 必填 | nextchat-postgres |
| PGPORT | 数据库端口 | ✅ 必填 | 5432 |
| PGDATABASE | 数据库名 | ✅ 必填 | nextchat |
| PGUSER | 数据库用户 | ✅ 必填 | nextchat_user |
| PGPASSWORD | 数据库密码 | ✅ 必填 | 无 |
| PORT | 服务端口 | ❌ 可选 | 3000 |
| HIDE_USER_API_KEY | 隐藏用户API输入 | ❌ 可选 | false |
| DISABLE_GPT4 | 禁用GPT4 | ❌ 可选 | false |

### 目录结构

| 目录/文件 | 说明 |
|----------|------|
| /www/wwwroot/nextchat | 项目目录 |
| /www/dk_project/sites | 宝塔网站配置目录 |
| /www/server/panel/vhost/nginx | Nginx 配置目录 |
| /www/server/panel/vhost/cert | SSL 证书目录 |

---

## 🔄 更新升级

```bash
cd /www/wwwroot/nextchat

# 拉取最新代码
git pull

# 重新构建并部署
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy build
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy up -d
```

---

## 💾 数据备份

### 备份数据库

```bash
# 备份到文件
docker exec nextchat-postgres pg_dump -U nextchat_user nextchat > backup_$(date +%Y%m%d_%H%M%S).sql

# 从 Docker 卷备份
docker run --rm -v nextchat-postgres-data:/data -v $(pwd):/backup alpine tar czf /backup/nextchat-postgres-$(date +%Y%m%d).tar.gz /data
```

### 备份配置

```bash
# 备份环境配置
cp /www/wwwroot/nextchat/.env.baota.local /root/backup/

# 备份网站配置
cp /www/dk_project/sites/*/ngpt.chat.json /root/backup/

# 备份 Nginx 配置
cp /www/server/panel/vhost/nginx/ngpt.chat.conf /root/backup/
```

### 备份 SSL 证书

```bash
# 备份证书目录
cp -r /www/server/panel/vhost/cert/ngpt.chat /root/backup/
```

---

## 🔍 日志位置

### 容器日志

```bash
# NextChat 日志
docker logs nextchat
docker logs -f nextchat  # 实时查看

# PostgreSQL 日志
docker logs nextchat-postgres
```

### Nginx 日志

```bash
# 访问日志
tail -f /www/wwwlogs/your-domain.log

# 错误日志
tail -f /www/wwwlogs/your-domain.error.log
```

### 宝塔面板日志

```bash
# 面板日志
tail -f /www/server/panel/logs/error.log

# 操作日志
tail -f /tmp/panelBoot.pl
```

---

## 📞 获取帮助

- **GitHub Issues**: https://github.com/ChatGPTNextWeb/NextChat/issues
- **宝塔论坛**: https://www.bt.cn/bbs
- **项目文档**: https://github.com/ChatGPTNextWeb/NextChat

---

**部署完成后，建议立即：**
1. ✅ 测试访问和登录
2. ✅ 测试 AI 对话功能
3. ✅ 配置自动备份
4. ✅ 记录重要密码和配置
