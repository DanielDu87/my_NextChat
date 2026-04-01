# NextChat 宝塔面板 Docker 部署完整指南

> 基于实际部署经验编写，适用于宝塔面板 9.3+ Docker 管理环境。

## 架构概览

```
浏览器 → Nginx(SSL/443) → 127.0.0.1:3000 → nextchat 容器
                                            ↓
                                      postgres 容器(5432)
```

所有服务运行在 Docker 中，通过 Docker Compose 编排，数据库不暴露到宿主机。

当前推荐命名：

- 项目目录：`/www/dk_project/my_NextChat`
- Compose 项目名：`my_nextchat`
- 宝塔网站名称：`ngpt.chat`
- 站点域名：`ngpt.chat`
- 站点路径：`/www/dk_project/my_NextChat`
- Sub2API 宝塔网站名称：`sub2api.ngpt.chat`
- Sub2API 域名：`sub2api.ngpt.chat`

注意：

- 上图只适用于“当前项目自己管理 PostgreSQL 容器”的场景。
- 如果你要复用已有外部 PostgreSQL，不要照搬这里的 `docker-compose.baota.yml` 方案。
- 复用外部库时应使用 [docker-compose.yml](/Users/dyx/Code/NextChat/docker-compose.yml) 配合 [`.env.docker`](/Users/dyx/Code/NextChat/.env.docker) 和 `--profile no-proxy`。
- 否则应用会被固定连到内部 `postgres` 容器，页面看到的是一套新的空库。
- `Sub2API` 如果不需要代理，务必把 `AUTH_DIR_SYNC_PROXY_ENABLED=false`，并清空 `AUTH_DIR_SYNC_PROXY_HOST`、`AUTH_DIR_SYNC_PROXY_PORT`。
- 否则容器重建后会继续带上旧的 `172.17.0.1:7890` 代理，聊天请求会在上游转发阶段超时。

---

## 涉及的文件和数据库

### 配置文件

| 文件 | 路径 | 说明 |
|------|------|------|
| docker-compose.baota.yml | 项目根目录 | Compose 编排文件，定义 nextchat + postgres 两个服务 |
| .env.baota | 项目根目录 | 环境变量配置 |
| Dockerfile | 项目根目录 | 镜像构建文件（多阶段构建） |
| Nginx 站点配置 | `/www/server/panel/vhost/nginx/{域名}.conf` | 反向代理配置 |
| Docker 站点 JSON | `/www/dk_project/sites/{域名}/{域名}.json` | 宝塔 Docker 网站管理读取的配置 |

### 宝塔数据库（SQLite）

**实际使用的数据库路径：`/www/server/panel/data/db/docker.db`**

> 注意：`/www/server/panel/data/docker.db` 是旧路径副本，面板不读取它。修改数据库时务必操作 `/www/server/panel/data/db/docker.db`。

| 表名 | 作用 | 关键字段 |
|------|------|---------|
| docker_sites | Docker 网站列表（Docker 管理页面读取） | name, type, status, service_info, container_id |
| docker_domain | Docker 网站域名绑定 | pid, name, port |
| dk_sites | Docker 网站扩展信息（普通站点页面读取） | name, container_id, container_name, container_port |
| dk_domain | Docker 网站域名扩展 | pid, name |
| dk_container_remark | 容器备注（Docker 容器列表显示） | container_id, container_name, remark |
| stacks | Compose 项目列表 | name, status, path, remark |
| templates | 快速部署项目模板 | path, name, remark |

### Docker 数据卷

| 卷名 | 宿主机路径 | 用途 |
|------|-----------|------|
| my_nextchat_nextchat-data | Docker 管理 | NextChat 持久化数据 |
| my_nextchat_nextchat-postgres-data | Docker 管理 | PostgreSQL 数据库文件 |

---

## 部署步骤

### 1. 配置环境变量

编辑 `.env.baota`，修改以下必填项：

```bash
# 访问密码（必改）
CODE=your-access-password

# 数据库密码（建议修改）
PGPASSWORD=nextchat_password
```

**数据库连接说明：** PGHOST 必须是 `postgres`（Docker Compose 服务名），不能是 `127.0.0.1`，因为容器内无法通过 127.0.0.1 访问宿主机。

