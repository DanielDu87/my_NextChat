# NextChat 宝塔 DockerSite 部署说明

本文档是 `chat.dyxcloud.com` 当前线上部署的权威说明，给后续 AI 或人工部署时直接执行使用。

## 1. 当前固定环境

| 项 | 当前值 |
|---|---|
| SSH alias | `ss` |
| 服务器公网 IP | `42.193.15.117` |
| 项目目录 | `/www/dk_project/my_NextChat` |
| 域名 | `chat.dyxcloud.com` |
| Docker 容器名 | `nextchat` |
| 容器监听 | `0.0.0.0:3000 -> 3000` |
| 宝塔 DockerSite 站点名 | `chat.dyxcloud.com` |
| 宝塔 Compose 显示名 | `my_nextchat` |
| 宝塔 Compose 实际 project | `03b890c97bdecc48c2294402d8768906`，即 `md5(my_nextchat)` |
| Nginx 反代目标 | `http://127.0.0.1:3000` |
| 数据库 | 远程 PostgreSQL，配置在服务器 `/www/dk_project/my_NextChat/.env.baota` |

当前部署是：

```text
浏览器 -> 宝塔 Nginx 80/443 -> 127.0.0.1:3000 -> Docker 容器 nextchat -> 远程 PostgreSQL
```

不要再把本项目部署成内置 PostgreSQL 容器；不要混用 `/www/dk_project/my_NextChat/.env.docker` 和 `.env.baota`。

## 2. 必须使用的文件

### 仓库内文件

| 文件 | 用途 |
|---|---|
| `/www/dk_project/my_NextChat/docker-compose.baota.yml` | 宝塔专用 Compose 源文件，直连远程 PostgreSQL |
| `/www/dk_project/my_NextChat/.env.baota` | 线上真实环境变量，必须保留现有数据库和 `APP_SECRET` |
| `/www/dk_project/my_NextChat/Dockerfile` | 镜像构建文件 |
| `/www/dk_project/my_NextChat/scripts/baota-register-dockersite.py` | 调用宝塔官方内部接口注册 DockerSite |

### 宝塔面板实际读取的文件

| 文件/目录 | 用途 |
|---|---|
| `/www/server/panel/data/compose/my_nextchat/docker-compose.yaml` | 宝塔 Compose 页面读取的 Compose 文件 |
| `/www/server/panel/data/compose/my_nextchat/.env` | 宝塔 Compose 页面读取的 env 文件 |
| `/www/server/panel/data/db/docker.db` | 宝塔 Docker / DockerSite 数据库，面板真正读取这里 |
| `/www/server/panel/data/db/site.db` | 宝塔普通网站数据库；残留同域名记录会阻止 DockerSite 创建 |
| `/www/dk_project/sites/chat.dyxcloud.com/chat.dyxcloud.com.json` | 宝塔 DockerSite 站点 JSON |
| `/www/server/panel/vhost/nginx/chat.dyxcloud.com.conf` | 宝塔 Nginx vhost |
| `/www/server/panel/vhost/cert/chat.dyxcloud.com/fullchain.pem` | `chat.dyxcloud.com` 证书链 |
| `/www/server/panel/vhost/cert/chat.dyxcloud.com/privkey.pem` | `chat.dyxcloud.com` 私钥 |
| `/www/wwwlogs/chat.dyxcloud.com.log` | 访问日志 |
| `/www/wwwlogs/chat.dyxcloud.com.error.log` | 错误日志 |

注意：`/www/server/panel/data/docker.db` 是旧空文件或旧副本，不是当前 DockerSite 数据源，不要改它。

## 3. 标准重部署流程

所有长时间部署必须放入 `tmux`，避免 SSH 断开导致构建中断。

```bash
ssh ss 'tmux new-session -d -s nextchat-baota-deploy "cd /www/dk_project/my_NextChat && bash -lc '\''
set -euo pipefail
git pull --ff-only
export BUILDX_CONFIG=/tmp/nextchat-docker-buildx
mkdir -p "$BUILDX_CONFIG"
docker compose -f docker-compose.baota.yml --env-file .env.baota build nextchat
docker compose -f docker-compose.baota.yml --env-file .env.baota up -d nextchat
'\'' 2>&1 | tee /tmp/nextchat-baota-deploy.log"'
```

