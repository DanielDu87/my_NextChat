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
- Sub2API 项目目录：`/www/dk_project/my_sub2api`
- Sub2API 宝塔网站名称：`sub2api.ngpt.chat`
- Sub2API 域名：`sub2api.ngpt.chat`

注意：

- 上图只适用于“当前项目自己管理 PostgreSQL 容器”的场景。
- 如果你要复用已有外部 PostgreSQL，不要照搬这里的 `docker-compose.baota.yml` 方案。
- 复用外部库时应使用 [docker-compose.yml](/Users/dyx/Code/NextChat/docker-compose.yml) 配合 [`.env.docker`](/Users/dyx/Code/NextChat/.env.docker) 和 `--profile no-proxy`。
- 否则应用会被固定连到内部 `postgres` 容器，页面看到的是一套新的空库。
- `Sub2API` 如果不需要代理，务必把 `AUTH_DIR_SYNC_PROXY_ENABLED=false`，并清空 `AUTH_DIR_SYNC_PROXY_HOST`、`AUTH_DIR_SYNC_PROXY_PORT`。
- 否则容器重建后会继续带上旧的 `172.17.0.1:7890` 代理，聊天请求会在上游转发阶段超时。

额外约定：

- `Sub2API` 服务器最终项目目录使用 `/www/dk_project/my_sub2api`
- 旧目录 `/www/dk_project/sub2api_runtime` 已废弃，不再作为部署目录使用
- 提交后，优先使用 Git 同步服务器代码
- 如果服务器无法直接访问远端仓库，可临时使用 `git bundle` 作为 Git 离线同步介质

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
export BUILDX_CONFIG=/tmp/nextchat-docker-buildx
mkdir -p "$BUILDX_CONFIG"
docker compose -f docker-compose.baota.yml --env-file .env.baota build nextchat

# 启动所有服务（postgres 会先启动，健康检查通过后再启动 nextchat）
docker compose -f docker-compose.baota.yml --env-file .env.baota up -d
```

说明：

- `docker-compose.baota.yml` 当前没有 `profile` 配置，不要附带 `--profile no-proxy`。
- 如果你需要直连已有 PostgreSQL，请切换到主部署方式：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy up -d
```

### 2.1 提交后的远端更新

推荐使用 Git 更新服务器代码，不再把普通文件覆盖作为默认更新方式。

```bash
cd /www/dk_project/my_NextChat
git pull
export BUILDX_CONFIG=/tmp/nextchat-docker-buildx
mkdir -p "$BUILDX_CONFIG"
docker compose -f docker-compose.baota.yml --env-file .env.baota build nextchat
docker compose -f docker-compose.baota.yml --env-file .env.baota up -d nextchat
docker inspect nextchat --format '{{.State.Health.Status}}'
```

如果 `git pull` 失败，先检查：

- 服务器仓库远程地址是否为 `git@github.com:DanielDu87/my_NextChat.git`
- 服务器 SSH key 是否可访问远程仓库
- 当前分支是否为 `main`

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

### 在宝塔 “Docker 网站” 页面（`/docker/dockersite`）显示这个站点

宝塔的 **Docker → 网站** 列表只显示 `dk_sites`/`docker_sites` 表里登记过的容器。
NextChat 是直接用 `docker compose` 拉起的容器，默认不会自动出现在该页面。

本仓库提供一次性注册脚本 [`scripts/baota-register-dockersite.py`](../scripts/baota-register-dockersite.py)，
会调用宝塔内部的 `SitesManage.create_site` 把现有 `nextchat` 容器注册为一条
`type=app` 的 Docker 站点（默认域名 `ngpt.chat`，反代 `http://127.0.0.1:3000`）。

```bash
# 在宝塔服务器上、容器已经跑起来之后执行一次
/www/server/panel/pyenv/bin/python3 /www/dk_project/my_NextChat/scripts/baota-register-dockersite.py
```

脚本会：

- 在 `docker_sites` / `docker_domain` 表里写入 `ngpt.chat` 这条记录，并关联到现有 `nextchat` 容器 ID；
- 在 `/www/dk_project/sites/ngpt.chat/ngpt.chat.json` 写入站点元信息；
- 在 `/www/server/panel/vhost/nginx/ngpt.chat.conf` 生成宝塔托管的反代配置；
- 自动 `nginx -s reload`，使宝塔侧与宿主机 Nginx 同步生效。