如果你复用的是外部 PostgreSQL，这一节不适用，应改用：

```bash
docker compose -f docker-compose.yml --env-file .env.docker --profile no-proxy build
docker compose -f docker-compose.yml --env-file .env.docker --profile no-proxy up -d
```

### 2. 构建并启动容器

```bash
cd /www/dk_project/my_NextChat

# 构建镜像（首次约 5-10 分钟）
docker compose -f docker-compose.baota.yml --env-file .env.baota build

# 启动所有服务（postgres 会先启动，健康检查通过后再启动 nextchat）
docker compose -f docker-compose.baota.yml --env-file .env.baota up -d
```

### 3. 配置 Nginx 反向代理

创建站点配置文件 `/www/server/panel/vhost/nginx/{域名}.conf`：

```nginx
server {
    listen 80;
    listen 443 ssl;
    http2 on;

    server_name your-domain.com;
    root /www/dk_project/my_NextChat;

    # SSL 证书配置
    ssl_certificate    /www/server/panel/vhost/cert/your-domain.com/fullchain.pem;
    ssl_certificate_key    /www/server/panel/vhost/cert/your-domain.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers EECDH+CHACHA20:EECDH+CHACHA20-draft:EECDH+AES128:RSA+AES128:EECDH+AES256:RSA+AES256:EECDH+3DES:RSA+3DES:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    add_header Strict-Transport-Security "max-age=31536000";

    # HTTP 自动跳转 HTTPS
    if ($server_port != 443) {
        set $isRedcert 2;
    }
    if ( $uri ~ /\.well-known/ ) {
        set $isRedcert 1;
    }
    if ($isRedcert = 2) {
        rewrite ^(/.*)$ https://$host$1 permanent;
    }

    # 反向代理到 NextChat 容器
    location ^~ / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Real-Port $remote_port;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
        proxy_set_header REMOTE-HOST $remote_addr;

        proxy_buffering off;
        proxy_connect_timeout 60s;
        proxy_send_timeout 600s;
        proxy_read_timeout 600s;

        # WebSocket 支持（AI 对话必需）
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }

    # SSL 证书验证目录
    location /.well-known {
        allow all;
    }

    access_log /www/wwwlogs/your-domain.com.log;
    error_log /www/wwwlogs/your-domain.com.error.log;
}
```

重载 Nginx（使用宝塔的 nginx，不是系统的）：

```bash
/www/server/nginx/sbin/nginx -t && /www/server/nginx/sbin/nginx -s reload
```

### 4. 注册到宝塔 Docker 管理界面

需要修改 `/www/server/panel/data/db/docker.db`（注意路径是 `db/docker.db`）。

```bash
DB="/www/server/panel/data/db/docker.db"
```

#### 4.1 注册 Docker 网站

```bash
sqlite3 "$DB" "INSERT INTO docker_sites (name, path, run_path, status, remark, addtime, type, service_info, container_id, classify) VALUES (
  'ngpt.chat',
  '/www/dk_project/my_NextChat',
  '/',
  1,
  'nextchat',
  '$(date +%Y-%m-%d\ %H:%M:%S)',
  'proxy',
  '{\"image\": \"my_nextchat-nextchat:latest\", \"compose_project\": \"my_nextchat\", \"port\": \"3000\"}',
  'nextchat',
  0
);"
```

#### 4.2 注册域名

```bash
sqlite3 "$DB" "INSERT INTO docker_domain (pid, name, port, addtime) VALUES (
  (SELECT id FROM docker_sites WHERE name='ngpt.chat'),
  'your-domain.com',
  443,
  '$(date +%Y-%m-%d\ %H:%M:%S)'
);"
```

#### 4.3 注册 Compose 项目

```bash
sqlite3 "$DB" "INSERT INTO stacks (name, status, path, template_id, time, remark) VALUES (
  'my_nextchat',
  'running',
  '/www/dk_project/my_NextChat',
  0,
  $(date +%s),
  'NextChat AI 聊天应用'
);"
```

#### 4.4 创建站点 JSON 配置

```bash
mkdir -p /www/dk_project/sites/your-domain.com
mkdir -p /www/dk_project/my_NextChat
```