查看进度：

```bash
ssh ss 'tmux capture-pane -t nextchat-baota-deploy -p -S -120'
ssh ss 'tail -120 /tmp/nextchat-baota-deploy.log'
```

如果只是按宝塔面板规范重启当前镜像，不需要重新构建：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
COMPOSE=/www/server/panel/data/compose/my_nextchat/docker-compose.yaml
ENV=/www/server/panel/data/compose/my_nextchat/.env
PROJECT=03b890c97bdecc48c2294402d8768906
/usr/bin/docker-compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV" up -d --no-build
REMOTE
```

## 4. 同步宝塔 Compose 页面

宝塔 Compose 页面不是直接读取项目目录下的 `docker-compose.baota.yml`。需要把配置同步到宝塔目录，并使用绝对路径构建上下文：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
mkdir -p /www/server/panel/data/compose/my_nextchat
cat > /www/server/panel/data/compose/my_nextchat/docker-compose.yaml <<'YAML'
services:
  nextchat:
    build:
      context: /www/dk_project/my_NextChat
      dockerfile: Dockerfile
      args:
        NPM_REGISTRY: ${NPM_REGISTRY:-https://registry.npmjs.org}
        APK_MIRROR: ${APK_MIRROR:-}
    image: nextchat-baota:latest
    container_name: nextchat
    restart: unless-stopped
    env_file:
      - /www/dk_project/my_NextChat/.env.baota
    environment:
      NODE_ENV: production
      HOSTNAME: 0.0.0.0
      PORT: 3000
      DATABASE_URL: ${DATABASE_URL:-}
      NEXTAUTH_URL: ${NEXTAUTH_URL:-https://chat.dyxcloud.com}
      BASE_URL: ${BASE_URL:-https://chat.dyxcloud.com}
    ports:
      - "3000:3000"
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O - http://127.0.0.1:3000/api/db/health >/dev/null 2>&1 || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 5
      start_period: 30s
YAML
cp /www/dk_project/my_NextChat/.env.baota /www/server/panel/data/compose/my_nextchat/.env
REMOTE
```

写入宝塔 `docker.db` 的 `templates/stacks`：

```bash
ssh ss 'python3 - <<'PY'
import sqlite3, time
con=sqlite3.connect('/www/server/panel/data/db/docker.db')
cur=con.cursor()
cur.execute("select id from templates where name=?", ('my_nextchat',))
row=cur.fetchone()
if row:
    tid=row[0]
    cur.execute("update templates set path=?, remark=?, add_in_path=? where id=?", ('/www/server/panel/data/compose/my_nextchat','NextChat',1,tid))
else:
    cur.execute("insert into templates(path,name,remark,add_in_path) values(?,?,?,?)", ('/www/server/panel/data/compose/my_nextchat','my_nextchat','NextChat',1))
    tid=cur.lastrowid
cur.execute("select id from stacks where name=?", ('my_nextchat',))
row=cur.fetchone()
if row:
    cur.execute("update stacks set status=?, path=?, template_id=?, time=?, remark=? where id=?", ('1','/www/server/panel/data/compose/my_nextchat/docker-compose.yaml',tid,int(time.time()),'NextChat',row[0]))
else:
    cur.execute("insert into stacks(name,status,path,template_id,time,remark) values(?,?,?,?,?,?)", ('my_nextchat','1','/www/server/panel/data/compose/my_nextchat/docker-compose.yaml',tid,int(time.time()),'NextChat'))
con.commit(); con.close()
PY'
```