执行成功后，登录宝塔面板 → 左侧 **Docker → 网站** 即可看到名为 `ngpt.chat` 的网站条目。
注意：脚本不会创建新容器、不会改 `0.0.0.0:3000->3000` 端口映射，也不会动 `.env.baota` /
`.env.docker`；如果以后要换域名或反代地址，编辑脚本顶部的 `DOMAIN` / `PROXY_PASS`
常量后重跑即可。重复执行同名站点会被宝塔的 `docker_sites` 唯一约束拒绝。

#### 按宝塔官方流程重建 Docker 网站

如果 `ngpt.chat` 的 Docker 网站记录损坏、页面打不开，或想严格按宝塔官方
`Docker -> 网站` 的流程重建，不要直接手改 `docker.db`。优先使用宝塔内部的
`SitesManage.delete_site -> create_site -> set_ssl -> set_force_https`。

重建前建议先备份：

```bash
TS=$(date +%Y%m%d-%H%M%S)
BACK=/root/ngpt-dockersite-rebuild-$TS
mkdir -p "$BACK"
cp -a /www/dk_project/sites/ngpt.chat "$BACK/" 2>/dev/null || true
cp -a /www/server/panel/vhost/nginx/ngpt.chat.conf "$BACK/" 2>/dev/null || true
cp -a /www/server/panel/vhost/cert/ngpt.chat "$BACK/" 2>/dev/null || true
```

然后在服务器上使用宝塔自带 Python 执行：

```bash
/www/server/panel/pyenv/bin/python3 - <<'PY'
import os
import sys
import subprocess

PANEL = "/www/server/panel"
sys.path[:0] = [PANEL, os.path.join(PANEL, "class"), os.path.join(PANEL, "mod")]

import public
from mod.project.docker.sites.sitesManage import SitesManage

sm = SitesManage()

# 1) 删除旧的 Docker 网站记录；remove_path=0 不删除站点目录
g = public.dict_obj()
g.id = 12  # 实际执行前先查 docker_sites 中 ngpt.chat 当前 id
g.site_name = "ngpt.chat"
g.remove_path = 0
g.reload = 1
print(sm.delete_site(g))

# 2) 重新创建 Docker 网站
cid = subprocess.check_output(
    ["docker", "inspect", "nextchat", "--format", "{{.Id}}"],
    text=True,
).strip()

g = public.dict_obj()
g.domains = "ngpt.chat"
g.remark = "NextChat (docker)"
g.type = "app"
g.name = "nextchat"
g.port = "3000"
g.proxy_pass = "http://127.0.0.1:3000"
g.proxy_host = "$http_host"
g.container_id = cid
print(sm.create_site(g))

# 3) 如果证书文件已存在，重新挂回 SSL
with open("/www/server/panel/vhost/cert/ngpt.chat/privkey.pem") as f:
    key = f.read()
with open("/www/server/panel/vhost/cert/ngpt.chat/fullchain.pem") as f:
    csr = f.read()

g = public.dict_obj()
g.siteName = "ngpt.chat"
g.site_name = "ngpt.chat"
g.key = key
g.csr = csr
print(sm.set_ssl(g))

# 4) 恢复强制 HTTPS
g = public.dict_obj()
g.siteName = "ngpt.chat"
g.site_name = "ngpt.chat"
g["force_https/d"] = 1
g.force_https = 1
print(sm.set_force_https(g))
PY
```

执行完后检查：

```bash
nginx -t
/etc/init.d/nginx reload
curl -I http://ngpt.chat
curl -k -I https://ngpt.chat
```

实际验证结果：

- `delete_site` 会删除 Docker 网站记录、JSON 配置和宝塔托管的 nginx vhost；
- `delete_site` 默认不会删除 `/www/server/panel/vhost/cert/ngpt.chat/` 下的证书文件；
- `create_site` 重建后，新的站点 ID 会变化，这是正常现象；
- 如果只执行 `set_ssl`，`ngpt.chat.json` 的 `ssl_status` 会恢复为 `true`；
- 若要让面板状态与 Nginx 跳转规则一致，还要再补一次 `set_force_https`。

### 关于宝塔的 SSL 证书管理

当前仓库与部署脚本**默认不处理 `ngpt.chat` 的证书申请、部署、续签**，证书由用户在宝塔面板中自行申请和维护。

- 仓库只保证 Docker 网站、反代、Nginx 配置与应用本身正常；
- `ngpt.chat` 的 HTTPS 是否启用、用哪家 CA、何时续签，都由用户在宝塔 “网站 → SSL” 中自行操作；
- 本仓库不再写入、覆盖、同步 `/www/server/panel/vhost/cert/ngpt.chat/` 下的证书文件；
- 排障目标优先级是：先保证 `nginx -t` / `nginx reload` 正常，再处理证书。

