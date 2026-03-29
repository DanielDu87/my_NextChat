# NextChat 宝塔面板完整部署指南

本文档提供了 NextChat 在宝塔面板上的完整部署流程，包括 Docker 容器部署、网站配置和 SSL 证书申请。

## 📋 部署前准备

### 系统要求

- Ubuntu 20.04+ / CentOS 8+ / Debian 11+
- 宝塔面板 7.9.0+
- 至少 2GB RAM，建议 4GB+
- 至少 10GB 可用磁盘空间
- 域名（可选，用于 HTTPS）

### 检查清单

- [ ] 服务器已安装宝塔面板
- [ ] 已在宝塔面板安装 Docker 和 Docker Compose
- [ ] 已准备域名（如需 HTTPS）
- [ ] 域名 DNS 已解析到服务器 IP

---

## 第一部分：部署 NextChat Docker 容器

### 步骤 1：下载项目

```bash
# 进入网站根目录
cd /www/wwwroot

# 克隆项目
git clone https://github.com/ChatGPTNextWeb/NextChat.git nextchat
cd nextchat
```

### 步骤 2：配置环境变量

```bash
# 复制环境变量模板
cp .env.baota .env.baota.local

# 编辑配置文件
nano .env.baota.local
```

**必填配置项：**

```bash
# 访问密码（必填）
CODE=your-access-password

# 数据库密码（必填）
PGPASSWORD=your-db-password

# 用户标识（三个必须一致，非常重要！）
NEXTCHAT_DEFAULT_USER_ID=single-user
DEFAULT_SYNC_USER_ID=single-user
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=single-user

# 数据库配置
PGHOST=nextchat-postgres
PGPORT=5432
PGDATABASE=nextchat
PGUSER=nextchat_user
```

**可选配置项：**

```bash
# AI 服务商配置（如果服务器已配置可留空）
OPENAI_API_KEY=
BASE_URL=

# 功能配置
HIDE_USER_API_KEY=false          # 允许用户配置自己的 API Key
DISABLE_GPT4=false               # 不禁用 GPT-4
ENABLE_GOOGLE_FONTS=false        # 国内建议关闭
```

### 步骤 3：启动 PostgreSQL 数据库

```bash
# 启动 PostgreSQL 容器
docker-compose -f docker-compose.postgres.yml up -d

# 等待数据库就绪
sleep 10

# 验证数据库运行
docker ps | grep postgres
```

### 步骤 4：构建并启动 NextChat

```bash
# 构建镜像（首次部署需要，时间较长）
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy build

# 启动容器
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy up -d

# 查看容器状态
docker ps | grep nextchat
```

**预期输出：**
```
nextchat            Up X minutes   0.0.0.0:3000->3000/tcp
nextchat-postgres   Up X minutes   0.0.0.0:5432->5432/tcp
```

### 步骤 5：验证容器运行

```bash
# 检查 NextChat 日志
docker logs nextchat

# 测试本地访问
curl http://127.0.0.1:3000

# 测试数据库健康检查
curl http://127.0.0.1:3000/api/db/health
```

**预期响应：**
```json
{
  "ok": true,
  "postgres": {
    "version": "PostgreSQL 16.x",
    "database": "nextchat"
  }
}
```

---

## 第二部分：在宝塔面板创建网站

### 步骤 1：进入 Docker 网站管理

1. 登录宝塔面板
2. 左侧菜单 → **Docker**
3. 点击 **Docker 网站**

### 步骤 2：添加反向代理网站

1. 点击 **添加网站** 按钮
2. 填写以下信息：
   - **域名**：`your-domain.com`（您的域名）
   - **备注**：`NextChat AI 聊天应用`
   - **根目录**：自动生成（如 `/www/dk_project/wwwroot/your-domain.com`）
   - **类型**：选择 **反向代理**
3. 点击 **提交**

### 步骤 3：配置反向代理

1. 在网站列表中找到刚创建的网站
2. 点击右侧的 **设置** 按钮
3. 选择 **反向代理** 选项卡
4. 点击 **添加反向代理**

**配置信息：**

| 配置项 | 值 |
|--------|-----|
| 代理名称 | NextChat |
| 代理目录 | `/` |
| 目标URL | `http://127.0.0.1:3000` |
| 发送域名 | `$http_host`（默认） |

5. **重要：启用 WebSocket 支持**
   - 在反向代理配置中
   - 找到 **WebSocket** 设置
   - 启用 WebSocket 支持
   - 或在高级配置中添加：
     ```nginx
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection $connection_upgrade;
     ```
