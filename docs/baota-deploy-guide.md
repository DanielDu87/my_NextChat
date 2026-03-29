# NextChat 宝塔面板部署指南

## 前置要求

- Ubuntu 服务器
- 宝塔面板已安装
- 服务器域名（可选，用于 HTTPS）

---

## 第一步：安装 Docker 环境

1. **在宝塔面板中安装 Docker：**
   - 登录宝塔面板
   - 软件商店 -> 搜索 "Docker"
   - 安装 Docker 和 Docker Compose

2. **验证安装：**
   ```bash
   docker --version
   docker-compose --version
   ```

---

## 第二步：创建数据库

### 方案 A：使用宝塔 PostgreSQL（推荐）

1. **安装 PostgreSQL：**
   - 宝塔面板 -> 软件商店 -> 搜索 "PostgreSQL"
   - 安装 PostgreSQL 16

2. **创建数据库：**
   ```sql
   CREATE DATABASE nextchat;
   CREATE USER nextchat_user WITH PASSWORD 'your-secure-password';
   GRANT ALL PRIVILEGES ON DATABASE nextchat TO nextchat_user;
   ```

### 方案 B：使用远程数据库

在 `.env.baota` 中配置远程数据库连接信息。

---

## 第三步：部署 NextChat

### 方法 1：使用宝塔 Docker 管理器（推荐）

1. **上传项目文件：**
   ```bash
   cd /www/wwwroot
   git clone https://github.com/ChatGPTNextWeb/NextChat.git nextchat
   cd nextchat
   ```

2. **配置环境变量：**
   - 复制 `.env.baota` 为 `.env.baota.local`
   - 修改其中的必填配置：
     ```bash
     CODE=your-access-password
     OPENAI_API_KEY=your-api-key
     PGHOST=127.0.0.1
     PGPASSWORD=your-db-password
     ```

3. **在宝塔 Docker 管理器中部署：**
   - Docker 管理器 -> 项目 -> 添加项目
   - 选择 "docker-compose.yml"
   - 项目路径：`/www/wwwroot/nextchat`
   - 环境文件：`/www/wwwroot/nextchat/.env.baota.local`
   - Profile：`no-proxy`
   - 点击"提交"

### 方法 2：使用命令行

```bash
cd /www/wwwroot/nextchat

# 构建并启动
docker-compose --env-file .env.baota.local --profile no-proxy build
docker-compose --env-file .env.baota.local --profile no-proxy up -d

# 查看日志
docker logs -f nextchat
```

---

## 第四步：配置 Nginx 反向代理

1. **添加网站：**
   - 宝塔面板 -> 网站 -> 添加站点
   - 域名：填写你的域名
   - PHP版本：纯静态

2. **配置反向代理：**
   - 站点设置 -> 反向代理 -> 添加反向代理
   - 代理名称：NextChat
   - 目标URL：`http://127.0.0.1:3000`
   - 发送域名：`$host`

3. **或者直接修改配置文件：**
   - 站点设置 -> 配置文件
   - 添加项目中的 `nginx/baota-nextchat.conf` 配置

---

## 第五步：配置 SSL 证书（推荐）

1. **在宝塔面板申请证书：**
   - 站点设置 -> SSL -> Let's Encrypt
   - 申请免费证书

2. **强制 HTTPS：**
   - SSL 设置中开启"强制HTTPS"

---

## 第六步：验证部署

1. **检查容器状态：**
   ```bash
   docker ps | grep nextchat
   ```

2. **查看容器日志：**
   ```bash
   docker logs nextchat
   ```

3. **访问测试：**
   - 浏览器访问：`http://your-domain.com`
   - 输入访问密码（CODE 配置的密码）

---

## 常见问题排查

### 1. 容器无法启动

```bash
# 查看详细错误
docker logs nextchat

# 检查端口占用
netstat -tlnp | grep 3000
```

### 2. 数据库连接失败

```bash
# 测试数据库连接
psql -h 127.0.0.1 -U nextchat_user -d nextchat

# 检查 PostgreSQL 是否运行
systemctl status postgresql
```

### 3. WebSocket 连接失败

检查 Nginx 配置是否包含以下内容：
```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
```

### 4. 镜像拉取失败（国内服务器）

在 `/etc/docker/daemon.json` 添加镜像源：
```json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.1panel.live"
  ]
}
```

---

## 维护命令

```bash
# 停止服务
docker-compose --env-file .env.baota.local --profile no-proxy down

# 启动服务
docker-compose --env-file .env.baota.local --profile no-proxy up -d

# 重启服务
docker-compose --env-file .env.baota.local --profile no-proxy restart

# 更新代码
git pull
docker-compose --env-file .env.baota.local --profile no-proxy build
docker-compose --env-file .env.baota.local --profile no-proxy up -d

# 备份数据库
pg_dump -h 127.0.0.1 -U nextchat_user nextchat > backup_$(date +%Y%m%d).sql
```

---

## 安全建议

1. **修改默认端口**：不使用 3000 端口对外
2. **设置访问密码**：务必配置 CODE 参数
3. **启用 HTTPS**：使用 SSL 证书加密传输
4. **定期备份**：定期备份数据库和配置文件
5. **更新镜像**：定期更新 Docker 镜像获取安全补丁

---

## 配置文件清单

| 文件 | 说明 |
|------|------|
| `.env.baota` | 宝塔部署环境变量模板 |
| `nginx/baota-nextchat.conf` | Nginx 反向代理配置 |
| `docker-compose.yml` | Docker Compose 配置 |
| `Dockerfile` | 镜像构建配置 |