#### 申请方式建议

`ngpt.chat` 在当前腾讯云大陆机环境下，**不建议优先使用文件验证**。

- 文件验证时，CA 访问 `http://ngpt.chat/.well-known/acme-challenge/...` 可能被外部网络改写到
  `https://dnspod.qcloud.com/static/webblock.html?d=ngpt.chat`；
- 这会导致宝塔提示“验证失败，域名解析错误或验证 URL 无法被访问”；
- 因此更稳的做法是：在宝塔中优先使用 **DNS 验证**（例如 DNSPod）。

#### 自动部署的配置锚点

宝塔“证书申请成功后自动部署到站点”依赖站点配置文件中的固定锚点。如果这些锚点被删掉或改坏，
就会出现：

```text
当前证书申请并验证成功，自动部署失败，请尝试手动部署证书！
站点配置文件中未找到标识信息【#error_page 404/404.html;】
```

对 `ngpt.chat` 来说，至少要保留以下结构：

- `listen 443 ssl http2 ;`
- `ssl_certificate / ssl_certificate_key`
- `#SSL-START ... #SSL-END`
- `#error_page 404/404.html;`
- `#HTTP_TO_HTTPS_START ... #HTTP_TO_HTTPS_END`

如果之前为了临时恢复 nginx 去掉过 SSL 配置，那么在宝塔里“自动部署证书”之前，需要先恢复
`/www/server/panel/vhost/nginx/ngpt.chat.conf` 的宝塔标准结构；最稳妥的方式是直接恢复之前备份的
`ngpt.chat.conf.bak-*`，而不是只手工补单行注释。

#### 空证书会拖死整个 nginx

如果 `ngpt.chat` 保留了 443/SSL 引用，但 `/www/server/panel/vhost/cert/ngpt.chat/` 目录下没有有效证书文件，
那么任意站点在宝塔里“保存证书”“重载 Nginx”“保存站点配置”时，都会被 `ngpt.chat` 的空证书一并拖死，
表现为：

```text
nginx: [emerg] cannot load certificate "/www/server/panel/vhost/cert/ngpt.chat/fullchain.pem"
```

处理顺序建议：

1. 先确认 `nginx -t` 可以通过；
2. 如果是空证书导致失败，临时移除 `ngpt.chat` 的 SSL 引用，或恢复有效证书文件；
3. 等 nginx 恢复正常后，再回宝塔给 `ngpt.chat` 申请/部署证书；
4. 自动部署失败时，优先检查站点配置锚点是否还在，不要先怀疑容器或应用。

---

## 重要更新和修复记录（2026-06-09）

### 1. 「未查询到站点【ngpt.chat】」的完整修复

#### 问题原因
在「证书到期提醒」「消息推送」等设置界面，宝塔只查询普通网站表 `site.db.sites`，而 `ngpt.chat` 是 Docker 网站，只存在于 `docker.db.docker_sites/docker_domain` 中，导致找不到站点报错。

#### 修复涉及的所有数据库和目录

| 类型 | 路径 | 说明 |
|-----|------|------|
| 普通站点数据库 | `/www/server/panel/data/db/site.db` | 普通网站列表（sites表和domain表） |
| Docker站点数据库 | `/www/server/panel/data/db/docker.db` | Docker网站列表 |
| SSL证书数据库 | `/www/server/panel/data/db/ssl_data.db` | SSL证书信息 |
| 证书目录 | `/www/server/panel/vhost/cert/ngpt.chat/` | SSL证书文件 |
| 访问日志 | `/www/wwwlogs/ngpt.chat.log` | 网站访问日志 |
| Docker站点配置 | `/www/dk_project/sites/ngpt.chat/ngpt.chat.json` | Docker网站的配置文件 |
| Nginx配置 | `/www/server/panel/vhost/nginx/ngpt.chat.conf` | Nginx反向代理配置 |

#### 完整修复脚本（使用宝塔自带 Python）

