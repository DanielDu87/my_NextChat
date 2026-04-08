# NextChat 宝塔部署说明

> **本地开发**：查看 [本地开发部署指南](docs/local-dev-guide.md) 了解如何在本地使用 Docker + PostgreSQL 进行开发。

当前线上部署约定已经调整为：

- 宝塔 Nginx 只负责把域名反代到 `127.0.0.1:3000`
- `nextchat` 容器直接连接外部 PostgreSQL
- 不再在 `docker-compose.baota.yml` 中内置本地 `postgres` 服务

如果你已经有历史聊天、用户、API 配置或同步数据，必须沿用同一套外部 PostgreSQL；不要再额外起一套本地库，否则页面能打开，但数据会落到另一套数据库里。

## 文件说明

| 文件 | 说明 |
|------|------|
| `.env.baota` | 宝塔环境变量模板 |
| `docker-compose.baota.yml` | 宝塔专用 Compose，直连远程 PostgreSQL |
| `nginx/baota-nextchat.conf` | Nginx 反向代理示例 |

## 当前推荐目录

- 项目目录：`/www/dk_project/my_NextChat`
- 宝塔站点名称：`ngpt.chat`
- 访问域名：`ngpt.chat`
- Nginx 反代目标：`http://127.0.0.1:3000`

## 必填环境变量

至少需要配置以下变量：

```env
CODE=your-access-password

PGHOST=your-postgres-host
PGPORT=5432
PGDATABASE=nextchat
PGUSER=your-postgres-user
PGPASSWORD=your-postgres-password
PGSSL=false
PGSSLMODE=disable

NEXTCHAT_DEFAULT_USER_ID=single-user
DEFAULT_SYNC_USER_ID=single-user
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=single-user

APP_SECRET=your-app-secret
```

说明：

- `APP_SECRET` 必须固定，不要在重建容器时随意变更
- 如果你已经保存过加密的 API Key 或敏感配置，修改 `APP_SECRET` 后会导致旧密文无法正常解密
- 三个同步用户变量必须保持一致

## 宝塔部署步骤

### 1. 准备代码

```bash
cd /www/dk_project
git clone git@github.com:DanielDu87/my_NextChat.git
cd my_NextChat
```

### 2. 配置环境变量

```bash
cp .env.baota .env.baota.local
nano .env.baota.local
```

把外部 PostgreSQL 连接信息和访问密码填进去。

### 3. 构建并启动

```bash
cd /www/dk_project/my_NextChat
export BUILDX_CONFIG=/tmp/nextchat-docker-buildx
mkdir -p "$BUILDX_CONFIG"
docker compose -f docker-compose.baota.yml --env-file .env.baota.local build nextchat
docker compose -f docker-compose.baota.yml --env-file .env.baota.local up -d nextchat
```

### 4. 验证数据库连接

```bash
curl http://127.0.0.1:3000/api/db/health
```

返回结果里应确认：

- `configuredHost` 是目标 PostgreSQL 主机
- `database` 是 `nextchat`
- `user` 是实际数据库账号

## 宝塔站点配置

创建站点时保持以下约定：

- 网站名称：`ngpt.chat`
- 域名：`ngpt.chat`
- 站点路径：`/www/dk_project/my_NextChat`
- 反向代理目标：`http://127.0.0.1:3000`
- 需要开启 WebSocket 支持

Nginx 核心反代配置示例：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## 标准更新流程

```bash
cd /www/dk_project/my_NextChat
git pull
export BUILDX_CONFIG=/tmp/nextchat-docker-buildx
mkdir -p "$BUILDX_CONFIG"
docker compose -f docker-compose.baota.yml --env-file .env.baota build nextchat
docker compose -f docker-compose.baota.yml --env-file .env.baota up -d nextchat
docker inspect nextchat --format '{{.State.Health.Status}}'
curl http://127.0.0.1:3000/api/db/health
```

## 常见问题

### 页面能打开，但数据不对

优先检查：

1. `docker inspect nextchat` 里的 `PGHOST/PGDATABASE/PGUSER`
2. `/api/db/health` 返回的 `configuredHost/database/user`
3. 宝塔 Nginx 是否仍然反代到当前这台 `nextchat` 容器

### 删除了用户，页面里还有管理员

当前代码会在管理用户为空时自动补默认管理员。这个行为来自服务端认证初始化，不是前端缓存。

默认管理员为：

- 用户名：`admin`
- 密码：`admin123`

如果你把数据库里的管理用户全部删空，重新进入登录页或重新触发认证初始化后，系统会自动补回这个默认管理员。

### API 配置和聊天数据归属到哪个用户

默认共享存储用户是 `single-user`。以下共享或同步数据通常会挂在这条记录下：

- `app_settings`
- `provider_configs`
- `provider_api_keys`
- `conversations`
- `messages`

不要直接删除 `single-user`。如果需要只保留 `admin` 一个用户，必须先把这些数据迁移到 `admin`，再删除旧记录，否则会因为外键级联一起删除关联数据。

### 构建失败

优先检查：

1. 是否使用了 `BUILDX_CONFIG=/tmp/nextchat-docker-buildx`
2. Docker 构建上下文是否完整
3. `.env.baota` 是否缺失必填变量

## 不再推荐的旧做法

以下做法已经不再作为默认方案：

- 在 `docker-compose.baota.yml` 内启动本地 PostgreSQL
- 通过 `docker-compose.postgres.yml` 单独维护一套宝塔本地数据库
- 让 `docker-compose.baota.yml` 和 `docker-compose.yml` 混用到不同数据库

## 本地开发

如果您想在本地开发环境使用 Docker + PostgreSQL，请参考 [本地开发部署指南](docs/local-dev-guide.md)。

本地开发环境特点：

- 使用 `docker-compose.yml`（不是 `docker-compose.baota.yml`）
- 使用 `--profile dev` 启动热加载开发服务器
- 使用 `--profile local-db` 启动内置 PostgreSQL 数据库
- 代码修改自动同步到容器，无需重新构建

快速启动：

```bash
# 启动本地开发环境（包含数据库）
docker-compose --profile local-db --profile dev up -d

# 访问
open http://localhost:3000
```
