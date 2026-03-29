# NextChat 宝塔面板图形界面部署指南

## 前提条件

- Ubuntu 服务器已安装宝塔面板
- 已安装 Docker 和 Docker Compose
- 已安装 Nginx

---

## 第一步：在宝塔面板创建网站

### 1. 添加站点

1. **登录宝塔面板**
2. **左侧菜单 -> 网站**
3. **点击 "添加站点"**
4. **填写信息：**
   - 域名：`your-domain.com`（或使用服务器 IP）
   - 备注：`NextChat`
   - 根目录：`/www/wwwroot/nextchat`
   - FTP：不创建
   - 数据库：不创建（我们单独创建）
   - PHP版本：纯静态

5. **点击提交**

### 2. 配置 SSL 证书（可选但推荐）

1. **进入站点设置**
2. **SSL -> Let's Encrypt**
3. **申请证书**
4. **开启强制 HTTPS**

---

## 第二步：在宝塔面板安装 PostgreSQL

### 1. 安装 PostgreSQL

1. **软件商店 -> 搜索 "PostgreSQL"**
2. **安装 PostgreSQL 16**
3. **等待安装完成**

### 2. 创建数据库

**方法 A：使用宝塔面板**

1. **数据库 -> PostgreSQL**
2. **点击 "添加数据库"**
3. **填写信息：**
   - 数据库名：`nextchat`
   - 用户名：`nextchat_user`
   - 密码：[设置强密码]
   - 访问权限：本地服务器

**方法 B：使用命令行**

```bash
# 在宝塔面板 -> 终端 中执行
sudo -u postgres psql
CREATE DATABASE nextchat;
CREATE USER nextchat_user WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE nextchat TO nextchat_user;
\c nextchat
GRANT ALL PRIVILEGES ON SCHEMA public TO nextchat_user;
\q
```

---

## 第三步：配置 Nginx 反向代理

### 1. 进入站点配置

1. **网站 -> 找到 NextChat 站点**
2. **点击 "设置"**
3. **配置文件**

### 2. 修改配置文件

在 `location /` 之前添加以下配置：

```nginx
# NextChat 反向代理配置
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;

    # WebSocket 支持
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # 代理头部
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;

    # 超时设置
    proxy_connect_timeout 60s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;

    # 缓冲设置
    proxy_buffering off;
    proxy_request_buffering off;
}
```

### 3. 保存并重载配置

**保存后点击 "重载配置" 或：**
```bash
# 宝塔面板 -> 软件商店 -> Nginx -> 重载配置
```

---

## 第四步：准备项目文件

### 1. 上传项目到服务器

**方法 A：使用宝塔文件管理器**

1. **文件 -> 进入 /www/wwwroot**
2. **点击 "远程下载"**
3. **输入 URL：** `https://github.com/ChatGPTNextWeb/NextChat/archive/refs/heads/main.zip`
4. **下载完成后解压**
5. **重命名文件夹为 `nextchat`**

**方法 B：使用 Git（推荐）**

```bash
# 在宝塔面板 -> 终端 中执行
cd /www/wwwroot
rm -rf nextchat
git clone https://github.com/ChatGPTNextWeb/NextChat.git nextchat
cd nextchat
```

### 2. 创建环境变量文件

```bash
# 在 /www/wwwroot/nextchat 目录下创建 .env.baota
nano /www/wwwroot/nextchat/.env.baota
```

**复制以下内容到文件：**

```bash
# NextChat 宝塔面板部署配置
PORT=3000
CODE=your-access-password-here
OPENAI_API_KEY=your-api-key-here
GOOGLE_API_KEY=

# 用户标识配置（三个必须一致）
NEXTCHAT_DEFAULT_USER_ID=single-user
DEFAULT_SYNC_USER_ID=single-user
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=single-user

# 数据库配置
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=nextchat
PGUSER=nextchat_user
PGPASSWORD=your-db-password-here
PGSSL=false
PGSSLMODE=disable

# 连接池配置
PGPOOL_MAX=10
PG_CONNECT_TIMEOUT_MS=10000
PG_IDLE_TIMEOUT_MS=30000

# 国内加速配置
ALPINE_MIRROR=https://mirrors.aliyun.com/alpine
NPM_REGISTRY=https://registry.npmmirror.com/

# 其他配置
HIDE_USER_API_KEY=true
DISABLE_GPT4=false
ENABLE_BALANCE_QUERY=false
DISABLE_FAST_LINK=false
ENABLE_MCP=false
ENABLE_GOOGLE_FONTS=false
```

**修改必填项：**
- `CODE` - 设置访问密码
- `OPENAI_API_KEY` - 填入你的 API 密钥
- `PGPASSWORD` - 填入数据库密码