```bash
# 1. 先备份数据库
TS=$(date +%Y%m%d-%H%M%S)
mkdir -p /root/baota-fix-backup-$TS
cp -a /www/server/panel/data/db/site.db /root/baota-fix-backup-$TS/
cp -a /www/server/panel/data/db/ssl_data.db /root/baota-fix-backup-$TS/
echo "备份位置: /root/baota-fix-backup-$TS/"

# 2. 执行修复
/www/server/panel/pyenv/bin/python3 - <<'PY'
import sqlite3
import time
import shutil
import json

# 备份 site.db
TS = int(time.time())
BACK_PATH = f"/root/site.db.backup.{TS}.db"
shutil.copy2("/www/server/panel/data/db/site.db", BACK_PATH)
print(f"✅ site.db 已备份到: {BACK_PATH}")

site_db = sqlite3.connect("/www/server/panel/data/db/site.db")
cur = site_db.cursor()
add_time = time.strftime("%Y-%m-%d %H:%M:%S")

# ---------- 步骤 1: 在 site.db 的 sites 表插入兼容记录 ----------
print("正在插入 sites 表记录...")
cur.execute(
    "INSERT INTO sites (name, path, status, \"index\", ps, addtime, type_id, edate, project_type, project_config, rname, stop) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    (
        "ngpt.chat",
        "/www/dk_project/wwwroot/ngpt.chat",
        "1",
        None,
        "NextChat (docker) [compatible]",
        add_time,
        0,
        "0000-00-00",
        "Docker",
        "{}",
        "",
        "",
    ),
)
new_site_id = cur.lastrowid
print(f"✅ 成功插入站点记录，站点ID: {new_site_id}")

# ---------- 步骤 2: 在 site.db 的 domain 表插入域名记录 ----------
print("正在插入 domain 表记录...")
cur.execute(
    "INSERT INTO domain (pid, name, port, addtime) VALUES (?, ?, ?, ?)",
    (new_site_id, "ngpt.chat", 80, add_time),
)
print(f"✅ 成功插入域名记录，ID: {cur.lastrowid}")

site_db.commit()

# ---------- 步骤 3: 在 ssl_data.db 的 ssl_info 表更新 use_for_site ----------
print("正在更新 ssl_info.use_for_site...")
ssl_db = sqlite3.connect("/www/server/panel/data/db/ssl_data.db")
cur = ssl_db.cursor()
cur.execute(
    "SELECT id, use_for_site FROM ssl_info WHERE subject=?", ("ngpt.chat",)
)
row = cur.fetchone()
if row:
    ssl_id, use_for_site_str = row
    print(f"找到 SSL 记录，ID: {ssl_id}")
    use_for_site = json.loads(use_for_site_str) if use_for_site_str else []
    if str(new_site_id) not in use_for_site:
        use_for_site.append(str(new_site_id))
        cur.execute(
            "UPDATE ssl_info SET use_for_site=? WHERE id=?",
            (json.dumps(use_for_site), ssl_id),
        )
        print(f"✅ 成功更新 ssl_info.use_for_site 为: {use_for_site}")
    else:
        print(f"⚠️  ssl_info.use_for_site 已经包含 {new_site_id}，无需更新")
ssl_db.commit()

# 关闭数据库
site_db.close()
ssl_db.close()

print("\n🎉 所有修复完成！")
PY

# 验证
echo -e "\n正在验证修复结果..."
/www/server/panel/pyenv/bin/python3 - <<'PY'
import sqlite3

site_db = sqlite3.connect("/www/server/panel/data/db/site.db")
cur = site_db.cursor()
print("\n--- site.db.sites 表内容 ---")
cur.execute("SELECT id, name, ps, addtime FROM sites WHERE name='ngpt.chat';")
print(cur.fetchall())

print("\n--- site.db.domain 表内容 ---")
cur.execute("SELECT id, pid, name FROM domain WHERE name='ngpt.chat';")
print(cur.fetchall())

ssl_db = sqlite3.connect("/www/server/panel/data/db/ssl_data.db")
cur = ssl_db.cursor()
print("\n--- ssl_data.db.ssl_info 表内容 ---")
cur.execute("SELECT id, subject, use_for_site FROM ssl_info WHERE subject='ngpt.chat';")
print(cur.fetchall())

site_db.close()
ssl_db.close()
PY
```

#### 验证结果
修复完成后，你应该可以：
1. 在宝塔「证书到期提醒」设置中找到 `ngpt.chat`
2. 在浏览器正常访问 `https://ngpt.chat`
3. 查看宝塔 Nginx 状态和日志：
```bash
nginx -t
tail -f /www/wwwlogs/ngpt.chat.log
```

---

### 2. 访问日志分析说明

#### 访问日志路径
`/www/wwwlogs/ngpt.chat.log`