6. 点击 **保存**

### 步骤 4：验证反向代理配置

**方法 1：通过宝塔面板**
- 点击 **配置文件**
- 检查是否包含以下内容：
  ```nginx
  location ^~ / {
      proxy_pass http://127.0.0.1:3000;
      proxy_set_header Host $http_host;
      # ... 其他配置

      # WebSocket 支持
      proxy_http_version 1.1;
      proxy_set_header Upgrade $http_upgrade;
      proxy_set_header Connection $connection_upgrade;
  }
  ```

**方法 2：通过命令行**
```bash
cat /www/server/panel/vhost/nginx/your-domain.conf | grep -A 10 "location"
```

### 步骤 5：测试 HTTP 访问

```bash
# 测试域名访问
curl -I http://your-domain.com

# 预期响应包含
HTTP/1.1 200 OK
```

或在浏览器中访问：`http://your-domain.com`

---

## 第三部分：申请 SSL 证书

### 步骤 1：进入 SSL 设置

1. 在 Docker 网站列表中
2. 点击您的网站
3. 选择 **SSL** 选项卡

### 步骤 2：申请 Let's Encrypt 证书

**前提条件：**
- 域名已解析到服务器 IP
- 服务器 80 端口和 443 端口已开放

**申请步骤：**

1. 选择 **Let's Encrypt**
2. **申请方式**（推荐顺序）：

   **方式一：文件验证**（推荐）
   - 最简单，适合大多数情况
   - 宝塔会自动在网站根目录创建验证文件
   - 点击 **申请**
   - 等待签发（通常 10-30 秒）

   **方式二：DNS 验证**
   - 适用于域名未解析或使用 CDN 的情况
   - 需要配置 DNS 服务商 API
   - 选择对应的 DNS 服务商
   - 填写 API 密钥
   - 点击 **申请**

3. 等待证书签发完成
4. 看到 **证书部署成功** 提示

### 步骤 3：启用强制 HTTPS

1. 证书申请成功后
2. 找到 **强制 HTTPS** 选项
3. 开启强制 HTTPS
4. 点击 **保存**

### 步骤 4：验证 HTTPS

**方法 1：命令行**
```bash
curl -I https://your-domain.com

# 预期响应
HTTP/2 200
server: nginx
strict-transport-security: max-age=31536000
```

**方法 2：浏览器**
1. 访问 `https://your-domain.com`
2. 检查地址栏的锁图标
3. 点击查看证书详情

**方法 3：在线检测**
- SSL Labs: https://www.ssllabs.com/ssltest/
- 输入域名进行检测

---

## 第四部分：完成部署并测试

### 步骤 1：访问 NextChat

1. 打开浏览器
2. 访问：`https://your-domain.com`
3. 输入访问密码（CODE 配置的密码）

### 步骤 2：配置 AI 服务（可选）

如果服务器未配置默认 AI 服务：

1. 登录后进入 **设置**
2. 在 **API 配置** 中添加您的 API Key：
   - OpenAI API Key
   - 或其他服务商 API Key
3. 配置自定义 API 地址（如需要）
4. 保存配置

### 步骤 3：测试对话

1. 创建新会话
2. 输入测试消息
3. 验证 AI 响应正常

### 步骤 4：测试实时功能

1. 测试流式输出
2. 测试多轮对话
3. 测试会话历史保存

---

## 🔧 常见问题排查

### 问题 1：容器无法启动

**检查步骤：**
```bash
# 查看容器状态
docker ps -a

# 查看容器日志
docker logs nextchat

# 检查端口占用
netstat -tlnp | grep 3000
```

**解决方案：**
- 确保端口 3000 未被占用
- 检查环境变量配置是否正确
- 查看日志中的错误信息

### 问题 2：数据库连接失败

**检查步骤：**
```bash
# 检查 PostgreSQL 容器
docker ps | grep postgres

# 测试数据库连接
docker exec -it nextchat-postgres psql -U nextchat_user -d nextchat

# 检查网络连接
docker network inspect nextchat_nextchat-network
```

**解决方案：**
- 确保 PostgreSQL 容器正在运行
- 检查数据库密码是否正确
- 确保两个容器在同一网络

### 问题 3：网站无法访问

**检查步骤：**
```bash
# 测试本地访问
curl http://127.0.0.1:3000

# 测试 Nginx 配置
nginx -t

# 查看 Nginx 错误日志
tail -f /www/wwwlogs/your-domain.com.error.log
```

