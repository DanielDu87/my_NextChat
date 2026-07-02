# NextChat 宝塔面板完整部署指南

本指南详细说明如何在 Ubuntu 服务器上使用宝塔面板部署 NextChat 项目。

当前推荐约定：

- 项目目录：`/www/dk_project/my_NextChat`
- Compose 项目名：`my_nextchat`
- 宝塔 Docker 网站名称：`chat.dyxcloud.com`
- 访问域名：`https://chat.dyxcloud.com`
- 宝塔 Docker 网站路径：`/www/dk_project/my_NextChat`
- Sub2API 项目目录：`/www/dk_project/my_sub2api`
- Sub2API 宝塔 Docker 网站名称：`sub2api.chat.dyxcloud.com`
- Sub2API 域名：`sub2api.chat.dyxcloud.com`

---

## 目录

1. [环境准备](#环境准备)
2. [宝塔面板安装](#宝塔面板安装)
3. [安装必需软件](#安装必需软件)
4. [创建网站](#创建网站)
5. [创建数据库](#创建数据库)
6. [部署 NextChat](#部署-nextchat)
7. **[初始化配置数据](#初始化配置数据)**
8. [配置 Nginx](#配置-nginx)
9. [验证部署](#验证部署)
10. [日常管理](#日常管理)
11. [常见问题](#常见问题)

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
| 根目录 | `/www/dk_project/my_NextChat` | 推荐与实际项目目录保持一致 |
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

### 先确认是否复用历史数据库

在继续之前，先判断你属于哪一种：

- 全新部署，准备直接使用当前 Compose 自带的 PostgreSQL。
- 已有一套外部 PostgreSQL，里面已经保存了历史聊天、API 配置、同步快照或模型数据。

如果你属于第二种，不要直接使用 `docker-compose.baota.yml`。

原因：

- [docker-compose.baota.yml](../docker-compose.baota.yml) 默认把应用固定连接到内部 `postgres` 服务。
- 这样部署后，页面会连到一套新的空库，表现为“数据库明明有数据，但页面看不到”。

复用已有外部 PostgreSQL 时，请改用：

- [docker-compose.yml](../docker-compose.yml)
- [`.env.docker`](../.env.docker)
- `--profile no-proxy`

示例：

```bash
cd /www/dk_project/my_NextChat

# 填好现有数据库连接
vim .env.docker

docker compose -f docker-compose.yml --env-file .env.docker --profile no-proxy build
docker compose -f docker-compose.yml --env-file .env.docker --profile no-proxy up -d
```

宝塔面板仍然只需要把站点反向代理到 `127.0.0.1:3000`。

额外注意：

- 不要遗漏 `NEXTCHAT_DEFAULT_USER_ID`、`DEFAULT_SYNC_USER_ID`、`NEXT_PUBLIC_DEFAULT_SYNC_USER_ID`
- 其中 `NEXT_PUBLIC_DEFAULT_SYNC_USER_ID` 属于前端构建期变量
- 如果自定义 Compose 时没有把它传给 `build.args` 和容器环境，浏览器会直接报：

```text
[SyncUser] 缺少 NEXT_PUBLIC_DEFAULT_SYNC_USER_ID
```

- 这种情况必须重新 `docker compose ... build` 后再 `up -d`，只重启容器不会修复

### 步骤 1：上传项目文件

**在宝塔面板 -> 终端执行：**

```bash
# 进入部署目录
mkdir -p /www/dk_project
cd /www/dk_project

# 克隆项目
git clone https://github.com/DanielDu87/my_NextChat.git

# 进入项目目录
cd my_NextChat

# 查看项目文件
ls -la
```

**应该看到以下重要文件：**
- `docker-compose.baota.yml` - Docker Compose 配置
- `.env.baota` - 环境变量模板
- `Dockerfile` - 镜像构建文件

### 步骤 2：配置环境变量

**在宝塔面板 -> 文件管理：**

1. **进入 `/www/dk_project/my_NextChat` 目录**
2. **复制 `.env.baota` 文件并重命名为 `.env.baota.local`**
3. **编辑 `.env.baota.local`**

**修改以下必填配置：**

```bash
# ============================================================================
# 必填配置（必须修改）
# ============================================================================

# 访问密码 - 设置后需要输入此密码才能访问
CODE=YourAccessPassword123

# 数据库密码 - 使用前面创建的密码
PGPASSWORD=YourStrongPassword123!

# ============================================================================
# 同步数据归属 ID（不是登录用户名，三个必须保持一致）
# ============================================================================
NEXTCHAT_DEFAULT_USER_ID=user:admin
DEFAULT_SYNC_USER_ID=user:admin
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=user:admin
```

**其他配置保持默认即可**

**保存文件**

### 步骤 3：使用宝塔 Docker 部署

**在宝塔面板中：**

1. **Docker -> Compose 项目**
2. **点击 "添加项目"**
3. **填写表单：**

| 配置项 | 值 |
|--------|-----|
| 名称 | `my_nextchat` |
| 项目路径 | `/www/dk_project/my_NextChat` |
| Compose 文件 | `docker-compose.baota.yml` |
| 环境文件 | `.env.baota.local` |

4. **点击 "提交"**

5. **构建镜像**
   - 在项目列表中找到 NextChat
   - 点击 "构建" 按钮
   - 等待构建完成（约需 5-10 分钟）

6. **启动容器**
   - 构建完成后点击 "启动"

### 步骤 4：创建 Docker 网站

**在宝塔面板中：**

1. 进入 `Docker -> Docker 网站`
2. 点击 `添加网站`
3. 网站名称填写：`chat.dyxcloud.com`
4. 域名填写：`chat.dyxcloud.com`
5. 代理目标填写：`http://127.0.0.1:3000`
6. 开启 WebSocket 支持并保存

补充说明：

- 当前实际约定里，宝塔 Docker 网站名称必须直接使用域名 `chat.dyxcloud.com`
- 域名、站点 JSON、Nginx 配置文件名、证书目录继续使用同一个域名 `chat.dyxcloud.com`
- 不要把 `docker_sites.name` / `dk_sites.name` 改成 `nextchat` 这种项目名
- 否则宝塔 Docker 面板会按网站名称去读取 `/www/server/panel/vhost/cert/{name}` 和 `/www/server/panel/vhost/nginx/{name}.conf`，SSL 状态会显示异常
- 项目名应写在备注字段，例如 `docker_sites.remark = nextchat`、`dk_sites.ps = nextchat`
- 站点路径固定使用 `/www/dk_project/my_NextChat`
- 不要再把站点目录放到 `/www/dk_project/wwwroot/...`
- Sub2API 的站点路径固定使用 `/www/dk_project/my_sub2api`
- 不再使用旧目录 `/www/dk_project/sub2api_runtime`
- 如果残留旧路径，例如 `/www/dk_project/wwwroot/43.163.5.9` 或 `/www/dk_project/wwwroot/chat.dyxcloud.com`，需要清理后再维护

代码同步规则：

- 提交完成后，服务器代码默认通过 Git 同步到：
  - `/www/dk_project/my_NextChat`
  - `/www/dk_project/my_sub2api`
- 如果服务器无法直接访问远端仓库，可临时使用 `git bundle` 到服务器后再 `git fetch bundle`
- `git bundle` 只作为临时同步方式，完成后应删除 bundle 文件

如果已经踩坑，先检查：

```bash
sqlite3 /www/server/panel/data/db/docker.db "select id,name,path from dk_sites;"
sqlite3 /www/server/panel/data/db/docker.db "select id,name,path from docker_sites;"
cat /www/dk_project/sites/chat.dyxcloud.com/chat.dyxcloud.com.json
cat /www/server/panel/vhost/nginx/chat.dyxcloud.com.conf
```

必须满足：

- `dk_sites.name = chat.dyxcloud.com`
- `docker_sites.name = chat.dyxcloud.com`
- `docker_sites.path = /www/dk_project/my_NextChat`
- `chat.dyxcloud.com.json` 的 `site_path = /www/dk_project/my_NextChat`
- `chat.dyxcloud.com.conf` 的 `root = /www/dk_project/my_NextChat`
- SSL 证书目录必须存在：`/www/server/panel/vhost/cert/chat.dyxcloud.com/`

---

## 首次打开与自动同步

### 当前行为

部署完成后，不需要再手动往 `app_settings` 里预插入空配置。

当前版本在首次打开页面时会自动执行 PostgreSQL 同步：
- 如果浏览器本地还是空白初始状态，会优先恢复服务器数据库中的聊天、API 配置、模型、提示词、面具、插件和绘图数据。
- 如果本地已经有用户数据，则继续按原来的双向同步逻辑处理，避免覆盖用户刚刚在本地做的修改。

### 首次验证步骤

1. 浏览器打开 `https://chat.dyxcloud.com` 并完成登录。
2. 等待 1 到 3 秒，让页面自动同步完成。
3. 打开设置页，确认服务器里已有的 API 配置、模型和聊天记录已经出现在本地页面。

补充说明：

- 自动同步只会读取“当前应用实际连接的那一套 PostgreSQL”。
- 如果你把应用部署成了内置 `postgres`，而历史数据在另一台外部 PostgreSQL，上面的自动同步不会帮你跨库恢复数据。
- 这种情况需要先把部署连接切回原来的数据库，再谈首次同步恢复。
- 如果刚部署完仍然看到旧的前端报错，先强制刷新浏览器或使用无痕窗口，确认页面已经加载新 bundle。
- 如果浏览器已经提示证书正常，后续访问统一使用 `https://chat.dyxcloud.com`，不要再使用 IP 地址访问。
- 如果输入密码后页面没有进入系统，先确认当前访问地址不是 `http://服务器IP`
- 这种情况优先用无痕窗口重新打开 `https://chat.dyxcloud.com`

### 什么时候才需要手动处理数据库

只有在以下异常情况下，才需要手动检查 PostgreSQL 中的同步数据：
- 历史数据库里已经存在错误格式的 `app-config` 或 `access-control` 快照。
- 首次打开后浏览器控制台持续出现同步报错。
- 你明确要清空某个用户的云端快照并重新导入。

如果只是“全新部署后首次打开页面”，默认不需要执行任何手动初始化 SQL。

### 这次部署里实际出现过的问题

1. 宝塔专用 Compose 默认连接内置 `postgres`
   如果你的历史聊天和 API 配置在外部 PostgreSQL，必须切到 `docker-compose.yml + .env.docker + --profile no-proxy`
2. 浏览器缺少 `NEXT_PUBLIC_DEFAULT_SYNC_USER_ID` 会直接导致数据库同步报错
   修改后必须重新 `build`，不是只重启容器
3. `app-config` 快照过大时，模型同步和 API 配置恢复可能一起超时
   此时要优先排查快照体积，不要误判成“数据库没有配置”
4. `Local` provider 指向 `localhost`
   在公网域名下刷新模型会报 502，这种配置通常应视为本地开发专用
5. SSL 正常后必须统一使用域名访问
   继续使用 IP 访问会触发浏览器不安全提示，也会干扰站点密码验证和跳转
6. `Sub2API` 如果不需要代理，必须显式关闭 `AUTH_DIR_SYNC_PROXY_ENABLED`
   并清空 `AUTH_DIR_SYNC_PROXY_HOST`、`AUTH_DIR_SYNC_PROXY_PORT`
   否则每次按 `.env` / `docker-compose.yml` 重建时，都会把 `172.17.0.1:7890` 再带回容器，导致聊天转发超时

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

### 5. 测试配置同步

1. **点击右上角设置图标**
2. **点击 "保存并同步"**
3. **应该显示"配置已保存"，不再报错**

---

## 日常管理

### 宝塔面板管理界面

#### 容器管理

**位置：** Docker -> 容器 -> nextchat

**可执行操作：**
- 查看容器状态
- 查看容器日志
- 重启容器
- 停止容器
- 删除容器（谨慎操作）
- 进入终端

#### Compose 项目管理

**位置：** Docker -> Compose 项目 -> NextChat

**可执行操作：**
- 启动/停止项目
- 重新构建
- 查看日志
- 编辑配置

#### 网站管理

**位置：** 网站 -> 列表 -> NextChat

**可执行操作：**
- 访问网站
- 查看访问日志
- 配置 SSL
- 修改配置

#### 数据库管理

**位置：** 数据库 -> PostgreSQL -> nextchat

**可执行操作：**
- 管理数据库
- 备份数据
- 恢复数据

### 常用管理命令

```bash
# 项目目录
cd /www/dk_project/my_NextChat

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
cd /www/dk_project/my_NextChat

# 拉取最新代码
git pull

# 在宝塔 Docker 管理器中
# Docker -> Compose 项目 -> NextChat -> 重新构建
# 构建完成后 -> 重启
```

### 修改配置

#### 修改访问密码

1. **文件管理 -> `/www/dk_project/my_NextChat`**
2. **编辑 `.env.baota.local`**
3. **修改 `CODE` 的值**
4. **保存**
5. **Docker -> 容器 -> nextchat -> 重启**

#### 重置配置（如果配置出错）

```bash
# 删除配置数据
PGPASSWORD=YourPassword psql -h 127.0.0.1 -U nextchat_user -d nextchat << 'EOF'
DELETE FROM app_settings WHERE user_id = (SELECT id FROM app_users WHERE external_id = 'user:admin');
INSERT INTO app_settings (user_id, chat_settings, plugin_settings, security_settings, extra_settings)
SELECT
  id,
  '{}'::jsonb as chat_settings,
  '{}'::jsonb as plugin_settings,
  '{}'::jsonb as security_settings,
  '{}'::jsonb as extra_settings
FROM app_users WHERE external_id = 'user:admin';
EOF
```

---

## 常见问题

### Q1: 点击"保存并同步"提示"没有可同步的配置条目"

**原因：** 数据库配置表 `app_settings` 是空的。

**解决方法：** 执行上面"初始化配置数据"步骤中的 SQL 脚本。

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

### Q4: 配置保存后刷新丢失

**原因：** 浏览器缓存或配置未正确保存到数据库。

**解决方法：**

1. **清除浏览器缓存**
2. **检查配置是否保存到数据库：**
   ```bash
   PGPASSWORD='YourPassword' psql -h 127.0.0.1 -U nextchat_user -d nextchat -c "SELECT jsonb_pretty(extra_settings) FROM app_settings;"
   ```
3. **如果为空，重新执行初始化配置脚本**

### Q5: 数据无法同步

**检查步骤：**

1. **检查同步数据归属 ID 配置是否一致：**
   ```bash
   # 检查环境变量
   docker exec nextchat env | grep NEXTCHAT

   # 检查数据库
   PGPASSWORD='YourPassword' psql -h 127.0.0.1 -U nextchat_user -d nextchat -c "SELECT external_id FROM app_users;"
   ```

2. **确保三者一致：**
   - `NEXTCHAT_DEFAULT_USER_ID=user:admin`
   - `DEFAULT_SYNC_USER_ID=user:admin`
   - `NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=user:admin`

3. **如果不一致，修改 `.env.baota.local` 并重启容器**

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
PGPASSWORD='YourPassword' psql -h 127.0.0.1 -U nextchat_user -d nextchat

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

## 附录：快速命令参考

```bash
# 进入项目目录
cd /www/dk_project/my_NextChat

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

# 初始化配置数据
PGPASSWORD='YourPassword' psql -h 127.0.0.1 -U nextchat_user -d nextchat -c "
DO $$
DECLARE user_id uuid;
BEGIN
  SELECT id INTO user_id FROM app_users WHERE external_id = 'user:admin';
  IF user_id IS NULL THEN
    INSERT INTO app_users (id, external_id, display_name, locale, timezone, is_active)
    VALUES (generate_uuid_v4(), 'user:admin', 'user:admin', 'zh-CN', 'Asia/Shanghai', true);
    SELECT id INTO user_id FROM app_users WHERE external_id = 'user:admin';
  END IF;
  DELETE FROM app_settings WHERE user_id = user_id;
  INSERT INTO app_settings (user_id, chat_settings, plugin_settings, security_settings, extra_settings)
  VALUES (user_id, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb, '{}'::jsonb);
END $$;
"

# 查看配置数据
PGPASSWORD='YourPassword' psql -h 127.0.0.1 -U nextchat_user -d nextchat -c "SELECT user_id, jsonb_pretty(extra_settings) FROM app_settings;"
```
