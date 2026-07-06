# NextChat 宝塔 DockerSite 部署说明（权威）

本文档是 `chat.dyxcloud.com` 当前线上部署的权威说明，给后续 AI 或人工部署时直接执行使用。

详细页面操作（建站 / 反代 / SSL / Compose 同步 / 清理 / 验证）见 [docs/baota-dockersite-guide.md](docs/baota-dockersite-guide.md)；详细排障（域名切换 / 三套数据库 / 缓存开关）见 [docs/baota-chat-dyxcloud-runbook.md](docs/baota-chat-dyxcloud-runbook.md)；PostgreSQL 操作（备份 / 还原 / 迁移）见 [docs/baota-postgres-guide.md](docs/baota-postgres-guide.md)。

## 1. 当前固定环境

| 项 | 当前值 |
|---|---|
| SSH alias | `ss` |
| 服务器公网 IP | `42.193.15.117` |
| 项目目录 | `/www/dk_project/my_NextChat` |
| 域名 | `chat.dyxcloud.com` |
| Docker 容器名 | `nextchat` |
| 容器监听 | `127.0.0.1:3000 -> 3000`（**仅宿主机可访问**，不得暴露 0.0.0.0） |
| 宝塔 DockerSite 站点名 | `chat.dyxcloud.com` |
| 宝塔 Compose 显示名 | `my_nextchat` |
| 宝塔 Compose 实际 project | `03b890c97bdecc48c2294402d8768906`，即 `md5(my_nextchat)` |
| Nginx 反代目标 | `http://127.0.0.1:3000` |
| 数据库 | 远程 PostgreSQL，配置在服务器 `/www/dk_project/my_NextChat/.env.baota` |
| 数据库服务器 | 宝塔 PostgreSQL 16（监听 `127.0.0.1:5432` + `172.20.0.1:5432`） |
| 默认管理员 | `user:admin`（`NEXTCHAT_DEFAULT_USER_ID` / `NEXT_PUBLIC_DEFAULT_SYNC_USER_ID`） |

部署链路：

```text
浏览器 -> 宝塔 Nginx 80/443 -> 127.0.0.1:3000 -> Docker 容器 nextchat -> 远程 PostgreSQL
```

禁止：

- 不要把本项目部署成内置 PostgreSQL 容器
- 不要混用 `/www/dk_project/my_NextChat/.env.docker` 和 `.env.baota`
- 不要把 `nextchat` 容器端口映射为 `0.0.0.0:3000`
- 不要把 `ssl_info.use_for_site` 指向 `docker_sites.id`
- 不要写 `http2 on;` 或重复 `listen 443`

## 2. 必须使用的文件

### 2.1 仓库内文件

| 文件 | 用途 |
|---|---|
| `/www/dk_project/my_NextChat/docker-compose.baota.yml` | 宝塔专用 Compose 源文件，直连远程 PostgreSQL |
| `/www/dk_project/my_NextChat/.env.baota` | 线上真实环境变量，**必须保留现有数据库密码和 `APP_SECRET`** |
| `/www/dk_project/my_NextChat/Dockerfile` | 镜像构建文件 |
| `/www/dk_project/my_NextChat/scripts/baota-register-dockersite.py` | 调用宝塔官方内部接口注册 DockerSite |

### 2.2 宝塔面板实际读取的文件

| 文件/目录 | 用途 |
|---|---|
| `/www/server/panel/data/compose/my_nextchat/docker-compose.yaml` | 宝塔 Compose 页面读取的 Compose 文件 |
| `/www/server/panel/data/compose/my_nextchat/.env` | 宝塔 Compose 页面读取的 env 文件 |
| `/www/server/panel/data/db/docker.db` | 宝塔 Docker / DockerSite 数据库（**当前数据源**） |
| `/www/server/panel/data/db/site.db` | 宝塔普通网站数据库；残留同域名记录会阻止 DockerSite 创建 |
| `/www/server/panel/data/db/ssl_data.db` | 宝塔证书数据库，证书到期提醒依赖普通站点兼容 ID |
| `/www/dk_project/sites/chat.dyxcloud.com/chat.dyxcloud.com.json` | 宝塔 DockerSite 站点 JSON |
| `/www/server/panel/vhost/nginx/chat.dyxcloud.com.conf` | 宝塔 Nginx vhost |
| `/www/server/panel/vhost/cert/chat.dyxcloud.com/fullchain.pem` | `chat.dyxcloud.com` 证书链 |
| `/www/server/panel/vhost/cert/chat.dyxcloud.com/privkey.pem` | `chat.dyxcloud.com` 私钥 |
| `/www/wwwlogs/chat.dyxcloud.com.log` | 访问日志 |
| `/www/wwwlogs/chat.dyxcloud.com.error.log` | 错误日志 |

