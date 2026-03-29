# NextChat 宝塔面板 Docker 部署完整指南

## 宝塔面板 Docker 管理器使用说明

本指南基于宝塔面板最新版本的 Docker 管理器功能编写。

---

## 前提条件检查

### 1. 宝塔面板版本要求

- **最低版本**: 7.9.0 及以上
- **推荐版本**: 最新稳定版

### 2. Docker 环境要求

在宝塔面板中安装：
- **Docker**: 软件商店 -> 搜索 "Docker" -> 安装
- **Docker Compose**: 随 Docker 一起安装

### 3. 其他必需软件

- **PostgreSQL 16**: 软件商店 -> 搜索 "PostgreSQL" -> 安装
- **Nginx**: 软件商店 -> 搜索 "Nginx" -> 安装（通常默认已安装）

---

## 第一步：在宝塔面板创建网站

### 操作步骤

1. **登录宝塔面板**
2. **左侧菜单 -> 网站**
3. **点击 "添加站点" 按钮**
4. **填写表单：**
   ```
   域名：your-domain.com (或使用服务器IP)
   备注：NextChat AI 聊天
   根目录：/www/wwwroot/nextchat
   FTP：不创建
   数据库：不创建 (我们单独创建PostgreSQL)
   PHP版本：纯静态
   ```
5. **点击 "提交"**

### 配置 SSL 证书（推荐）

1. **进入站点设置 -> SSL**
2. **选择 Let's Encrypt**
3. **点击 "申请"**
4. **勾选 "强制HTTPS"**
5. **保存**

---

## 第二步：创建 PostgreSQL 数据库

### 方法 A：使用宝塔面板（推荐）

1. **数据库 -> PostgreSQL**
2. **点击 "添加数据库"**
3. **填写信息：**
   ```
   数据库名：nextchat
   用户名：nextchat_user
   密码：[设置强密码并记住]
   访问权限：本地服务器
   ```
4. **点击 "提交"**

### 方法 B：使用命令行

在宝塔面板 -> 终端执行：

```bash
# 切换到 postgres 用户
sudo -u postgres psql

# 执行 SQL 命令
CREATE DATABASE nextchat;
CREATE USER nextchat_user WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE nextchat TO nextchat_user;
\c nextchat
GRANT ALL PRIVILEGES ON SCHEMA public TO nextchat_user;
\q
```

---

## 第三步：部署 NextChat 项目

### 方法 A：使用宝塔 Docker Compose（推荐）

#### 1. 上传项目文件

**在宝塔面板 -> 终端执行：**

```bash
# 进入网站根目录
cd /www/wwwroot

# 克隆项目
git clone https://github.com/ChatGPTNextWeb/NextChat.git nextchat
cd nextchat
```

#### 2. 配置环境变量

**在宝塔面板 -> 文件管理：**

1. **进入 /www/wwwroot/nextchat 目录**
2. **新建文件 `.env.baota.local`**
3. **粘贴以下内容并修改：**

```bash
# 必填配置
PORT=3000
CODE=your-access-password-here
OPENAI_API_KEY=your-api-key-here

# 用户ID配置（三个必须一致）
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

# 国内加速
ALPINE_MIRROR=https://mirrors.aliyun.com/alpine
NPM_REGISTRY=https://registry.npmmirror.com/

# 其他配置
HIDE_USER_API_KEY=true
DISABLE_GPT4=false
ENABLE_BALANCE_QUERY=false
ENABLE_MCP=false
```

**修改必填项：**
- `CODE` - 访问密码
- `OPENAI_API_KEY` - API密钥
- `PGPASSWORD` - 数据库密码

#### 3. 添加 Compose 项目

**在宝塔面板中：**

1. **Docker -> Compose 项目**
2. **点击 "添加项目"**
3. **填写表单：**
   ```
   名称：NextChat
   项目路径：/www/wwwroot/nextchat
   Compose文件：docker-compose.baota.yml
   环境文件：.env.baota.local
   ```
4. **点击 "提交"**

#### 4. 构建并启动

1. **在 Compose 项目列表中找到 NextChat**
2. **点击 "构建"** （首次部署需要构建，约需5-10分钟）
3. **构建完成后点击 "启动"**