创建 `/www/dk_project/sites/your-domain.com/your-domain.com.json`，参考 `/www/dk_project/sites/sub2api.ngpt.chat/sub2api.ngpt.chat.json` 的格式，关键字段：

```json
{
  "site_name": "your-domain.com",
  "domain_list": ["your-domain.com"],
  "primary_port": "443",
  "site_port": ["80", "443"],
  "site_path": "/www/dk_project/my_NextChat",
  "stop_site": false,
  "proxy_info": [
    {
      "proxy_type": "http",
      "proxy_path": "/",
      "proxy_pass": "http://127.0.0.1:3000",
      "proxy_host": "$http_host",
      "websocket": { "websocket_status": true, "websocket_conf": "proxy_http_version 1.1;\nproxy_set_header Upgrade $http_upgrade;\nproxy_set_header Connection $connection_upgrade;" },
      "timeout": { "proxy_connect_timeout": "60", "proxy_send_timeout": "600", "proxy_read_timeout": "600" },
      "proxy_buffering": true
    }
  ],
  "type": "proxy",
  "classify": 0
}
```

#### 4.5 添加容器备注

```bash
CONTAINER_ID=$(docker inspect --format '{{.Id}}' nextchat)
sqlite3 "$DB" "INSERT INTO dk_container_remark (container_id, container_name, remark, addtime) VALUES (
  '$CONTAINER_ID',
  'nextchat',
  'NextChat AI聊天应用',
  '$(date +%Y-%m-%d)'
);"
```

#### 4.6 确保同步标记文件存在

```bash
touch /www/dk_project/sites/synced_docker_sites.pl
```

### 5. 验证部署

```bash
# 检查容器状态（都应该是 healthy）
docker ps --filter "name=nextchat" --format 'table {{.Names}}\t{{.Status}}'

# 检查本地访问
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3000/api/config

# 检查域名访问
curl -sk -o /dev/null -w "%{http_code}" https://your-domain.com/api/config

# 检查数据库连接
docker exec nextchat-postgres pg_isready -U nextchat_user -d nextchat
```

补充检查：

```bash
# 检查 HTTP 是否已经跳到 HTTPS
curl -I http://ngpt.chat/

# 检查公网证书
echo | openssl s_client -connect ngpt.chat:443 -servername ngpt.chat 2>/dev/null | openssl x509 -noout -subject -issuer -dates
```

---

## 重要注意事项

### 1. 不要使用 `bt restart`

`bt restart` 会重启宝塔面板进程，面板会检查 `sites` 表中的站点记录，如果站点不在该表中，面板会删除对应的 Nginx 配置文件和 SSL 证书。

如果需要重载面板，使用：
```bash
bt reload    # 只重载面板逻辑，不影响 Nginx 和文件
```

### 2. 宝塔有两套 Nginx

| 路径 | 说明 |
|------|------|
| `/www/server/nginx/sbin/nginx` | 宝塔 Nginx（面板实际使用） |
| `/usr/sbin/nginx` | 系统 Nginx（不要用） |

重载 Nginx 时必须用宝塔的：
```bash
/www/server/nginx/sbin/nginx -t && /www/server/nginx/sbin/nginx -s reload
```

### 3. 数据库文件路径

| 路径 | 说明 |
|------|------|
| `/www/server/panel/data/db/docker.db` | **实际使用的** Docker 数据库 |
| `/www/server/panel/data/docker.db` | 旧路径副本（面板不读取） |

### 4. Docker 网站健康检查失败

如果 Docker 管理页面中站点显示不健康，检查：
- `/www/dk_project/sites/{域名}/{域名}.json` 文件是否存在且格式正确
- Nginx 配置文件 `/www/server/panel/vhost/nginx/{域名}.conf` 是否存在
- SSL 证书文件 `/www/server/panel/vhost/cert/{域名}/` 目录是否存在
- `dk_sites.name`、`docker_sites.name` 是否与真实域名一致，例如 `ngpt.chat`
- 域名绑定、站点 JSON 文件名、Nginx 配置文件名、证书目录是否仍使用同一个真实域名，例如 `ngpt.chat`
- 不要把 `docker_sites.name`、`dk_sites.name` 改成 `nextchat` 这种项目名，否则宝塔 Docker 面板会误判 SSL 未配置
- 项目名请写在 `docker_sites.remark`、`dk_sites.ps`，例如 `nextchat`
- `docker_sites.path` 是否仍残留旧 IP 路径或旧 `wwwroot` 路径，例如 `/www/dk_project/wwwroot/43.163.5.9`

