# NextChat - 宝塔面板部署说明

本项目是 NextChat AI 聊天应用的宝塔面板部署版本，使用 **自定义构建的 Docker 镜像**。

## 🔔 重要说明

### 先判断数据库来源

- 如果你是全新部署，准备直接使用当前 Compose 自带的 PostgreSQL 容器，可以继续使用本文的 `docker-compose.baota.yml`。
- 如果你已经有一套正在使用的 PostgreSQL，且里面已经有历史聊天、API 配置、同步数据，不要直接使用 `docker-compose.baota.yml`。
- 原因是 [docker-compose.baota.yml](/Users/dyx/Code/NextChat/docker-compose.baota.yml) 默认把应用固定连接到 Compose 内部的 `postgres` 服务，这会让页面连到一套新的空库，看起来像“数据库没数据”。
- 复用已有外部 PostgreSQL 时，应改用 [docker-compose.yml](/Users/dyx/Code/NextChat/docker-compose.yml) 配合 [`.env.docker`](/Users/dyx/Code/NextChat/.env.docker) 和 `--profile no-proxy`，让应用直接连接现有数据库。

### 自定义镜像

本项目使用自定义构建的 NextChat Docker 镜像，包含以下特性：

- ✅ **已集成自定义 AI 提供商**
- ✅ **服务器端配置 API Key**
- ✅ **其他定制功能和优化**

### 部署特点

由于使用自定义镜像，部署时：

**不需要配置：**
- ❌ OpenAI API Key（已由镜像配置）
- ❌ 自定义 API 地址（已由镜像配置）
- ❌ 其他 AI 服务商配置（已由镜像配置）

**只需配置：**
- ✅ 访问密码（CODE）
- ✅ 数据库连接信息
- ✅ 用户标识配置

**用户使用时：**
- 用户可以直接使用预配置的 AI 服务
- 也可以在界面中配置自己的 API Key（需要设置 `HIDE_USER_API_KEY=false`）

## 📦 已包含的配置文件

| 文件 | 说明 |
|------|------|
| `.env.baota` | 环境变量配置模板 |
| `docker-compose.baota.yml` | Docker Compose 配置（宝塔专用）|
| `nginx/baota-nextchat.conf` | Nginx 反向代理配置 |

## 🚀 快速开始

### 方法一：推荐部署方式（宝塔面板 + Docker Compose）

适用前提：

- 当前要使用的是本机新建 PostgreSQL。
- 不需要复用历史外部数据库。

#### 第一步：部署 Docker 容器

1. **配置环境变量**
   ```bash
   cd /www/wwwroot/nextchat
   cp .env.baota .env.baota.local
   nano .env.baota.local  # 修改必填配置
   ```

2. **修改必填配置**
   ```bash
   # 访问密码
   CODE=your-access-password

   # 数据库密码
   PGPASSWORD=your-db-password

   # 用户标识（三个必须一致）
   NEXTCHAT_DEFAULT_USER_ID=single-user
   DEFAULT_SYNC_USER_ID=single-user
   NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=single-user
   ```

3. **启动 PostgreSQL 数据库**
   ```bash
   docker-compose -f docker-compose.postgres.yml up -d
   ```

4. **构建并启动 NextChat**
   ```bash
   docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy build
   docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy up -d
   ```

   当前推荐约定：
   - 直接在远程服务器构建并启动
   - 构建源使用官方仓库
   - `APK_MIRROR=https://dl-cdn.alpinelinux.org/alpine`
   - `NPM_REGISTRY=https://registry.npmjs.org/`

### 已有外部 PostgreSQL 的正确做法

如果你的历史数据已经在别的 PostgreSQL 实例里：

1. 不要使用 `docker-compose.baota.yml`
2. 编辑 [`.env.docker`](/Users/dyx/Code/NextChat/.env.docker)，填写现有数据库连接：
   - `PGHOST`
   - `PGPORT`
   - `PGDATABASE`
   - `PGUSER`
   - `PGPASSWORD`
3. 使用 [docker-compose.yml](/Users/dyx/Code/NextChat/docker-compose.yml) 启动：

```bash
docker compose -f docker-compose.yml --env-file .env.docker --profile no-proxy build
docker compose -f docker-compose.yml --env-file .env.docker --profile no-proxy up -d
```

4. 宝塔仍然只负责反向代理到 `127.0.0.1:3000`
5. 不要删除同步用户相关变量：
   - `NEXTCHAT_DEFAULT_USER_ID`
   - `DEFAULT_SYNC_USER_ID`
   - `NEXT_PUBLIC_DEFAULT_SYNC_USER_ID`