---

## 第五步：使用宝塔 Docker 管理器部署

### 方法 A：使用 Docker Compose 模板（推荐）

1. **Docker -> Compose 模板**
2. **添加 Compose 模板**
3. **填写信息：**
   - 名称：`NextChat`
   - 路径：`/www/wwwroot/nextchat`
   - 模板内容：（从 `docker-compose.yml` 复制或使用以下简化版本）

4. **简化版 docker-compose.yml（如果需要手动创建）：**

```yaml
version: '3.8'
services:
  nextchat:
    image: nextchat:latest
    container_name: nextchat
    restart: unless-stopped
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - PORT=3000
      - CODE=${CODE}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
      - NEXTCHAT_DEFAULT_USER_ID=${NEXTCHAT_DEFAULT_USER_ID}
      - DEFAULT_SYNC_USER_ID=${DEFAULT_SYNC_USER_ID}
      - NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=${NEXT_PUBLIC_DEFAULT_SYNC_USER_ID}
      - PGHOST=127.0.0.1
      - PGPORT=${PGPORT}
      - PGDATABASE=${PGDATABASE}
      - PGUSER=${PGUSER}
      - PGPASSWORD=${PGPASSWORD}
```

### 方法 B：直接添加 Compose 项目

1. **Docker -> Compose 项目**
2. **添加项目**
3. **填写信息：**
   - 名称：`NextChat`
   - 路径：`/www/wwwroot/nextchat`
   - 环境文件：`.env.baota`

4. **保存后构建并启动**

---

## 第六步：验证部署

### 1. 检查 Docker 容器

**宝塔面板 -> Docker -> 容器**

应该看到：
- 容器名：`nextchat`
- 状态：运行中
- 端口：3000

### 2. 检查网站

**浏览器访问：** `https://your-domain.com`

应该看到 NextChat 登录页面。

### 3. 输入密码测试

使用 `.env.baota` 中 `CODE` 配置的密码登录。

---

## 宝塔面板管理界面

### 容器管理

**位置：** Docker -> 容器

可以看到：
- ✅ 容器运行状态
- ✅ CPU/内存使用情况
- ✅ 容器日志
- ✅ 重启/停止按钮

### 网站管理

**位置：** 网站 -> 列表

可以看到：
- ✅ NextChat 网站
- ✅ 域名信息
- ✅ SSL 证书状态
- ✅ 访问日志

### 数据库管理

**位置：** 数据库 -> PostgreSQL

可以看到：
- ✅ nextchat 数据库
- ✅ 数据库大小
- ✅ 管理/备份按钮

---

## 常见管理操作

### 查看容器日志

**宝塔面板：**
1. **Docker -> 容器**
2. **找到 nextchat 容器**
3. **点击 "日志"**

**命令行：**
```bash
docker logs -f nextchat
```

### 重启容器

**宝塔面板：**
1. **Docker -> 容器**
2. **找到 nextchat 容器**
3. **点击 "重启"**

**命令行：**
```bash
docker restart nextchat
```

### 更新项目

```bash
# 1. 拉取最新代码
cd /www/wwwroot/nextchat
git pull

# 2. 重新构建（如果需要）
docker-compose --env-file .env.baota build

# 3. 重启容器
docker restart nextchat
```

### 备份数据库

**宝塔面板：**
1. **数据库 -> PostgreSQL**
2. **找到 nextchat 数据库**
3. **点击 "备份"**

---

## 故障排查

### 容器无法启动

1. **查看日志：** Docker -> 容器 -> 日志
2. **检查配置：** 确认 `.env.baota` 配置正确
3. **检查端口：** 确认 3000 端口未被占用

### 网站无法访问

1. **检查 Nginx：** 网站 -> 设置 -> 配置文件
2. **检查容器：** Docker -> 容器 -> 确认运行中
3. **检查防火墙：** 安全 -> 确认端口已开放

### 数据库连接失败

1. **检查 PostgreSQL：** 软件商店 -> PostgreSQL -> 确认运行中
2. **测试连接：**
   ```bash
   PGPASSWORD=your_password psql -h 127.0.0.1 -U nextchat_user -d nextchat
   ```

---

## 定期维护建议

### 自动备份

**宝塔面板 -> 计划任务**

添加以下任务：

1. **数据库备份（每天凌晨 2 点）**
   - 任务类型：备份数据库
   - 数据库：nextchat
   - 保留天数：7

2. **网站文件备份（每周）**
   - 任务类型：备份网站
   - 目录：/www/wwwroot/nextchat
   - 保留天数：30

### 监控告警

**宝塔面板 -> 监控**

设置以下监控：
- 容器状态监控
- 磁盘空间监控
- CPU/内存使用监控