#### 正常访问特征（从 117.136.73.115 的成功访问记录）
```
117.136.73.115 - - [09/Jun/2026:12:29:59 +0800] "GET / HTTP/2.0" 200 5073 "-" "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36"
```
- **200状态码**：正常响应
- **HTTP/2.0协议**：HTTPS协议版本正常
- **静态资源也正常加载**：CSS、JS、图标等都能正常返回

---

### 3. 访问 ngpt.chat 时的本地代理设置说明

#### 问题现象
- `http://42.193.15.117:3000/` 直连可以
- `https://ngpt.chat/` 出现 **Connection reset by peer**

#### 原因
请求被本地代理拦截或处理失败，导致连接在TLS握手阶段被重置。

#### 解决方法

##### 方案 A：在代理软件中添加直连规则（推荐）
- **类型**：`IP-CIDR`（或 `DOMAIN-SUFFIX`，如果有）
- **值 1**：`42.193.15.117/32`
- **值 2**：`ngpt.chat`（如果是域名规则类型）
- **策略**：`DIRECT`（直连）

##### 方案 B：临时关闭所有代理
直接关闭代理软件，只用本地网络访问 `https://ngpt.chat`

##### 方案 C：使用浏览器无痕模式
- Chrome/Edge：`Ctrl+Shift+N` 或 `Cmd+Shift+N`
- Safari：`Cmd+Shift+N`

---

### 4. 「域名打不开，但 IP 地址正常」的最新结论

#### 现象拆分

这类问题至少要拆成两层：

1. **应用上游是否在线**：`127.0.0.1:3000` 是否真的有 NextChat 在监听
2. **域名链路是否正常**：公网到 `ngpt.chat:443` 的 TLS/SNI 是否被外部链路 reset

不能只因为“IP 地址能打开”就判断应用完全正常。

#### 本次实际排查结果

先在服务器本机检查：

```bash
ss -ltnp | egrep ':80 |:443 |:3000 '
curl -k -I -H "Host: ngpt.chat" https://127.0.0.1/
curl -I http://127.0.0.1:3000/
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
```

本次实际发现：

- `nginx` 一直在监听 `80/443`
- 故障时 `127.0.0.1:3000` 返回 `connection refused`
- 同时 `docker ps -a` / `docker compose ... ps` 看不到 `nextchat` 生产容器
- 这时域名请求不是“纯公网波动”，而是 nginx 反代的上游进程本身没在跑

#### 修复动作

按当前仓库约定，直接在服务器 `sss` 上执行标准生产脚本：

```bash
ssh sss 'cd /www/dk_project/my_NextChat && ./scripts/deploy-production-no-proxy.sh'
```

如果担心 SSH 中断，放到 `tmux`：

```bash
ssh sss 'tmux new-session -d -s nextchat-deploy "cd /www/dk_project/my_NextChat && ./scripts/deploy-production-no-proxy.sh 2>&1"'
ssh sss 'tmux capture-pane -t nextchat-deploy -p -S -80'
```

修复后验证：

```bash
ssh sss 'cd /www/dk_project/my_NextChat && ./scripts/docker-compose-safe.sh --env-file .env.docker --profile no-proxy ps'
ssh sss 'docker exec nextchat wget -S -O - http://127.0.0.1:3000 2>&1 | head -5'
ssh sss 'curl -k -I -H "Host: ngpt.chat" https://127.0.0.1/'
```

期望结果：

- `nextchat` 为 `healthy`
- 容器内 `127.0.0.1:3000` 返回 `HTTP/1.1 200 OK`
- 服务器本机带 `Host: ngpt.chat` 访问 `https://127.0.0.1/` 返回 `HTTP/2 200`

#### 如何判断剩余问题是不是公网链路/SNI

当服务器本机已经全部正常后，再从外部网络执行：

```bash
env -u https_proxy -u http_proxy -u HTTPS_PROXY -u HTTP_PROXY -u all_proxy -u ALL_PROXY \
  curl -4 -k -I https://42.193.15.117/

env -u https_proxy -u http_proxy -u HTTPS_PROXY -u HTTP_PROXY -u all_proxy -u ALL_PROXY \
  curl -4 -k -I https://42.193.15.117/ -H 'Host: ngpt.chat'

env -u https_proxy -u http_proxy -u HTTPS_PROXY -u HTTP_PROXY -u all_proxy -u ALL_PROXY \
  openssl s_client -connect 42.193.15.117:443 -brief

env -u https_proxy -u http_proxy -u HTTPS_PROXY -u HTTP_PROXY -u all_proxy -u ALL_PROXY \
  openssl s_client -connect 42.193.15.117:443 -servername ngpt.chat -brief
```