补充说明：

- `NEXT_PUBLIC_DEFAULT_SYNC_USER_ID` 是前端构建期变量。
- 如果自定义了 `docker-compose.yml`，但没有把这个变量传给 `build.args` 和容器环境，浏览器会报：

```text
[SyncUser] 缺少 NEXT_PUBLIC_DEFAULT_SYNC_USER_ID
```

- 修改这类变量后，必须重新 `build` 并重新 `up -d`，仅重启容器不够。

5. **验证容器运行**
   ```bash
   docker ps | grep nextchat
   curl http://127.0.0.1:3000
   ```

#### 第二步：在宝塔面板创建网站

1. **进入 Docker 网站管理**
   - 宝塔面板 → Docker → Docker 网站

2. **添加反向代理网站**
   - 点击"添加网站"
   - 选择"反向代理"类型
   - 网站名称：`my_NextChat`（使用项目名称，不要用服务器 IP）
   - 填写域名：`ngpt.chat`
   - 填写备注：`NextChat AI 聊天应用`
   - 点击"提交"

3. **配置反向代理**
   - 网站创建后，点击"设置"
   - 选择"反向代理"选项卡
   - 配置代理信息：
     - 代理目录：`/`
     - 目标URL：`http://127.0.0.1:3000`
     - 发送域名：`$host`（默认）
   - 启用 WebSocket 支持（重要！）
   - 点击"保存"

4. **验证配置**
   - 检查 Nginx 配置文件：
     ```bash
     cat /www/server/panel/vhost/nginx/ngpt.chat.conf
     ```
   - 确认包含 WebSocket 配置：
     ```nginx
     proxy_http_version 1.1;
     proxy_set_header Upgrade $http_upgrade;
     proxy_set_header Connection $connection_upgrade;
     ```

#### 第三步：申请 SSL 证书

1. **进入网站 SSL 设置**
   - 在 Docker 网站列表中，点击您的网站
   - 选择"SSL"选项卡

2. **申请 Let's Encrypt 证书**
   - 选择"Let's Encrypt"
   - 选择申请方式：
     - **文件验证**（推荐）：需要域名已解析到服务器
     - **DNS 验证**：需要配置 DNS API
   - 点击"申请"
   - 等待证书签发完成

3. **启用强制 HTTPS**
   - 证书申请成功后
   - 开启"强制HTTPS"选项
   - 点击"保存"

4. **验证 HTTPS**
   ```bash
   curl -I https://your-domain.com
   ```

#### 第四步：完成部署

1. **访问网站**
   - 打开浏览器访问：`https://your-domain.com`
   - 输入访问密码（CODE 配置的密码）

2. **配置 AI 服务**（可选）
   - 如果服务器未配置默认 AI 服务
   - 在设置中添加您自己的 API Key

---

### 方法二：完全使用宝塔面板（图形界面）

**适合人群：** 不熟悉命令行的用户

#### 前置条件

1. 在宝塔面板安装 Docker 和 Docker Compose
2. 确保服务器已安装 PostgreSQL 或使用远程数据库

#### 部署步骤

1. **上传项目文件**
   ```bash
   cd /www/wwwroot
   git clone https://github.com/ChatGPTNextWeb/NextChat.git nextchat
   cd nextchat
   ```

2. **使用宝塔 Docker 管理器**
   - Docker → Compose 项目 → 添加项目
   - 项目路径：`/www/wwwroot/nextchat`
   - Compose 文件：选择 `docker-compose.baota.yml`
   - 环境文件：选择 `.env.baota.local`（需提前创建并配置）

3. **创建网站**（同方法一第二步）

4. **申请 SSL 证书**（同方法一第三步）

---

## 📚 详细文档

### 核心文档
- [快速参考指南](docs/baota-quick-reference.md) ⭐ **推荐新手**
- [完整部署指南](docs/baota-deploy-guide-updated.md)
- [宝塔部署注意事项](docs/baota-deploy-checklist-updated.md)

### 故障排查
- [数据库问题快速排除](docs/database-quick-fix.md) ⭐ **遇到问题先看这里**
- [同步配置问题修复](docs/sync-config-fix.md) ⭐ **新增 - "没有可同步的配置条目"**
- [数据库故障排查指南](docs/baota-database-troubleshooting.md)
- [数据库修复说明](docs/database-fix-summary.md)