为了让宝塔 Compose 页面显示 `running`，启动时必须使用 `md5(my_nextchat)` 作为 Docker Compose project：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
PROJECT=03b890c97bdecc48c2294402d8768906
COMPOSE=/www/server/panel/data/compose/my_nextchat/docker-compose.yaml
ENV=/www/server/panel/data/compose/my_nextchat/.env
/usr/bin/docker-compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV" up -d --no-build
REMOTE
```

## 5. 注册到宝塔 DockerSite 页面

优先使用仓库脚本调用宝塔官方内部接口，不要手写 Nginx 和 JSON：

```bash
ssh ss 'cd /www/dk_project/my_NextChat && /www/server/panel/pyenv/bin/python3 scripts/baota-register-dockersite.py'
```

如果提示域名已存在，通常是 `site.db` 里有普通站点残留。先备份，再只清理 `chat.dyxcloud.com` 的普通站点残留：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
TS=$(date +%Y%m%d-%H%M%S)
cp /www/server/panel/data/db/site.db /www/server/panel/data/db/site.db.bak-nextchat-$TS
cp /www/server/panel/data/db/docker.db /www/server/panel/data/db/docker.db.bak-nextchat-$TS
python3 - <<'PY'
import sqlite3
con=sqlite3.connect('/www/server/panel/data/db/site.db')
cur=con.cursor()
rows=cur.execute("select id from sites where name=?", ('chat.dyxcloud.com',)).fetchall()
for (sid,) in rows:
    cur.execute('delete from domain where pid=? and name=?', (sid, 'chat.dyxcloud.com'))
    cur.execute('delete from sites where id=? and name=?', (sid, 'chat.dyxcloud.com'))
con.commit(); con.close()
PY
cd /www/dk_project/my_NextChat
/www/server/panel/pyenv/bin/python3 scripts/baota-register-dockersite.py
REMOTE
```

容器重建后必须刷新 DockerSite 记录里的 `container_id`：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
CID=$(docker inspect nextchat --format '{{.Id}}')
python3 - <<PY
import sqlite3
con=sqlite3.connect('/www/server/panel/data/db/docker.db')
cur=con.cursor()
cur.execute('update docker_sites set container_id=? where name=?', ('$CID', 'chat.dyxcloud.com'))
con.commit(); con.close()
PY
REMOTE
```

## 6. SSL 和 Nginx 必须保留的结构

`/www/server/panel/vhost/nginx/chat.dyxcloud.com.conf` 至少要有：

```nginx
server {
    listen 80;
    listen 443 ssl http2;
    server_name chat.dyxcloud.com;

    ssl_certificate    /www/server/panel/vhost/cert/chat.dyxcloud.com/fullchain.pem;
    ssl_certificate_key    /www/server/panel/vhost/cert/chat.dyxcloud.com/privkey.pem;

    location ^~ / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $http_host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
    }
}
```

检查和重载：

```bash
ssh ss 'nginx -t && nginx -s reload'
```

不要删除 `/www/server/panel/vhost/cert/chat.dyxcloud.com/`，除非你准备重新申请证书。证书缺失会导致 Nginx 整体 reload 失败。

## 7. 清理旧容器、旧镜像、旧宝塔记录

只有在确认要重新部署时才执行清理。清理前必须备份宝塔数据库：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
TS=$(date +%Y%m%d-%H%M%S)
cp /www/server/panel/data/db/docker.db /www/server/panel/data/db/docker.db.bak-nextchat-$TS
cp /www/server/panel/data/db/site.db /www/server/panel/data/db/site.db.bak-nextchat-$TS
cp -a /www/dk_project/sites/chat.dyxcloud.com /www/dk_project/sites/chat.dyxcloud.com.bak-nextchat-$TS 2>/dev/null || true
cp -a /www/server/panel/vhost/nginx/chat.dyxcloud.com.conf /www/server/panel/vhost/nginx/chat.dyxcloud.com.conf.bak-nextchat-$TS 2>/dev/null || true
REMOTE
```

停止旧 Compose 项目：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
for P in my_nextchat 03b890c97bdecc48c2294402d8768906; do
  /usr/bin/docker-compose -p "$P" -f /www/server/panel/data/compose/my_nextchat/docker-compose.yaml --env-file /www/server/panel/data/compose/my_nextchat/.env down || true
