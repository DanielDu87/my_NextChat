# NextChat 宝塔面板完整部署指南

本指南详细说明如何在 Ubuntu 服务器上使用宝塔面板部署 NextChat 项目。

---

## 目录

1. [环境准备](#环境准备)
2. [宝塔面板安装](#宝塔面板安装)
3. [安装必需软件](#安装必需软件)
4. [创建网站](#创建网站)
5. [创建数据库](#创建数据库)
6. [部署 NextChat](#部署-nextchat)
7. [配置 Nginx](#配置-nginx)
8. [验证部署](#验证部署)
9. [日常管理](#日常管理)
10. [常见问题](#常见问题)

---

## 环境准备

### 服务器要求

- **操作系统**: Ubuntu 20.04 / 22.04 / 24.04
- **内存**: 最低 2GB，推荐 4GB+
- **硬盘**: 最低 20GB 可用空间
- **网络**: 服务器需要有公网 IP

### 域名准备（可选）

- 已有域名：将域名 A 记录解析到服务器 IP
- 无域名：可直接使用服务器 IP 访问

---

## 宝塔面板安装

### 安装命令

在服务器终端执行：

```bash
# Ubuntu/Debian 安装命令
wget -O install.sh https://download.bt.cn/install/install-ubuntu_6.0.sh && sudo bash install.sh ed8484bec
```

### 安装完成

安装完成后会显示：

```
==================================================================
Congratulations! Installed successfully!
==================================================================
Bt-Panel: http://你的服务器IP:8888/xxxxxxxx
username: xxxxxxxx
password: xxxxxxxx
==================================================================
```

### 登录宝塔面板

1. **浏览器访问**: `http://你的服务器IP:8888`
2. **输入用户名和密码**
3. **绑定宝塔账号**（可选，推荐绑定）

---

## 安装必需软件

登录宝塔面板后，需要安装以下软件：

### 1. 安装 Nginx

1. **软件商店 -> 搜索 "Nginx"**
2. **点击 "安装"**
3. **等待安装完成**

### 2. 安装 PostgreSQL

1. **软件商店 -> 搜索 "PostgreSQL"**
2. **选择版本 16**
3. **点击 "安装"**
4. **等待安装完成**

### 3. 安装 Docker

1. **软件商店 -> 搜索 "Docker"**
2. **点击 "安装"**
3. **等待安装完成**（会自动安装 Docker Compose）

### 4. 安装 Python（可选）

如需使用自动初始化脚本：

1. **软件商店 -> 搜索 "Python"**
2. **选择 Python 3.x**
3. **点击 "安装"**

---

## 创建网站

### 添加站点

1. **左侧菜单 -> 网站**
2. **点击 "添加站点"**
3. **填写表单：**

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 域名 | `your-domain.com` 或服务器 IP | 使用域名或 IP |
| 备注 | `NextChat AI 聊天` | 便于识别 |
| 根目录 | `/www/wwwroot/nextchat` | 自动创建 |
| FTP | 不创建 | 不需要 |
| 数据库 | 不创建 | 单独创建 PostgreSQL |
| PHP 版本 | 纯静态 | 不需要 PHP |

4. **点击 "提交"**

### 配置 SSL 证书（推荐）

1. **进入站点设置 -> SSL**
2. **选择 Let's Encrypt**
3. **填写邮箱（用于证书到期提醒）**
4. **点击 "申请"**
5. **勾选 "强制HTTPS"**
6. **保存**

---

## 创建数据库

### 方法 A：使用宝塔面板（推荐）

1. **数据库 -> PostgreSQL**
2. **点击 "添加数据库"**
3. **填写信息：**

| 配置项 | 值 | 说明 |
|--------|-----|------|
| 数据库名 | `nextchat` | 数据库名称 |
| 用户名 | `nextchat_user` | 数据库用户 |
| 密码 | `YourStrongPassword123!` | 设置强密码并记住 |
| 访问权限 | 本地服务器 | 安全考虑 |

4. **点击 "提交"**
5. **记录数据库密码**

### 方法 B：使用命令行

在宝塔面板 -> 终端执行：

```bash
# 创建数据库和用户
sudo -u postgres psql << EOF
CREATE DATABASE nextchat;
CREATE USER nextchat_user WITH ENCRYPTED PASSWORD 'YourStrongPassword123!';
GRANT ALL PRIVILEGES ON DATABASE nextchat TO nextchat_user;
\c nextchat
GRANT ALL PRIVILEGES ON SCHEMA public TO nextchat_user;
EOF

# 测试连接
PGPASSWORD='YourStrongPassword123!' psql -h 127.0.0.1 -U nextchat_user -d nextchat -c "SELECT version();"
```

---

## 部署 NextChat

### 步骤 1：上传项目文件

**在宝塔面板 -> 终端执行：**

```bash
# 进入网站根目录
cd /www/wwwroot

# 删除默认创建的目录（如果有）
rm -rf nextchat

# 克隆 NextChat 项目
git clone https://github.com/ChatGPTNextWeb/NextChat.git nextchat

# 进入项目目录
cd nextchat

# 查看项目文件
ls -la
```

**应该看到以下重要文件：**
- `docker-compose.yml` - Docker Compose 配置
- `docker-compose.baota.yml` - 宝塔专用配置
- `.env.baota` - 环境变量模板
- `Dockerfile` - 镜像构建文件

### 步骤 2：配置环境变量

**在宝塔面板 -> 文件管理：**

1. **进入 `/www/wwwroot/nextchat` 目录**
2. **找到 `.env.baota` 文件**
3. **复制该文件并重命名为 `.env.baota.local`**
4. **编辑 `.env.baota.local`**

**修改以下必填配置：**

```bash
# ============================================================================
# 必填配置（必须修改）
# ============================================================================

# 访问密码 - 设置后需要输入此密码才能访问
CODE=YourAccessPassword123

# API 密钥 - 至少配置一个
OPENAI_API_KEY=sk-your-openai-api-key-here
GOOGLE_API_KEY=

# 数据库密码 - 使用前面创建的密码
PGPASSWORD=YourStrongPassword123!

# ============================================================================
# 用户标识配置（三个必须保持一致）
# ============================================================================
NEXTCHAT_DEFAULT_USER_ID=single-user
DEFAULT_SYNC_USER_ID=single-user
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=single-user
```

**其他配置保持默认即可，如需调整可参考：**

```bash
# 数据库配置
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=nextchat
PGUSER=nextchat_user

# 国内加速（建议保留）
ALPINE_MIRROR=https://mirrors.aliyun.com/alpine
NPM_REGISTRY=https://registry.npmmirror.com/

# 功能配置
HIDE_USER_API_KEY=true          # 隐藏用户 API 输入框
DISABLE_GPT4=false              # 是否禁用 GPT-4
ENABLE_BALANCE_QUERY=false      # 是否启用余额查询
ENABLE_GOOGLE_FONTS=false       # 是否使用 Google 字体
```

**保存文件**

### 步骤 3：使用宝塔 Docker 部署

#### 方法 A：使用 Docker Compose 功能（推荐）

1. **Docker -> Compose 项目**
2. **点击 "添加项目"**
3. **填写表单：**

| 配置项 | 值 |
|--------|-----|
| 名称 | `NextChat` |
| 项目路径 | `/www/wwwroot/nextchat` |
| Compose 文件 | `docker-compose.baota.yml` |
| 环境文件 | `.env.baota.local` |

4. **点击 "提交"**

5. **构建镜像**
   - 在项目列表中找到 NextChat
   - 点击 "构建" 按钮
   - 等待构建完成（约需 5-10 分钟，取决于网络速度）

6. **启动容器**
   - 构建完成后点击 "启动"
   - 等待容器启动完成

#### 方法 B：使用命令行部署

**在宝塔面板 -> 终端执行：**

```bash
cd /www/wwwroot/nextchat

# 构建镜像
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local build

# 启动容器
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local up -d

# 查看启动日志
docker logs -f nextchat
```

**看到以下信息表示启动成功：**

```
✓ Ready in 1123ms
```

### 步骤 4：验证容器运行

**在宝塔面板中检查：**

1. **Docker -> 容器**
2. **应该看到 `nextchat` 容器状态为 "运行中"**

**或使用命令行检查：**

```bash
docker ps | grep nextchat
```

**应该看到：**

```
CONTAINER ID   IMAGE          COMMAND           STATUS         PORTS
xxxxxxxxxxxx   nextchat:xxx   "dumb-init --…"   Up 2 minutes   0.0.0.0:3000->3000/tcp
```

---

## 配置 Nginx

### 修改站点配置

1. **网站 -> 找到 NextChat 站点 -> 点击 "设置"**
2. **点击 "配置文件"**
3. **找到 `location / { ... }` 部分**

**将整个 `location /` 块替换为：**

```nginx
location / {
    # 反向代理到 NextChat 容器
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;

    # WebSocket 支持（实时对话需要）
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";

    # 代理头部
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-Host $host;
    proxy_set_header X-Forwarded-Port $server_port;

    # 超时设置（长时间对话需要）
    proxy_connect_timeout 60s;
    proxy_send_timeout 300s;
    proxy_read_timeout 300s;

    # 缓冲设置（关闭以支持实时流式响应）
    proxy_buffering off;
    proxy_request_buffering off;

    # 禁用缓存
    proxy_cache_bypass $http_upgrade;
}
```

4. **点击 "保存"**
5. **点击 "重载配置"**

---

## 验证部署

### 1. 检查容器状态

**宝塔面板：**
- Docker -> 容器 -> nextchat -> 状态应显示 "运行中"

**命令行：**
```bash
docker ps
```

### 2. 检查容器日志

**宝塔面板：**
- Docker -> 容器 -> nextchat -> 点击 "日志"

**命令行：**
```bash
docker logs nextchat
```

**应该看到：**
```
▲ Next.js 14.1.1
- Local:        http://localhost:3000
✓ Ready in 1123ms
```

### 3. 测试网站访问

**浏览器访问：** `https://your-domain.com`

**应该看到：**
- NextChat 登录页面
- 显示 "访问验证" 和密码输入框

### 4. 登录测试

1. **输入前面配置的访问密码**（`CODE` 的值）
2. **点击 "进入系统"**
3. **应该成功进入聊天界面**

### 5. 测试对话功能

1. **在聊天框输入消息**
2. **发送测试**
3. **检查是否能正常回复**

---

## 日常管理

### 宝塔面板管理界面

#### 容器管理

**位置：** Docker -> 容器

**可执行操作：**
- 查看容器状态
- 查看容器日志
- 重启容器
- 停止容器
- 删除容器
- 进入终端

#### Compose 项目管理

**位置：** Docker -> Compose 项目

**可执行操作：**
- 启动/停止项目
- 重新构建
- 查看日志
- 编辑配置

#### 网站管理

**位置：** 网站 -> 列表

**可执行操作：**
- 访问网站
- 查看访问日志
- 配置 SSL
- 修改配置

#### 数据库管理

**位置：** 数据库 -> PostgreSQL

**可执行操作：**
- 管理数据库
- 备份数据
- 恢复数据

### 常用管理命令

```bash
# 项目目录
cd /www/wwwroot/nextchat

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

# 进入容器终端
docker exec -it nextchat sh

# 查看数据库连接
PGPASSWORD='YourPassword' psql -h 127.0.0.1 -U nextchat_user -d nextchat -c "SELECT version();"
```

### 更新项目

```bash
cd /www/wwwroot/nextchat

# 拉取最新代码
git pull

# 重新构建（在宝塔面板操作更方便）
# Docker -> Compose 项目 -> NextChat -> 重新构建
```

### 修改配置

#### 修改访问密码

1. **文件管理 -> `/www/wwwroot/nextchat`**
2. **编辑 `.env.baota.local`**
3. **修改 `CODE` 的值**
4. **保存**
5. **Docker -> 容器 -> nextchat -> 重启**

#### 修改 API 密钥

1. **文件管理 -> `/www/wwwroot/nextchat`**
2. **编辑 `.env.baota.local`**
3. **修改 `OPENAI_API_KEY` 的值**
4. **保存**
5. **Docker -> 容器 -> nextchat -> 重启**

### 数据备份

#### 自动备份

1. **计划任务 -> 添加任务**
2. **任务类型：** 备份数据库
3. **数据库：** nextchat
4. **备份到：** 服务器磁盘
5. **执行周期：** 每天
6. **保留天数：** 7

#### 手动备份

```bash
# 备份数据库
PGPASSWORD='YourPassword' pg_dump -h 127.0.0.1 -U nextchat_user nextchat > /www/backup/nextchat_$(date +%Y%m%d).sql

# 备份配置文件
cp /www/wwwroot/nextchat/.env.baota.local /www/backup/.env.baota.local.backup
```

---

## 常见问题

### Q1: 容器无法启动

**检查步骤：**

1. **查看容器日志：**
   - Docker -> 容器 -> nextchat -> 日志

2. **常见错误：**

| 错误 | 原因 | 解决方案 |
|------|------|---------|
| Cannot connect to PostgreSQL | 数据库连接失败 | 检查密码是否正确，确认 PostgreSQL 运行中 |
| port is already allocated | 端口被占用 | `docker ps` 检查是否有其他容器占用 3000 端口 |
| permission denied | 权限不足 | 检查数据库用户权限 |

### Q2: 网站无法访问

**检查步骤：**

1. **容器是否运行：**
   - Docker -> 容器 -> nextchat
   - 确认状态为 "运行中"

2. **Nginx 配置是否正确：**
   - 网站 -> NextChat -> 设置 -> 配置文件
   - 确认反向代理配置正确

3. **防火墙是否开放：**
   - 安全 -> 防火墙
   - 确认 80、443 端口已开放

### Q3: 数据库连接失败

**检查步骤：**

1. **测试连接：**
   ```bash
   PGPASSWORD='YourPassword' psql -h 127.0.0.1 -U nextchat_user -d nextchat
   ```

2. **确认 PostgreSQL 运行：**
   - 软件商店 -> PostgreSQL
   - 确认状态为 "运行中"

3. **重置密码（如果忘记）：**
   ```sql
   ALTER USER nextchat_user WITH PASSWORD 'NewPassword123!';
   ```

### Q4: 更新后无法访问

**解决方案：**

1. **清除浏览器缓存**
2. **检查容器是否正常运行**
3. **重新构建容器**（如果修改了环境变量）

### Q5: 忘记访问密码

**解决方案：**

1. **查看配置文件：**
   ```bash
   cat /www/wwwroot/nextchat/.env.baota.local | grep CODE
   ```

2. **修改密码：**
   - 编辑 `.env.baota.local` 中的 `CODE`
   - 重启容器

---

## 性能优化

### 资源限制

在宝塔面板中可以为容器设置资源限制：

**Docker -> 容器 -> nextchat -> 编辑**

添加资源限制：
- CPU 限制：2 核
- 内存限制：2GB

### 日志管理

宝塔面板已自动配置日志轮转：
- 默认保留 3 个日志文件
- 每个日志文件最大 10M

### 数据库优化

定期清理旧数据：

```sql
-- 连接到数据库
psql -h 127.0.0.1 -U nextchat_user -d nextchat

-- 清理 90 天前的消息
DELETE FROM messages WHERE created_at < NOW() - INTERVAL '90 days';

-- 优化数据库
VACUUM ANALYZE;
```

---

## 安全建议

1. **使用强密码**
   - 访问密码至少 12 位
   - 数据库密码至少 16 位
   - 包含大小写字母、数字和特殊字符

2. **启用 HTTPS**
   - 使用 Let's Encrypt 免费证书
   - 开启强制 HTTPS

3. **定期备份**
   - 每天自动备份数据库
   - 定期备份配置文件

4. **监控资源**
   - 在宝塔面板首页监控 CPU、内存、磁盘使用

5. **定期更新**
   - 定期更新宝塔面板
   - 定期更新项目代码

---

## 附录

### 文件结构

```
/www/wwwroot/nextchat/
├── .env.baota                    # 环境变量模板
├── .env.baota.local              # 实际使用的环境变量（需创建）
├── docker-compose.baota.yml      # Docker Compose 配置（宝塔专用）
├── Dockerfile                    # 镜像构建文件
├── nginx/
│   └── baota-nextchat.conf       # Nginx 配置参考
├── docs/
│   ├── baota-quick-start.md      # 快速开始指南
│   ├── baota-docker-guide.md     # Docker 部署指南
│   └── ...
└── README_BAOTA.md               # 宝塔部署说明
```

### 端口说明

| 端口 | 用途 | 说明 |
|------|------|------|
| 80 | HTTP | 宝塔面板使用 |
| 443 | HTTPS | 宝塔面板使用 |
| 8888 | 宝塔面板 | 宝塔面板管理端口 |
| 3000 | NextChat | 容器内部端口，不对外 |
| 5432 | PostgreSQL | 数据库端口，不对外 |

### 目录说明

| 目录 | 用途 |
|------|------|
| /www/wwwroot | 网站根目录 |
| /www/server | 宝塔软件安装目录 |
| /www/backup | 备份目录 |
| /var/lib/docker | Docker 数据目录 |