### 方法 B：使用命令行部署

**在宝塔面板 -> 终端执行：**

```bash
cd /www/wwwroot/nextchat

# 构建镜像
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local build

# 启动容器
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local up -d

# 查看日志
docker logs -f nextchat
```

---

## 第四步：配置 Nginx 反向代理

### 操作步骤

1. **网站 -> 找到 NextChat 站点 -> 点击 "设置"**
2. **点击 "配置文件"**
3. **找到 `location / { ... }` 部分**
4. **替换为以下配置：**

```nginx
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
}
```

5. **点击 "保存"**
6. **点击 "重载配置"**

---

## 第五步：验证部署

### 检查清单

在宝塔面板中检查以下项目：

#### Docker 容器状态

**位置：Docker -> 容器**

- [ ] 容器名：`nextchat`
- [ ] 状态：运行中
- [ ] 端口：3000
- [ ] 重启策略：unless-stopped

#### 网站访问

**浏览器访问：** `https://your-domain.com`

- [ ] 看到 NextChat 登录页面
- [ ] 输入密码成功登录
- [ ] 界面正常显示

#### 数据库连接

**在宝塔面板 -> 终端执行：**

```bash
PGPASSWORD=your_password psql -h 127.0.0.1 -U nextchat_user -d nextchat -c "SELECT version();"
```

- [ ] 成功显示 PostgreSQL 版本信息

---

## 宝塔面板日常管理

### 容器管理

**位置：Docker -> 容器 -> nextchat**

| 操作 | 说明 |
|------|------|
| 查看日志 | 点击 "日志" 按钮查看容器运行日志 |
| 重启容器 | 点击 "重启" 按钮 |
| 停止容器 | 点击 "停止" 按钮 |
| 删除容器 | 点击 "删除" 按钮（谨慎操作）|
| 查看详情 | 点击 "详情" 查看容器配置 |
| 终端访问 | 点击 "终端" 进入容器命令行 |

### Compose 项目管理

**位置：Docker -> Compose 项目 -> NextChat**

| 操作 | 说明 |
|------|------|
| 启动/停止 | 控制整个项目的运行状态 |
| 重新构建 | 代码更新后需要重新构建 |
| 编辑配置 | 修改 Compose 文件和环境变量 |
| 查看日志 | 查看项目所有容器的日志 |
| 删除项目 | 删除整个项目（谨慎操作）|

### 网站管理

**位置：网站 -> 列表 -> NextChat**

| 功能 | 说明 |
|------|------|
| 访问网站 | 点击域名直接访问 |
| 网站设置 | 修改网站配置 |
| SSL 管理 | 管理证书配置 |
| 访问日志 | 查看网站访问日志 |
| 流量统计 | 查看访问流量统计 |

### 数据库管理

**位置：数据库 -> PostgreSQL -> nextchat**

| 功能 | 说明 |
|------|------|
| 管理 | 进入 phpPgAdmin 管理 |
| 备份 | 创建数据库备份 |
| 删除 | 删除数据库（谨慎操作）|
| 权限 | 管理用户权限 |

---

## 常见管理操作

### 更新项目代码

```bash
cd /www/wwwroot/nextchat
git pull
```

然后在宝塔 Docker 管理器中：
1. **Docker -> Compose 项目 -> NextChat**
2. **点击 "重新构建"**
3. **构建完成后点击 "重启"**

### 查看实时日志

**方法 A：宝塔面板**
1. **Docker -> 容器 -> nextchat**
2. **点击 "日志"**

**方法 B：命令行**
```bash
docker logs -f nextchat
```

### 备份数据

#### 自动备份（推荐）

**宝塔面板 -> 计划任务**

1. **添加任务**
2. **任务类型：备份数据库**
3. **数据库：nextchat**
4. **备份到：服务器磁盘**
5. **执行周期：每天**
6. **保留天数：7**

#### 手动备份

```bash
# 备份数据库
PGPASSWORD=your_password pg_dump -h 127.0.0.1 -U nextchat_user nextchat > backup.sql

# 备份环境配置
cp /www/wwwroot/nextchat/.env.baota.local /www/backup/.env.baota.local.backup
```

### 恢复数据