> **注意**：`/www/server/panel/data/docker.db` 是旧空文件 / 旧副本，**不是当前 DockerSite 数据源**，不要改它。

## 3. 标准重部署流程

所有长时间部署必须放入 `tmux`，避免 SSH 断开导致构建中断。
宝塔生产 Compose 要求构建时必须注入 Git 提交哈希和时间；绕过
`scripts/docker-compose-safe.sh` 会直接报错，不再生成界面版本为 `unknown` 的镜像。

```bash
ssh ss 'tmux new-session -d -s nextchat-baota-deploy "cd /www/dk_project/my_NextChat && bash -lc '\''
set -euo pipefail
git pull --ff-only
export BUILDX_CONFIG=/tmp/nextchat-docker-buildx
mkdir -p \"\$BUILDX_CONFIG\"
./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota build nextchat
(docker rm -f nextchat 2>/dev/null || true)
(docker image rm nextchat:latest 2>/dev/null || true)
./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota up -d --force-recreate nextchat
./scripts/sync-baota-dockersite-container-id.sh
'\'' 2>&1 | tee /tmp/nextchat-baota-deploy.log"'
```

`scripts/sync-baota-dockersite-container-id.sh` 现在会先等待 `nextchat`
容器健康，再自动写入 `deployment_metadata`，最后同步
`docker.db.docker_sites.container_id`。`deployment_metadata` 包含 Git commit
hash、commit 时间、分支、镜像名和实际部署时间；未部署的普通 Git 提交不会写入该表。

查看进度：

```bash
ssh ss 'tmux capture-pane -t nextchat-baota-deploy -p -S -120'
ssh ss 'tail -120 /tmp/nextchat-baota-deploy.log'
```

如果只是按宝塔面板规范重启当前镜像，不需要重新构建：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
PROJECT=03b890c97bdecc48c2294402d8768906
COMPOSE=/www/server/panel/data/compose/my_nextchat/docker-compose.yaml
ENV=/www/server/panel/data/compose/my_nextchat/.env
/usr/bin/docker-compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV" up -d --no-build
REMOTE
```

容器重建后必须刷新 `docker.db.docker_sites.container_id`，否则宝塔 DockerSite 页面会显示 `exited`。
标准部署已自动执行以下脚本；脚本会等待容器健康、写入 `deployment_metadata`，
再备份 `docker.db` 并只更新 `chat.dyxcloud.com` 记录，成功后自动清理上一轮
`docker.db.bak-nextchat-*` 备份，只保留本轮最新备份：

```bash
ssh ss 'cd /www/dk_project/my_NextChat && ./scripts/sync-baota-dockersite-container-id.sh'
```

## 4. 日常部署 / 重启 / 清理快捷命令

| 场景 | 命令 |
|---|---|
| 重建镜像并发布 | §3 标准重部署流程 |
| 仅重启当前镜像 | `docker-compose ... up -d --no-build`（见 §3 末尾） |
| 写部署版本并同步 `container_id` | `scripts/sync-baota-dockersite-container-id.sh` |
| 停止应用但保留数据 | `docker rm -f nextchat` |
| 清理旧镜像（仅限 NextChat 专用） | `docker image rm nextchat-baota:latest nextchat:latest` |
| 重置宝塔 DockerSite 记录 | 跑 `scripts/baota-register-dockersite.py` |

## 5. 同步宝塔 Compose 页面（首次或大改后）

宝塔 Compose 页面不是直接读取仓库目录下的 `docker-compose.baota.yml`。需要把配置同步到宝塔目录，并使用绝对路径构建上下文。**Compose 文件内容、详细步骤见 [docs/baota-dockersite-guide.md §6](docs/baota-dockersite-guide.md)**。

最小可用模板：

```yaml
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
```

写入宝塔 `docker.db` 的 `templates/stacks`：

```bash
ssh ss 'python3 - <<PY'
import sqlite3, time
con = sqlite3.connect('/www/server/panel/data/db/docker.db')
cur = con.cursor()
cur.execute("select id from templates where name=?", ('my_nextchat',))
row = cur.fetchone()
if row:
    tid = row[0]
    cur.execute("update templates set path=?, remark=?, add_in_path=? where id=?",
                ('/www/server/panel/data/compose/my_nextchat', 'NextChat', 1, tid))