done
REMOTE
```

如需删除旧镜像，只删除 NextChat 专用镜像，不要清 Docker 全局资源：

```bash
ssh ss 'docker image rm nextchat-baota:latest nextchat:latest 2>/dev/null || true'
```

清理损坏的 DockerSite 记录时，只删除 `chat.dyxcloud.com`：

```bash
ssh ss 'python3 - <<'PY'
import sqlite3
con=sqlite3.connect('/www/server/panel/data/db/docker.db')
cur=con.cursor()
ids=[r[0] for r in cur.execute("select id from docker_sites where name=?", ('chat.dyxcloud.com',)).fetchall()]
for sid in ids:
    cur.execute('delete from docker_domain where pid=?', (sid,))
    cur.execute('delete from docker_sites where id=?', (sid,))
con.commit(); con.close()
PY'
```

## 8. 标准验证命令

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
printf "== Docker ==\n"
docker ps --filter name=nextchat --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}'
printf "\n== Compose ==\n"
/usr/bin/docker-compose ls -a --format json
printf "\n== Health ==\n"
curl -sS -i http://127.0.0.1:3000/api/db/health | head -20
printf "\n== Nginx/域名本机 ==\n"
nginx -t
curl -k -I https://chat.dyxcloud.com/ --max-time 20
printf "\n== DockerSite ==\n"
cd /www/server/panel
/www/server/panel/pyenv/bin/python3 - <<'PY'
import sys, json
sys.path[:0]=['/www/server/panel/class','/www/server/panel']
import public
from mod.project.docker.sites.sitesManage import SitesManage
get=public.to_dict_obj({'type':'all','p':1,'row':20,'classify':999,'query':'ngpt'})
print(json.dumps(SitesManage().get_site_list(get), ensure_ascii=False, default=str)[:4000])
PY
REMOTE
```

期望结果：

- `nextchat` 是 `Up ... (healthy)`
- `compose_project_list` 中 `my_nextchat.run_status` 是 `running`
- `/api/db/health` 返回 `ok: true`
- DockerSite 中 `chat.dyxcloud.com.healthy` 是 `1`
- `https://chat.dyxcloud.com/` 在服务器本机返回 `HTTP/2 200`

## 9. 域名打不开但 IP 能打开的判断

当前主域名已经切换为 `chat.dyxcloud.com`。截至本次验证，外部无代理访问 `https://chat.dyxcloud.com/` 返回 `HTTP/2 200`，证书 SAN 包含 `DNS:chat.dyxcloud.com`。

如果以后出现“IP 能打开、域名打不开”，按下面顺序判断：

```bash
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY curl -I http://chat.dyxcloud.com/
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY curl -I https://chat.dyxcloud.com/
ssh ss 'curl -k -I https://chat.dyxcloud.com/ --max-time 20'
```

- 如果服务器内 `https://chat.dyxcloud.com/` 是 `200`，但外部域名被 reset 或跳转到 DNSPod webblock，说明根因在腾讯云/DNSPod/安全策略的域名公网链路，不在 Docker/Nginx/证书。
- `https://42.193.15.117/` 能打开只代表 IP 默认站点可访问，不代表 `server_name chat.dyxcloud.com` 正常。
- 旧域名 `ngpt.chat` 已从 DockerSite/Nginx 激活绑定中移除，不再作为线上访问域名。

## 10. 控制台 `content_main.js/content_guard.js` 报错说明

如果控制台报错来自：

```text
content_main.js
content_guard.js
Uncaught (in promise) fetchError: Failed to fetch
```

这通常是浏览器扩展注入脚本，不是 NextChat 自身的 `_next/static/...js`。排查时应优先使用无扩展窗口或隐身模式验证，并同时查看 Network 中失败请求的真实 URL。


## chat.dyxcloud.com 宝塔全流程 Runbook

详细的域名切换、DockerSite、普通站点兼容记录、SSL 证书数据库、缓存开关重复 listen 修复步骤见：

- [docs/baota-chat-dyxcloud-runbook.md](docs/baota-chat-dyxcloud-runbook.md)
