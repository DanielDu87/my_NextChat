# NextChat 宝塔 DockerSite 部署说明（权威）

本文档是 `chat.dyxcloud.com` 当前线上部署的权威说明，给后续 AI 或人工部署时直接执行使用。

生产固定命令、DockerSite 路径、数据库与证书注意事项同时维护在 [AGENTS.md](AGENTS.md)；通用入口见 [DEPLOY.md](DEPLOY.md)。本文件保留宝塔部署的完整操作说明，不再依赖已移除的拆分 Runbook。

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
| 数据库 | 宿主机 PostgreSQL，配置在服务器 `/www/dk_project/my_NextChat/.env.baota` |
| 数据库服务器 | 宝塔 PostgreSQL 16（监听 `127.0.0.1:5432` + `172.20.0.1:5432`） |
| 默认管理员 | `user:admin`（`NEXTCHAT_DEFAULT_USER_ID` / `NEXT_PUBLIC_DEFAULT_SYNC_USER_ID`） |

部署链路：

```text
浏览器 -> 宝塔 Nginx 80/443 -> 127.0.0.1:3000 -> Docker 容器 nextchat -> 宿主机 PostgreSQL
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
| `/www/dk_project/my_NextChat/docker-compose.baota.yml` | 宝塔专用 Compose 源文件，通过 Docker 网桥直连宿主机 PostgreSQL |
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

部署脚本会始终从服务器项目目录的当前 Git `HEAD` 重新计算并注入
`BUILD_COMMIT_HASH` / `BUILD_COMMIT_DATE`，覆盖 shell 或面板残留的旧环境变量。
部署完成后必须同时核对：

> `deployment_metadata` 实际表列是 `commit_hash` / `image_name` / `git_branch` / `deployed_at`，
> 读取 SQL 形如 `select commit_hash, image_name, git_branch, deployed_at from deployment_metadata order by deployed_at desc limit 1`。

```bash
ssh ss 'docker exec nextchat printenv BUILD_COMMIT_HASH'
ssh ss 'curl -sS http://127.0.0.1:3000/ | grep -o "commitHash[^,]*" | head -1'
ssh ss 'docker exec nextchat node -e "const{Client}=require(\"pg\");const c=new Client({host:process.env.PGHOST,port:process.env.PGPORT,user:process.env.PGUSER,password:process.env.PGPASSWORD,database:process.env.PGDATABASE});c.query(\"select commit_hash, image_name, git_branch, deployed_at from deployment_metadata order by deployed_at desc limit 1\").then(r=>{console.log(r.rows[0]);c.end()})"'
```

最后一段 SQL 调用同步使用最新表列名，可直接复用 `scripts/probe-deployment.cjs`（仓库内已入仓，镜像自带，无需外部上传）：
```bash
ssh ss 'docker exec nextchat node scripts/probe-deployment.cjs'                  # 仅看最近 1 行
ssh ss 'docker exec nextchat node scripts/probe-deployment.cjs --limit 5'        # 最近 5 行
ssh ss 'LIMIT=10 docker exec nextchat node scripts/probe-deployment.cjs'         # 兼容环境变量
```

> ⚠️ **重要**：部署后必须执行 `fix-pg-hba.sh` 脚本修复数据库连接（详见 §3.1）。

> 完成标志清理：标准重部署临时脚本（`/tmp/nextchat-baota-deploy.sh`，不在仓库内）
> 应在脚本顶部先 `rm -f /tmp/nextchat-baota-deploy.done`，避免上一次部署残留的完成
> 标志让外部脚本误判本次部署是否已完成；本次提交（2026-07-25 11:50）已在服务器端
> 同步加入该清理。

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
# 修复数据库连接（自动适配容器网络）
./scripts/fix-pg-hba.sh
'\'' 2>&1 | tee /tmp/nextchat-baota-deploy.log"'
```

### 3.1 pg_hba.conf 网络适配（⚠️ 必须执行）

容器可能使用 host 网络模式（IP 如 `10.0.x.x`）或 Docker 网桥（IP 如 `172.17.x.x`），
`fix-pg-hba.sh` 脚本会自动检测容器网络并添加对应的 pg_hba.conf 规则：