else:
    cur.execute("insert into templates(path,name,remark,add_in_path) values(?,?,?,?)",
                ('/www/server/panel/data/compose/my_nextchat', 'my_nextchat', 'NextChat', 1))
    tid = cur.lastrowid
cur.execute("select id from stacks where name=?", ('my_nextchat',))
row = cur.fetchone()
if row:
    cur.execute("update stacks set status=?, path=?, template_id=?, time=?, remark=? where id=?",
                ('1', '/www/server/panel/data/compose/my_nextchat/docker-compose.yaml',
                 tid, int(time.time()), 'NextChat', row[0]))
else:
    cur.execute("insert into stacks(name,status,path,template_id,time,remark) values(?,?,?,?,?,?)",
                ('my_nextchat', '1',
                 '/www/server/panel/data/compose/my_nextchat/docker-compose.yaml',
                 tid, int(time.time()), 'NextChat'))
con.commit(); con.close()
PY'
```

启动时必须使用 `md5(my_nextchat)` 作为 Docker Compose project：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
PROJECT=03b890c97bdecc48c2294402d8768906
COMPOSE=/www/server/panel/data/compose/my_nextchat/docker-compose.yaml
ENV=/www/server/panel/data/compose/my_nextchat/.env
/usr/bin/docker-compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV" up -d --no-build
REMOTE
```

## 6. 注册到宝塔 DockerSite 页面

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
con = sqlite3.connect('/www/server/panel/data/db/site.db')
cur = con.cursor()
for (sid,) in cur.execute("select id from sites where name=?", ('chat.dyxcloud.com',)).fetchall():
    cur.execute('delete from domain where pid=? and name=?', (sid, 'chat.dyxcloud.com'))
    cur.execute('delete from sites where id=? and name=?', (sid, 'chat.dyxcloud.com'))
con.commit(); con.close()
PY
cd /www/dk_project/my_NextChat
/www/server/panel/pyenv/bin/python3 scripts/baota-register-dockersite.py
REMOTE
```

## 7. SSL 证书（简要）

宝塔页面操作（建站时已自动申请） + 手动续签 / 部署 / 修正 `use_for_site` 的完整步骤见 [docs/baota-dockersite-guide.md §4](docs/baota-dockersite-guide.md)。要点：

- 证书文件路径：`/www/server/panel/vhost/cert/chat.dyxcloud.com/{fullchain.pem,privkey.pem}`
- 证书库路径：`/www/server/panel/vhost/ssl_saved/<hash>/`
- 宝塔证书数据库：`/www/server/panel/data/db/ssl_data.db`，**`use_for_site` 必须指向普通站点兼容 ID `16`（不是 DockerSite `13`）**。
- Nginx vhost 中同一 `server {}` 只能有一条 `listen 443`，不要写 `http2 on;`（宝塔 Nginx 1.24 不支持）。
- 续签失败 / 跨域访问证书错误时，按 runbook §8 检查证书文件。

## 8. 标准验证命令

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
printf "== Docker ==\n"
docker ps --filter name=nextchat --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}'
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
get=public.to_dict_obj({'type':'all','p':1,'row':20,'classify':999,'query':'chat.dyxcloud.com'})
print(json.dumps(SitesManage().get_site_list(get), ensure_ascii=False, default=str)[:4000])
PY
REMOTE
```

期望结果：