```bash
# 恢复数据库
PGPASSWORD=your_password psql -h 127.0.0.1 -U nextchat_user nextchat < backup.sql
```

### 修改访问密码

1. **文件管理 -> 进入 /www/wwwroot/nextchat**
2. **编辑 .env.baota.local**
3. **修改 CODE 的值**
4. **保存**
5. **Docker -> 容器 -> nextchat -> 重启**

### 修改 API 密钥

1. **文件管理 -> 进入 /www/wwwroot/nextchat**
2. **编辑 .env.baota.local**
3. **修改 OPENAI_API_KEY 的值**
4. **保存**
5. **Docker -> 容器 -> nextchat -> 重启**

---

## 故障排查

### 容器无法启动

**检查步骤：**

1. **查看容器日志**
   - Docker -> 容器 -> nextchat -> 日志

2. **常见错误及解决方案：**

| 错误信息 | 原因 | 解决方案 |
|---------|------|---------|
| Cannot connect to PostgreSQL | 数据库连接失败 | 检查数据库密码，确认 PostgreSQL 运行中 |
| port is already allocated | 端口被占用 | docker ps 检查是否有其他容器占用 3000 端口 |
| permission denied | 权限不足 | 检查数据库用户权限 |
| No space left on device | 磁盘空间不足 | 清理不必要的文件或扩展磁盘 |

### 网站无法访问

**检查步骤：**

1. **检查容器是否运行**
   - Docker -> 容器 -> nextchat

2. **检查 Nginx 配置**
   - 网站 -> NextChat -> 设置 -> 配置文件

3. **测试容器内部访问**
   ```bash
   docker exec nextchat wget -qO- http://localhost:3000
   ```

4. **检查防火墙**
   - 安全 -> 防火墙 -> 确认端口已开放

### 数据库连接失败

**检查步骤：**

1. **测试数据库连接**
   ```bash
   PGPASSWORD=your_password psql -h 127.0.0.1 -U nextchat_user -d nextchat
   ```

2. **检查 PostgreSQL 状态**
   - 软件商店 -> PostgreSQL -> 重载配置

3. **检查数据库权限**
   ```sql
   \c nextchat
   GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO nextchat_user;
   ```

### 更新后无法访问

**解决方案：**

1. **清除浏览器缓存**
2. **检查容器是否正常运行**
3. **查看容器日志排查错误**
4. **如果修改了环境变量，需要重新构建容器**

---

## 性能优化建议

### 资源限制配置

**在 Compose 文件中添加资源限制：**

```yaml
services:
  nextchat:
    deploy:
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '0.5'
          memory: 512M
```

### 日志轮转

**宝塔面板已自动配置日志轮转，默认保留3个日志文件，每个最大10M。**

### 数据库优化

```sql
-- 定期清理旧数据
DELETE FROM messages WHERE created_at < NOW() - INTERVAL '90 days';

-- 清理并优化
VACUUM ANALYZE;
```

---

## 安全建议

### 1. 修改默认端口

虽然容器使用 3000 端口，但外部无法直接访问，只通过 Nginx 反向代理访问。

### 2. 设置强密码

- CODE 访问密码：至少12位，包含大小写字母、数字和特殊字符
- 数据库密码：至少16位，使用强密码生成器

### 3. 启用 HTTPS

使用宝塔面板申请 Let's Encrypt 免费证书，并开启强制 HTTPS。

### 4. 定期备份

配置自动备份任务，至少每天备份数据库。

### 5. 监控资源使用

在宝塔面板中监控 CPU、内存和磁盘使用情况。

---

## 附录：快速命令参考

```bash
# 进入项目目录
cd /www/wwwroot/nextchat

# 查看容器状态
docker ps

# 查看容器日志
docker logs nextchat

# 重启容器
docker restart nextchat

# 停止容器
docker stop nextchat

# 启动容器
docker start nextchat

# 进入容器终端
docker exec -it nextchat sh

# 测试数据库连接
PGPASSWORD=your_password psql -h 127.0.0.1 -U nextchat_user -d nextchat

# 备份数据库
PGPASSWORD=your_password pg_dump -h 127.0.0.1 -U nextchat_user nextchat > backup.sql

# 更新代码
git pull

# 重新构建
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local build

# 重启项目
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local up -d
```