```bash
# 独立执行（如标准部署已包含则无需单独运行）
ssh ss 'cd /www/dk_project/my_NextChat && ./scripts/fix-pg-hba.sh'
```

脚本功能：
1. 检测 PostgreSQL 数据目录（支持宝塔 `/www/server/pgsql/data` 等）
2. 自动检测容器网络 IP 和网段
3. 在 pg_hba.conf 添加必要的 `host nextchat|nextchat_backup dyx x.x.x.0/xx md5` 规则
4. 重载 PostgreSQL 配置

如脚本无法自动重载，需手动重载：
```bash
ssh ss 'su - postgres -c "/www/server/pgsql/bin/pg_ctl reload -D /www/server/pgsql/data"'
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

### 3.1 `.env.baota` 必备变量（首次部署 / 大改前必检）

`docker-compose.baota.yml` 通过 `env_file: /www/dk_project/my_NextChat/.env.baota` 注入所有环境变量。除了 `DATABASE_URL` / `PG*` 主库连接之外，**当前线上必须额外配置以下 12 个 `BACKUP_*` 变量 + PG 超时 + 站点密码**，否则站内对话备份 / API 配置备份静默不可用：

| 变量 | 必填 | 说明 |
|---|---|---|
| `BACKUP_DATABASE_URL` | 优先 | 备份库完整连接字符串，覆盖其他 `BACKUP_PG*` |
| `BACKUP_PGHOST` | 是 | 备份库主机（未设 `BACKUP_DATABASE_URL` 时使用） |
| `BACKUP_PGPORT` | 否 | 备份库端口，默认 `5432` |
| `BACKUP_PGDATABASE` | 是 | 备份库名（建议 `nextchat_backup`，与主库分离） |
| `BACKUP_PGUSER` | 是 | 备份库用户名 |
| `BACKUP_PGPASSWORD` | 是 | 备份库密码 |
| `BACKUP_PGSSL` | 否 | 是否启用 SSL（`true`/`1`/`yes`/`on`） |
| `BACKUP_PGSSLMODE` | 否 | SSL 模式；`require` 启用 SSL，`disable` 关闭 |
| `BACKUP_PGPOOL_MAX` | 否 | 连接池上限，默认 `5` |
| `BACKUP_PG_CONNECT_TIMEOUT_MS` | 否 | 连接超时，默认 `10000` |
| `BACKUP_PG_IDLE_TIMEOUT_MS` | 否 | 空闲超时，默认 `30000` |
| `BACKUP_PG_RETRY_COUNT` | 否 | 重试次数，默认 `3` |
| `PG_STATEMENT_TIMEOUT_MS` | 是 | 单语句超时；防止备份 / 增量同步被长事务拖死 |
| `PG_IDLE_IN_TX_TIMEOUT_MS` | 是 | 空闲事务超时；防止误锁，代码默认 `60000` |
| `PGSSL_REJECT_UNAUTHORIZED` | 否 | 是否校验主库证书 |
| `NEXTCHAT_SITE_PASSWORD` | 是 | 站点访问密码（开启站点访问密码门禁时） |

主库和独立备份库**都要**纳入宝塔 `pg_dump` 计划任务范围。完整字段定义与默认值见 [DEPLOY.md](./DEPLOY.md)。

### ⚠️ 备份数据库连接检查清单

**首次部署或修改环境变量后必须检查：**

1. **pg_hba.conf 必须允许容器 IP**
   - 容器可能使用 host 网络模式（IP 如 `10.0.0.x`）或 Docker 网桥（IP 如 `172.17.x.x`）
   - 执行 `fix-pg-hba.sh` 自动检测并添加规则：
     ```bash
     ssh ss 'cd /www/dk_project/my_NextChat && ./scripts/fix-pg-hba.sh'
     ```
   - 脚本会自动处理 `172.17.0.0/16`、`172.20.0.0/16`、`10.0.0.0/24` 等常见网段

2. **环境变量变更需要重建容器**
   - `docker restart` **不会**重新读取 `.env` 文件
   - 修改 `.env.baota` 后必须销毁并重建容器：
     ```bash
     ssh ss 'cd /www/dk_project/my_NextChat && docker rm -f nextchat && docker run -d \
       --name nextchat --restart unless-stopped \
       --env-file .env.baota \
       -p 127.0.0.1:3000:3000 \
       -v nextchat-data:/app/data \
       nextchat-baota:latest'
     ```

3. **验证备份数据库连接**
   ```bash
   ssh ss 'docker exec nextchat node -e "const{Pool}=require(\"pg\");new Pool({host:\"172.20.0.1\",port:5432,database:\"nextchat_backup\",user:\"dyx\",password:process.env.BACKUP_PGPASSWORD,max:2}).query(\"SELECT 1\").then(r=>{console.log(\"OK\");process.exit(0)}).catch(e=>{console.error(e.message);process.exit(1)})"'
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