本次排查得到的关键证据：

- 直接访问 `https://42.193.15.117/` 可以正常握手并返回默认站点
- 访问 `https://42.193.15.117/` 且带 `Host: ngpt.chat` 也能正常返回 `NextChat`
- 但从当前外部网络使用 `openssl s_client -servername ngpt.chat` 时，TLS 握手会被 `write:errno=54` 重置
- 服务器本机对 `127.0.0.1:443` + `-servername ngpt.chat` 的 `openssl s_client` 又是完全正常的

这说明：

- `ngpt.chat` 的 nginx vhost 和证书本身没有坏
- reset 发生在服务器外部链路，而不是 NextChat 进程内部
- 如果用户侧还在“域名不稳定、IP 正常”，优先继续排查公网路径、运营商网络、云侧 443/SNI 干扰，而不是继续改前端业务代码

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

5. 如果只是想先恢复宝塔与 nginx 的正常操作，优先移除该站点的 443/SSL 引用，确认 `nginx -t` 通过后再处理证书

### 宝塔提示“申请成功，但自动部署失败”

常见报错：

```text
当前证书申请并验证成功，自动部署失败，请尝试手动部署证书！
站点配置文件中未找到标识信息【#error_page 404/404.html;】
```

处理方法：

1. 打开 `/www/server/panel/vhost/nginx/{域名}.conf`
2. 检查是否还保留宝塔原始的 SSL 配置骨架
3. 如果之前为了应急删过 SSL 段，优先恢复 `.bak` 备份配置
4. 执行：

```bash
nginx -t
/etc/init.d/nginx reload
```

5. 再回宝塔重新点击部署证书

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

### 宝塔提示「未查询到站点【ngpt.chat】」

常见场景：在「证书到期提醒」「消息推送」等设置界面，只查普通网站表 `site.db.sites`，而 `ngpt.chat` 是 Docker 网站，只在 `docker.db` 中。

**修复方案**：在 `site.db` 中加一条兼容记录，不破坏 Docker 网站功能。

```python
import sqlite3
import time
import shutil

TS = int(time.time())
BACK_PATH = f"/root/site.db.backup.{TS}.db"
shutil.copy2("/www/server/panel/data/db/site.db", BACK_PATH)
print(f"Backup site.db to {BACK_PATH}")

site_db = sqlite3.connect("/www/server/panel/data/db/site.db")
cur = site_db.cursor()
add_time = time.strftime("%Y-%m-%d %H:%M:%S")

# 插入兼容记录到 sites
cur.execute(
    "INSERT INTO sites (name, path, status, \"index\", ps, addtime, type_id, edate, project_type, project_config, rname, stop) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    (
        "ngpt.chat",
        "/www/dk_project/wwwroot/ngpt.chat",
        "1",
        None,
        "NextChat (docker) [compatible]",
        add_time,
        0,
        "0000-00-00",
        "Docker",
        "{}",
        "",
        "",
    ),
)
new_site_id = cur.lastrowid
print(f"Inserted into sites with id {new_site_id}")

# 插入域名记录到 domain
cur.execute(
    "INSERT INTO domain (pid, name, port, addtime) VALUES (?, ?, ?, ?)",
    (new_site_id, "ngpt.chat", 80, add_time),
)
print(f"Inserted into domain with id {cur.lastrowid}")

site_db.commit()
ssl_db = sqlite3.connect("/www/server/panel/data/db/ssl_data.db")
ssl_db = sqlite3.connect("/www/server/panel/data/db/ssl_data.db")
cur = ssl_db.cursor()
import json
cur.execute(
    "SELECT id, use_for_site FROM ssl_info WHERE subject=?", ("ngpt.chat",)
)
row = cur.fetchone()
if row:
    ssl_id, use_for_site_str = row
    use_for_site = json.loads(use_for_site_str)
    if str(new_site_id) not in use_for_site:
        use_for_site.append(str(new_site_id))
        cur.execute(
            "UPDATE ssl_info SET use_for_site=? WHERE id=?", (json.dumps(use_for_site), ssl_id)
        )
ssl_db.commit()
ssl_db.close()
print("Done.")
```

**验证点**：
- `SELECT id, name FROM sites WHERE name='ngpt.chat'` 能找到
- `SELECT id, subject, use_for_site FROM ssl_info WHERE subject='ngpt.chat'` 的 `use_for_site` 包含新 site id
- 再试「证书到期提醒」界面，应该能正常选择 ngpt.chat