### 其他文档
- [同步功能使用指南](docs/sync-usage-guide.md) ⭐ **新增 - 如何正确使用同步功能**
- [图形界面部署指南](docs/baota-gui-deploy.md)
- [数据库配置指南](docs/baota-database-setup.md)

## 🔧 宝塔面板管理

| 功能 | 位置 |
|------|------|
| 容器管理 | Docker → 容器 |
| 网站管理 | Docker → Docker 网站 |
| 数据库管理 | Docker → PostgreSQL |
| SSL 证书 | 网站 → SSL 选项卡 |

### 当前推荐命名

- 宝塔 Docker 网站名称：`my_NextChat`
- 站点域名：`ngpt.chat`
- Docker 网站名称和域名分开维护，不要再把网站名称直接写成服务器 IP。

## 📁 部署后的目录结构

```
/www/wwwroot/nextchat/              # 项目目录
├── .env.baota.local                # 环境变量配置
├── docker-compose.baota.yml        # Docker Compose 配置
├── docker-compose.postgres.yml     # PostgreSQL 配置

/www/dk_project/sites/ngpt.chat/    # 宝塔网站配置
└── ngpt.chat.json                  # 网站配置文件

/www/server/panel/vhost/nginx/      # Nginx 配置目录
└── ngpt.chat.conf                  # 网站 Nginx 配置

/www/server/panel/vhost/cert/ngpt.chat/  # SSL 证书目录
├── fullchain.pem                   # 完整证书链
└── privkey.pem                     # 私钥
```

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

3. **生产构建源**：默认使用官方源，不再推荐第三方镜像源
   ```dotenv
   APK_MIRROR=https://dl-cdn.alpinelinux.org/alpine
   NPM_REGISTRY=https://registry.npmjs.org/
   ```

4. **WebSocket 配置**：必须在反向代理中启用 WebSocket 支持
   ```nginx
   proxy_http_version 1.1;
   proxy_set_header Upgrade $http_upgrade;
   proxy_set_header Connection $connection_upgrade;
   ```

5. **SSL 证书续期**：宝塔面板会自动续期 Let's Encrypt 证书
   - 证书到期前 30 天自动续期
   - 也可手动续期：网站 → SSL → 续期

6. **数据库初始化**：首次启动自动创建表结构，无需手动操作

## 🐛 故障排查

### 容器问题

**查看容器日志：**
```bash
docker logs -f nextchat
```

**检查容器状态：**
```bash
docker ps | grep nextchat
```

**重启容器：**
```bash
docker restart nextchat
```

### 数据库连接问题

**测试数据库连接：**
```bash
docker exec -it nextchat-postgres psql -U nextchat_user -d nextchat
```

**检查数据库状态：**
```bash
docker logs nextchat-postgres
```

### 网站访问问题

**检查 Nginx 配置：**
```bash
nginx -t
```

**重新加载 Nginx：**
```bash
nginx -s reload
```

**部署后仍看到旧前端报错：**

- 先强制刷新浏览器，或使用无痕窗口重新打开站点
- 如果只是重建了容器，但浏览器还在跑旧 bundle，会继续看到已经修复过的旧错误
```bash
nginx -s reload
```

**检查端口占用：**
```bash
netstat -tlnp | grep 3000
```

### SSL 证书问题

**查看证书信息：**
```bash
certbot certificates
```

**手动续期：**
```bash
certbot renew
```

## 🔄 更新升级

```bash
cd /www/wwwroot/nextchat

# 拉取最新代码
git pull

# 重新构建并部署
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local build
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local up -d
```

## 💾 数据备份

### 备份数据库

```bash
# 备份到文件
docker exec nextchat-postgres pg_dump -U nextchat_user nextchat > backup_$(date +%Y%m%d).sql

# 从 Docker 卷备份
docker run --rm -v nextchat-postgres-data:/data -v $(pwd):/backup alpine tar czf /backup/postgres-$(date +%Y%m%d).tar.gz /data
```

### 备份配置文件

```bash
# 备份环境配置
cp .env.baota.local .env.baota.local.backup

# 备份网站配置
cp /www/dk_project/sites/ngpt.chat/ngpt.chat.json /root/ngpt.chat.json.backup
```

### 备份 SSL 证书

```bash
cp -r /www/server/panel/vhost/cert/ngpt.chat /root/ssl-backup/
```

## 📞 支持

- GitHub Issues: https://github.com/ChatGPTNextWeb/NextChat/issues
- 项目文档: https://github.com/ChatGPTNextWeb/NextChat