宝塔 Compose 页面不是直接读取仓库目录下的 `docker-compose.baota.yml`。需要把配置同步到宝塔目录，并使用绝对路径构建上下文；下方模板与 [AGENTS.md](AGENTS.md) 中记录的固定路径共同作为当前依据。

最小可用模板：

```yaml
services:
  nextchat:
    build:
      context: /www/dk_project/my_NextChat
      dockerfile: Dockerfile
      target: runner
      args:
        NPM_REGISTRY: ${NPM_REGISTRY:-https://registry.npmjs.org}
        APK_MIRROR: ${APK_MIRROR:-}
        ENABLE_GOOGLE_FONTS: ${ENABLE_GOOGLE_FONTS:-false}
        ENABLE_SHAREGPT: ${ENABLE_SHAREGPT:-false}
        NEXT_PUBLIC_DEFAULT_SYNC_USER_ID: ${NEXT_PUBLIC_DEFAULT_SYNC_USER_ID:-user:admin}
        BUILD_COMMIT_DATE: ${BUILD_COMMIT_DATE:?请使用 scripts/docker-compose-safe.sh 注入提交时间}
        BUILD_COMMIT_HASH: ${BUILD_COMMIT_HASH:?请使用 scripts/docker-compose-safe.sh 注入提交哈希}
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
      - "127.0.0.1:3000:3000"
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:3000/api/config || exit 1"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s
```

如需写入宝塔 `docker.db` 的 `templates/stacks`，以下属于生产数据库写操作：执行前必须备份 `docker.db`、展示将修改的记录并取得本次明确确认。日常部署不需要执行此段，标准部署只运行 `scripts/sync-baota-dockersite-container-id.sh` 的定向同步。

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

如果提示域名已存在，通常是 `site.db` 里有普通站点残留。下列命令会删除 `chat.dyxcloud.com` 对应的普通站点和域名记录，属于生产数据删除；不得直接执行，必须先查询并列出具体行、备份 `site.db` 与 `docker.db`，再取得用户针对本次记录的明确确认：

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

宝塔页面操作、手动续签、部署和修正 `use_for_site` 的当前要点如下；固定数据库路径同时以 [AGENTS.md](AGENTS.md) 为准：

- 证书文件路径：`/www/server/panel/vhost/cert/chat.dyxcloud.com/{fullchain.pem,privkey.pem}`
- 证书库路径：`/www/server/panel/vhost/ssl_saved/<hash>/`
- 宝塔证书数据库：`/www/server/panel/data/db/ssl_data.db`，**`use_for_site` 必须指向普通站点兼容 ID `16`（不是 DockerSite `13`）**。
- Nginx vhost 中同一 `server {}` 只能有一条 `listen 443`，不要写 `http2 on;`（宝塔 Nginx 1.24 不支持）。
- 续签失败 / 跨域访问证书错误时，按下文标准验证命令检查证书文件、SNI 和 Nginx 配置。

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
- API 配置：`https://chat.dyxcloud.com/api_config`
- 对话备份：`https://chat.dyxcloud.com/backup/chat`
- API 配置备份：`https://chat.dyxcloud.com/backup/api_config`
- 余额查询：`https://chat.dyxcloud.com/balances`

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

PostgreSQL 数据本身继续使用 `pg_dump` + 宝塔计划任务备份，主业务库与独立备份库都必须覆盖。

## 相关文档

- 生产固定路径与验证：[AGENTS.md](AGENTS.md)
- 部署入口：[DEPLOY.md](DEPLOY.md)
- 应用架构与多用户实现：[CLAUDE.md](CLAUDE.md)
- 本地开发：[docs/development.md](docs/development.md)
- 项目与文档入口：[README.md](README.md)