**解决方案：**
- 确保 NextChat 容器正在运行
- 检查 Nginx 配置文件语法
- 重新加载 Nginx：`nginx -s reload`

### 问题 4：WebSocket 连接失败

**症状：**
- AI 响应不流畅
- 控制台显示连接错误

**解决方案：**
1. 检查 Nginx 配置是否包含 WebSocket 支持
2. 确认反向代理配置中有：
   ```nginx
   proxy_http_version 1.1;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection $connection_upgrade;
   ```
3. 重新加载 Nginx

### 问题 5：SSL 证书申请失败

**常见原因：**
- 域名未解析到服务器
- 防火墙阻止 80/443 端口
- 服务器时间不准确

**解决方案：**
```bash
# 检查域名解析
ping your-domain.com

# 检查防火墙
ufw status
iptables -L

# 检查服务器时间
date

# 如果时间不准，同步时间
ntpdate -u time.nist.gov
```

### 问题 6：密码错误无法登录

**解决方案：**
```bash
# 查看当前密码配置
cat /www/wwwroot/nextchat/.env.baota.local | grep CODE

# 如果忘记密码，修改配置
nano /www/wwwroot/nextchat/.env.baota.local
# 修改 CODE=your-new-password

# 重启容器
docker restart nextchat
```

---

## 🔄 日常维护

### 查看运行状态

```bash
# 查看所有容器
docker ps

# 查看容器资源使用
docker stats

# 查看日志
docker logs -f nextchat
```

### 重启服务

```bash
# 重启 NextChat
docker restart nextchat

# 重启 PostgreSQL
docker restart nextchat-postgres

# 重启所有服务
cd /www/wwwroot/nextchat
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local restart
```

### 更新应用

```bash
cd /www/wwwroot/nextchat

# 拉取最新代码
git pull

# 重新构建
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local build

# 重启服务
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local up -d
```

### 备份数据

```bash
# 创建备份目录
mkdir -p /root/nextchat-backup

# 备份数据库
docker exec nextchat-postgres pg_dump -U nextchat_user nextchat > /root/nextchat-backup/db_$(date +%Y%m%d).sql

# 备份配置
cp /www/wwwroot/nextchat/.env.baota.local /root/nextchat-backup/
cp /www/dk_project/sites/*/your-domain.json /root/nextchat-backup/

# 备份 SSL 证书
cp -r /www/server/panel/vhost/cert/your-domain /root/nextchat-backup/
```

### SSL 证书续期

Let's Encrypt 证书有效期为 90 天，宝塔面板会自动续期。

**手动续期：**
```bash
# 方式 1：通过宝塔面板
# 网站 → SSL → 续期

# 方式 2：命令行
certbot renew

# 强制续期
certbot renew --force-renewal
```

---

## 📊 性能优化

### 容器资源限制

编辑 `docker-compose.baota.yml`，添加资源限制：

```yaml
services:
  nextchat:
    # ... 其他配置
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G
```

### 数据库优化

```bash
# 进入数据库
docker exec -it nextchat-postgres psql -U nextchat_user -d nextchat

# 创建索引（根据需要）
CREATE INDEX idx_messages_created_at ON messages(created_at);
```

### Nginx 缓存配置

在宝塔面板网站设置中启用：
- 静态文件缓存
- Gzip 压缩
- HTTP/2

---

## 🔐 安全建议

1. **使用强密码**：CODE 密码至少 12 位，包含大小写字母、数字和特殊字符

2. **启用 HTTPS**：必须配置 SSL 证书

3. **定期备份**：每天自动备份数据库

4. **更新系统**：定期更新系统和 Docker

5. **防火墙配置**：
   ```bash
   # 只开放必要端口
   ufw allow 22/tcp   # SSH
   ufw allow 80/tcp   # HTTP
   ufw allow 443/tcp  # HTTPS
   ufw enable
   ```

6. **监控日志**：定期检查访问日志和错误日志

---

## 📞 获取帮助

- **GitHub Issues**: https://github.com/ChatGPTNextWeb/NextChat/issues
- **项目文档**: https://github.com/ChatGPTNextWeb/NextChat
- **宝塔论坛**: https://www.bt.cn/bbs

---

**部署完成后，请记得：**
1. 测试所有功能
2. 配置自动备份
3. 设置监控告警
4. 定期检查更新

祝您使用愉快！🎉