推荐检查命令：

```bash
sqlite3 /www/server/panel/data/db/docker.db "select id,name,path from dk_sites;"
sqlite3 /www/server/panel/data/db/docker.db "select id,name,path from docker_sites;"
cat /www/dk_project/sites/ngpt.chat/ngpt.chat.json
cat /www/server/panel/vhost/nginx/ngpt.chat.conf
```

如果宝塔申请 SSL 时提示：

```text
读取配置文件失败，请删除网站重新添加！
```

通常不是必须重建网站，而是以上 4 处元数据没有对齐。

---

## 日常维护

### 更新代码并重新构建

```bash
cd /www/dk_project/my_NextChat
git pull
docker compose -f docker-compose.baota.yml --env-file .env.baota build
docker compose -f docker-compose.baota.yml --env-file .env.baota up -d
```

### 修改配置

1. 编辑 `.env.baota`
2. 重启容器：`docker compose -f docker-compose.baota.yml --env-file .env.baota up -d`

### 查看日志

```bash
docker logs nextchat --tail 100 -f
docker logs nextchat-postgres --tail 50
```

### 备份数据库

```bash
# 从 postgres 容器导出
docker exec nextchat-postgres pg_dump -U nextchat_user nextchat > backup_$(date +%Y%m%d).sql
```

### 恢复数据库

```bash
docker exec -i nextchat-postgres psql -U nextchat_user nextchat < backup_20260330.sql
```

---

## 故障排查

### 网站显示"没有找到站点"

1. 检查 Nginx 配置文件是否被删除：`ls /www/server/panel/vhost/nginx/{域名}.conf`
2. 检查 SSL 证书目录是否存在：`ls /www/server/panel/vhost/cert/{域名}/`
3. 检查 Nginx 是否加载了该配置：`/www/server/nginx/sbin/nginx -T 2>&1 | grep server_name`
4. 如果文件被删，重新创建配置文件并重载 Nginx

### 宝塔 SSL 提示“读取配置文件失败”

1. 检查 `dk_sites` 与 `docker_sites` 是否仍残留旧站点名或旧站点路径
2. 检查 `/www/dk_project/sites/{域名}/{域名}.json` 中的 `site_name` 是否与域名一致
3. 检查 `/www/server/panel/vhost/nginx/{域名}.conf` 是否与站点名一致
4. 修正后执行：

```bash
nginx -t
nginx -s reload
```

5. 再回宝塔面板重新申请证书

### HTTPS 已启用但浏览器仍提示不安全

1. 确认访问地址是不是 `https://ngpt.chat`
2. 不要再使用服务器 IP 访问
3. 检查 HTTP 是否已经 301 到 HTTPS
4. 检查证书主题是否是 `CN=ngpt.chat`
5. 强制刷新浏览器或使用无痕窗口重新访问

如果服务端证书和跳转都正常，这类“不安全”通常是旧 HTTP/IP 缓存页面，不是证书本身无效。

### 容器启动失败

```bash
# 查看 nextchat 日志
docker logs nextchat

# 查看 postgres 日志
docker logs nextchat-postgres

# 常见原因：
# - 数据库密码不匹配（.env.baota 中的 PGPASSWORD 必须与 compose 中一致）
# - 端口 3000 被占用
# - 构建失败（网络问题导致依赖下载失败）
```

### 数据库连接失败

```bash
# 在 nextchat 容器内测试连接 postgres
docker exec nextchat wget -q -O /dev/null http://postgres:5432

# 检查 postgres 是否健康
docker inspect nextchat-postgres --format '{{.State.Health.Status}}'
```

### 健康检查 unhealthy

docker-compose 中的健康检查使用 `wget`，`localhost` 在 Alpine 容器中可能解析到 IPv6 导致失败。确保使用 `127.0.0.1` 而非 `localhost`：

```yaml
healthcheck:
  test: ["CMD", "sh", "-c", "wget -q -O /dev/null http://127.0.0.1:3000/api/config || exit 1"]
```