- `nextchat` 是 `Up ... (healthy)`
- `/api/db/health` 返回 `ok: true`
- DockerSite 中 `chat.dyxcloud.com.healthy` 是 `1`
- `https://chat.dyxcloud.com/` 在服务器本机返回 `HTTP/2 200`

## 9. 域名路由说明

当前页面路由统一使用普通路径：

- 首页：`https://chat.dyxcloud.com/`
- 聊天页：`https://chat.dyxcloud.com/chat`
- 绘图页：`https://chat.dyxcloud.com/draw`
- 绘图历史：`https://chat.dyxcloud.com/draw/history`
- API 配置：`https://chat.dyxcloud.com/api-config`
- API 配置备份：`https://chat.dyxcloud.com/api-config/backups`
- 余额查询：`https://chat.dyxcloud.com/api-config/balances`

旧 `/#/...` 地址会在客户端启动时自动迁移到普通路径。宝塔 Nginx 反代仍只需要指向 `http://127.0.0.1:3000`，无需为这些前端路径单独配置反代规则。

## 10. 域名打不开但 IP 能打开的判断

如果以后出现"IP 能打开、域名打不开"，按下面顺序判断：

```bash
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY curl -I http://chat.dyxcloud.com/
env -u http_proxy -u https_proxy -u HTTP_PROXY -u HTTPS_PROXY -u all_proxy -u ALL_PROXY curl -I https://chat.dyxcloud.com/
ssh ss 'curl -k -I https://chat.dyxcloud.com/ --max-time 20'
```

- 如果服务器内 `https://chat.dyxcloud.com/` 是 `200`，但外部域名被 reset 或跳转到 DNSPod webblock，说明根因在腾讯云 / DNSPod / 安全策略的域名公网链路，不在 Docker / Nginx / 证书。
- `https://42.193.15.117/` 能打开只代表 IP 默认站点可访问，不代表 `server_name chat.dyxcloud.com` 正常。
- 旧域名 `ngpt.chat` 已从 DockerSite / Nginx 激活绑定中移除，不再作为线上访问域名。

## 11. 控制台 `content_main.js / content_guard.js` 报错说明

如果控制台报错来自：

```text
content_main.js
content_guard.js
Uncaught (in promise) fetchError: Failed to fetch
```

通常是浏览器扩展注入脚本，不是 NextChat 自身的 `_next/static/...js`。排查时应优先使用无扩展窗口或隐身模式验证，并同时查看 Network 中失败请求的真实 URL。

## 12. 备份与清理

部署前先备份；部署后再做一次本地或远程备份。具体步骤：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
TS=$(date +%Y%m%d-%H%M%S)
BACK=/root/nextchat-baota-clean-$TS
mkdir -p "$BACK"
cp /www/server/panel/data/db/docker.db "$BACK/docker.db"
cp /www/server/panel/data/db/site.db   "$BACK/site.db"
cp /www/server/panel/data/db/ssl_data.db "$BACK/ssl_data.db"
cp -a /www/dk_project/sites/chat.dyxcloud.com "$BACK/sites-chat.dyxcloud.com" 2>/dev/null || true
cp /www/server/panel/vhost/nginx/chat.dyxcloud.com.conf "$BACK/chat.dyxcloud.com.conf" 2>/dev/null || true
echo "backup=$BACK"
REMOTE
```

PostgreSQL 数据本身的备份（`pg_dump` + 计划任务）见 [docs/baota-postgres-guide.md §5](docs/baota-postgres-guide.md)。

## 相关文档

- 详细页面操作：[docs/baota-dockersite-guide.md](docs/baota-dockersite-guide.md)
- 详细排障 Runbook：[docs/baota-chat-dyxcloud-runbook.md](docs/baota-chat-dyxcloud-runbook.md)
- PostgreSQL 操作：[docs/baota-postgres-guide.md](docs/baota-postgres-guide.md)
- 多用户 / 登录 / 用户切换：[docs/user-admin-guide.md](docs/user-admin-guide.md)
- 本地开发：[docs/local-dev-guide.md](docs/local-dev-guide.md)
- 质量与部署后验证：[docs/quality-checklist.md](docs/quality-checklist.md)
- 部署入口：[DEPLOY.md](DEPLOY.md)
