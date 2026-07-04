# chat.dyxcloud.com 宝塔 DockerSite 全流程 Runbook

本文档记录当前线上站点 `chat.dyxcloud.com` 的完整宝塔 DockerSite 部署、域名切换、缓存开关、SSL 证书和数据库兼容设置。后续 AI 部署或排障必须按本文执行。

## 1. 固定信息

| 项 | 当前值 |
|---|---|
| SSH alias | `ss` |
| 服务器 IP | `42.193.15.117` |
| 项目目录 | `/www/dk_project/my_NextChat` |
| 当前唯一线上域名 | `chat.dyxcloud.com` |
| 旧域名 | `ngpt.chat`，已从激活绑定移除 |
| Docker 容器 | `nextchat` |
| Docker 镜像 | `nextchat-baota:latest` |
| 容器端口 | `127.0.0.1:3000 -> 3000`（仅宿主机可访问） |
| Nginx 反代 | `http://127.0.0.1:3000` |
| 宝塔 DockerSite ID | `13` |
| 宝塔普通站点兼容 ID | `16` |
| 证书记录 ID | `46` |
| Compose 显示名 | `my_nextchat` |
| Compose 实际 project | `03b890c97bdecc48c2294402d8768906`，即 `md5(my_nextchat)` |

### 1.1 生产端口安全基线

- NextChat 端口必须映射为 `127.0.0.1:3000:3000`，仅供宿主机 Nginx 反代使用。
- PostgreSQL 只监听 `127.0.0.1,172.20.0.1`，不得监听 `0.0.0.0` 或服务器公网 IP。
- `pg_hba.conf` 中 NextChat 连接来源必须限制为 Docker 网段 `172.20.0.0/16`，不得使用 `0.0.0.0/0`。
- `.env.baota` 和宝塔 Compose `.env` 的 `PGHOST` 必须为 `172.20.0.1`，不得通过公网 IP 回连数据库。
- 腾讯云安全组不应放行公网入站 TCP `3000` 或 `5432`；公网只保留网站和运维所需端口。

检查命令：

```bash
ssh ss 'ss -lntp | grep -E "(:3000|:5432)([[:space:]]|$)"'
ssh ss 'grep -nE "^[[:space:]]*listen_addresses[[:space:]]*=|^host[[:space:]]+nextchat" /www/server/pgsql/data/postgresql.conf /www/server/pgsql/data/pg_hba.conf'
```

预期只出现 `127.0.0.1:3000`、`127.0.0.1:5432` 和 `172.20.0.1:5432`。

## 2. 必须区分的三套宝塔数据

宝塔不同功能读取不同 SQLite 数据库，不能只改一处。

### 2.1 DockerSite 数据：`docker.db`

路径：`/www/server/panel/data/db/docker.db`

用于宝塔 **Docker -> 网站 / DockerSite** 页面显示站点。

必须有：

```sql
select * from docker_sites where name='chat.dyxcloud.com';
select * from docker_domain where name='chat.dyxcloud.com';
```

当前要求：

- `docker_sites.id = 13`
- `docker_sites.name = chat.dyxcloud.com`
- `docker_sites.path = /www/dk_project/wwwroot/chat.dyxcloud.com`
- `docker_sites.type = app`
- `docker_sites.service_info` 包含 `nextchat` 和端口 `3000`
- `docker_sites.container_id` 必须是当前运行中 `nextchat` 容器 ID
- `docker_domain.pid = 13`
- `docker_domain.name = chat.dyxcloud.com`
- `docker_domain.port = 80`

不要在 `docker_domain` 里保留 `ngpt.chat`。

### 2.2 普通站点兼容数据：`site.db`

路径：`/www/server/panel/data/db/site.db`

用于宝塔 **SSL 证书到期提醒 / 消息推送 / 部分证书页面** 查询站点。DockerSite 本身不一定出现在这张表里；如果这里没有兼容记录，宝塔会提示：

```text
未查询到站点【chat.dyxcloud.com】
```

必须有：

```sql
select * from sites where name='chat.dyxcloud.com';
select * from domain where name='chat.dyxcloud.com';
```

当前要求：

- `sites.id = 16`
- `sites.name = chat.dyxcloud.com`
- `sites.path = /www/dk_project/wwwroot/chat.dyxcloud.com`
- `sites.status = 1`
- `sites.ps = NextChat (DockerSite compatible)`
- `sites.project_type = Docker`
- `sites.project_config = {}`
- `domain.pid = 16`
- `domain.name = chat.dyxcloud.com`
- `domain.port = 80`

注意：这只是给宝塔普通站点模块查询用的兼容记录，不负责真实反代。真实反代仍由 DockerSite JSON 和 Nginx vhost 管理。

### 2.3 证书数据：`ssl_data.db`

路径：`/www/server/panel/data/db/ssl_data.db`

用于宝塔证书库、到期提醒、证书关联站点。

必须有：

```sql
select * from ssl_info where subject='chat.dyxcloud.com';
```

当前要求：

- `ssl_info.id = 46`
- `ssl_info.subject = chat.dyxcloud.com`
- `ssl_info.dns = ["chat.dyxcloud.com"]`
- `ssl_info.path = /www/server/panel/vhost/ssl_saved/2ce9711a967cd4a3ecf366882cbc60ff`
- `ssl_info.use_for_site = ["16"]`
- `ssl_info.auth_info = {"auth_type":"http","auth_to":"/www/dk_project/wwwroot/chat.dyxcloud.com/"}`

重要：`use_for_site` 必须关联普通站点兼容 ID `16`，不是 DockerSite ID `13`。证书到期提醒查 `site.db.sites`，如果写成 `13` 会找不到普通站点。

旧 `ngpt.chat` 证书记录可以保留在证书库中，但必须解除站点关联：

```sql
update ssl_info set use_for_site='[]' where subject='ngpt.chat';
```

## 3. 必须保留的文件和目录

| 路径 | 作用 |
|---|---|
| `/www/dk_project/my_NextChat/.env.baota` | 线上环境变量，`BASE_URL=https://chat.dyxcloud.com` |
| `/www/server/panel/data/compose/my_nextchat/docker-compose.yaml` | 宝塔 Compose 配置，默认 URL 指向 `chat.dyxcloud.com` |
| `/www/server/panel/data/compose/my_nextchat/.env` | 宝塔 Compose env，和 `.env.baota` 同步 |
| `/www/dk_project/sites/chat.dyxcloud.com/chat.dyxcloud.com.json` | DockerSite JSON |
| `/www/dk_project/sites/chat.dyxcloud.com/proxy_cache_dir` | 宝塔 Nginx proxy cache 目录 |
| `/www/dk_project/wwwroot/chat.dyxcloud.com` | 宝塔站点根目录、HTTP 验证目录 |
| `/www/server/panel/vhost/nginx/chat.dyxcloud.com.conf` | 激活的 Nginx vhost |
| `/www/server/panel/vhost/cert/chat.dyxcloud.com/fullchain.pem` | 当前 HTTPS 证书链 |
| `/www/server/panel/vhost/cert/chat.dyxcloud.com/privkey.pem` | 当前 HTTPS 私钥 |
| `/www/wwwlogs/chat.dyxcloud.com.log` | 访问日志 |
| `/www/wwwlogs/chat.dyxcloud.com.error.log` | 错误日志 |

不要在激活路径保留 `/www/server/panel/vhost/nginx/ngpt.chat.conf`。旧目录或旧证书如需保留，必须移到 `/root/nextchat-ngpt-archive-*` 这类备份目录。

## 4. 一键检查当前状态

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
printf "== Nginx ==\n"
nginx -t
ls -l /www/server/panel/vhost/nginx/chat.dyxcloud.com.conf /www/server/panel/vhost/nginx/ngpt.chat.conf 2>/dev/null || true
printf "\n== Docker ==\n"
docker ps --filter name=nextchat --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"
printf "\n== HTTPS ==\n"
curl -sS -I https://chat.dyxcloud.com/ --max-time 20 | head -20
printf "\n== Cert ==\n"
openssl x509 -in /www/server/panel/vhost/cert/chat.dyxcloud.com/fullchain.pem -noout -subject -issuer -ext subjectAltName
printf "\n== DB health ==\n"
curl -sS -i http://127.0.0.1:3000/api/db/health --max-time 20 | head -16
REMOTE
```

期望：

- `nginx -t` 成功
- 不存在激活文件 `/www/server/panel/vhost/nginx/ngpt.chat.conf`
- `nextchat` 为 `healthy`
- `https://chat.dyxcloud.com/` 返回 `HTTP/2 200`
- 证书 SAN 包含 `DNS:chat.dyxcloud.com`

## 5. 标准部署或重启

长时间构建必须放入 `tmux`：

```bash
ssh ss 'tmux new-session -d -s nextchat-baota-deploy "cd /www/dk_project/my_NextChat && git pull --ff-only && ./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota build nextchat && (docker rm -f nextchat 2>/dev/null || true) && (docker image rm nextchat:latest 2>/dev/null || true) && ./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota up -d --force-recreate nextchat 2>&1 | tee /tmp/nextchat-baota-deploy.log"'
ssh ss 'tmux capture-pane -t nextchat-baota-deploy -p -S -120'
```

每次部署默认允许替换旧 `nextchat` 容器和旧 `nextchat` 相关镜像，无需再次确认。替换范围仅限 `nextchat`、`nextchat-baota:latest`、`nextchat:latest`，不要执行全局 Docker prune。

### 5.1 低内存构建注意事项

当前服务器内存约 3.6GiB，默认 swap 为 `/www/swap` 1GiB。Next.js 生产构建在 `Creating an optimized production build ...` 和 `Checking validity of types ...` 阶段可能占用较高内存；如果同时有其他项目构建，可能触发 OOM killer，杀掉 `mysqld`、`BT-Panel` 或构建相关进程。

2026-06-11 部署时曾出现以下现象：

- `yarn build` 编译阶段内存和 swap 接近耗尽；
- `dmesg -T` 出现 `Out of memory: Killed process ... mysqld`；
- 第一次部署未启动容器，后续加临时 swap 后构建继续完成；
- 最终实际失败点是 TypeScript 类型错误，不是 OOM，但 OOM 会掩盖真实构建错误。

排查命令：

```bash
ssh ss 'free -h && swapon --show && (dmesg -T 2>/dev/null || true) | grep -Ei "out of memory|killed process" | tail -20'
ssh ss 'tmux capture-pane -t nextchat-baota-deploy -p -S -160'
ssh ss 'tail -160 /tmp/nextchat-baota-deploy.log'
```

如果构建阶段 swap 即将耗尽，可以临时增加 swap 后继续观察：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
SWAP=/www/nextchat-build.swap
if ! swapon --show=NAME --noheadings | grep -qx "$SWAP"; then
  fallocate -l 4G "$SWAP" || dd if=/dev/zero of="$SWAP" bs=1M count=4096 status=progress
  chmod 600 "$SWAP"
  mkswap "$SWAP"
  swapon "$SWAP"
fi
swapon --show
free -h
REMOTE
```

部署完成并确认容器健康后，先停用临时 swap：

```bash
ssh ss 'swapoff /www/nextchat-build.swap 2>/dev/null || true; swapon --show; free -h'
```

注意：不要自动删除 `/www/nextchat-build.swap`。如需释放磁盘空间，先确认当前没有构建任务且服务稳定，再手动删除该文件。

如果只更新环境变量或宝塔 Compose 配置，不重建镜像：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
PROJECT=03b890c97bdecc48c2294402d8768906
COMPOSE=/www/server/panel/data/compose/my_nextchat/docker-compose.yaml
ENV=/www/server/panel/data/compose/my_nextchat/.env
/usr/bin/docker-compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV" up -d --no-build
REMOTE
```

## 6. 域名切换到 chat.dyxcloud.com 的完整数据库修复

执行前必须备份：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
TS=$(date +%Y%m%d-%H%M%S)
BACK=/root/nextchat-domain-fix-$TS
mkdir -p "$BACK"
cp /www/server/panel/data/db/docker.db "$BACK/docker.db"
cp /www/server/panel/data/db/site.db "$BACK/site.db"
cp /www/server/panel/data/db/ssl_data.db "$BACK/ssl_data.db"
cp /www/server/panel/vhost/nginx/chat.dyxcloud.com.conf "$BACK/chat.dyxcloud.com.conf" 2>/dev/null || true
cp /www/dk_project/sites/chat.dyxcloud.com/chat.dyxcloud.com.json "$BACK/chat.dyxcloud.com.json" 2>/dev/null || true
printf "backup=%s\n" "$BACK"
REMOTE
```

然后执行数据库和文件修复：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
python3 - <<'PY'
from pathlib import Path
import json, sqlite3, subprocess, time
SITE='chat.dyxcloud.com'
SITE_URL='https://chat.dyxcloud.com'
SITE_PATH='/www/dk_project/wwwroot/chat.dyxcloud.com'
DOCKER_SITE_ID=13
COMPAT_SITE_ID=None

# 1. env 和 Compose URL
for p in [Path('/www/dk_project/my_NextChat/.env.baota'), Path('/www/server/panel/data/compose/my_nextchat/.env')]:
    if p.exists():
        lines=p.read_text().splitlines(); out=[]; seen=False
        for line in lines:
            line=line.replace('ngpt.chat', SITE)
            if line.startswith('BASE_URL='):
                line='BASE_URL='+SITE_URL; seen=True
            out.append(line)
        if not seen: out.append('BASE_URL='+SITE_URL)
        p.write_text('\n'.join(out)+'\n')
p=Path('/www/server/panel/data/compose/my_nextchat/docker-compose.yaml')
if p.exists():
    p.write_text(p.read_text().replace('https://ngpt.chat', SITE_URL).replace('ngpt.chat', SITE))

# 2. docker.db: DockerSite 页面
con=sqlite3.connect('/www/server/panel/data/db/docker.db'); cur=con.cursor()
try:
    cid=subprocess.check_output(['docker','inspect','nextchat','--format','{{.Id}}'], text=True).strip()
except Exception:
    cid=''
cur.execute('update docker_sites set name=?, path=?, container_id=coalesce(nullif(?,\'\'),container_id) where id=?', (SITE, SITE_PATH, cid, DOCKER_SITE_ID))
cur.execute('delete from docker_domain where name=?', ('ngpt.chat',))
row=cur.execute('select id from docker_domain where pid=? and name=?', (DOCKER_SITE_ID, SITE)).fetchone()
if row:
    cur.execute('update docker_domain set port=80, addtime=coalesce(addtime, datetime(\'now\',\'localtime\')) where id=?', (row[0],))
else:
    cur.execute('insert into docker_domain(pid,name,port,addtime) values(?,?,80,datetime(\'now\',\'localtime\'))', (DOCKER_SITE_ID, SITE))
con.commit(); con.close()

# 3. site.db: 证书到期提醒兼容记录
con=sqlite3.connect('/www/server/panel/data/db/site.db'); cur=con.cursor()
for name in ['ngpt.chat']:
    for (sid,) in cur.execute('select id from sites where name=?', (name,)).fetchall():
        cur.execute('delete from domain where pid=?', (sid,))
        cur.execute('delete from sites where id=?', (sid,))
row=cur.execute('select id from sites where name=?', (SITE,)).fetchone()
now=time.strftime('%Y-%m-%d %H:%M:%S')
if row:
    COMPAT_SITE_ID=row[0]
    cur.execute("update sites set path=?, status='1', ps=?, project_type='Docker', project_config='{}', edate='0000-00-00' where id=?", (SITE_PATH, 'NextChat (DockerSite compatible)', COMPAT_SITE_ID))
else:
    cur.execute("""
        insert into sites(name,path,status,ps,addtime,type_id,edate,project_type,project_config,rname,stop)
        values(?,?,?,?,?,?,?,?,?,?,?)
    """, (SITE, SITE_PATH, '1', 'NextChat (DockerSite compatible)', now, 0, '0000-00-00', 'Docker', '{}', '', ''))
    COMPAT_SITE_ID=cur.lastrowid
cur.execute('delete from domain where name=? and pid!=?', (SITE, COMPAT_SITE_ID))
row=cur.execute('select id from domain where pid=? and name=?', (COMPAT_SITE_ID, SITE)).fetchone()
if row:
    cur.execute('update domain set port=80 where id=?', (row[0],))
else:
    cur.execute('insert into domain(pid,name,port,addtime) values(?,?,80,?)', (COMPAT_SITE_ID, SITE, now))
con.commit(); con.close()

# 4. ssl_data.db: 证书库和到期提醒关联，必须指向普通站点兼容 ID
con=sqlite3.connect('/www/server/panel/data/db/ssl_data.db'); cur=con.cursor()
cur.execute("update ssl_info set use_for_site='[]' where subject='ngpt.chat'")
auth_info=json.dumps({'auth_type':'http','auth_to':SITE_PATH+'/'}, ensure_ascii=False)
cur.execute('update ssl_info set use_for_site=?, auth_info=? where subject=?', (json.dumps([str(COMPAT_SITE_ID)]), auth_info, SITE))
con.commit(); con.close()

# 5. DockerSite JSON：site_port 只保留 80，https_port 单独为 443，避免宝塔缓存开关生成重复 listen 443
jp=Path('/www/dk_project/sites/chat.dyxcloud.com/chat.dyxcloud.com.json')
data=json.loads(jp.read_text()) if jp.exists() else {}
data['site_name']=SITE
data['domain_list']=[SITE]
data['site_path']=SITE_PATH
data['primary_port']='80'
data['site_port']=['80']
data['https_port']='443'
data['ipv4_port_conf']='listen {listen_port}{default_site};'
data['ipv4_ssl_port_conf']='{ipv4_port_conf}\n    listen {https_port} ssl http2 {default_site};'
raw=json.dumps(data, ensure_ascii=False, indent=2).replace('ngpt.chat', SITE).replace('ngpt_chat_cache','chat_dyxcloud_com_cache')
jp.write_text(raw+'\n')
print('compat_site_id', COMPAT_SITE_ID)
PY
REMOTE
```

## 7. Nginx 配置要求

激活文件只能是：

```text
/www/server/panel/vhost/nginx/chat.dyxcloud.com.conf
```

同一个 `server {}` 中只能有一条 443：

```nginx
listen 80;
listen 443 ssl http2;
server_name chat.dyxcloud.com;
root /www/dk_project/wwwroot/chat.dyxcloud.com;
ssl_certificate     /www/server/panel/vhost/cert/chat.dyxcloud.com/fullchain.pem;
ssl_certificate_key /www/server/panel/vhost/cert/chat.dyxcloud.com/privkey.pem;
```

不要写：

```nginx
listen 443;
listen 443 ssl http2;
http2 on;
```

当前宝塔 Nginx `1.24.0` 不支持独立 `http2 on;`，并且重复 443 会导致打开缓存开关保存失败。

如果宝塔保存缓存时报：

```text
protocol options redefined for 0.0.0.0:443
a duplicate listen 0.0.0.0:443
```

先检查 DockerSite JSON：

```bash
ssh ss 'python3 - <<"PY"
import json
p="/www/dk_project/sites/chat.dyxcloud.com/chat.dyxcloud.com.json"
data=json.load(open(p))
print("site_port=", data.get("site_port"))
print("https_port=", data.get("https_port"))
PY'
```

必须是：

```text
site_port= ['80']
https_port= 443
```

如果 `site_port` 里有 `443`，必须删除。

## 8. 证书文件部署

证书库路径：

```text
/www/server/panel/vhost/ssl_saved/2ce9711a967cd4a3ecf366882cbc60ff
```

站点证书路径：

```text
/www/server/panel/vhost/cert/chat.dyxcloud.com/fullchain.pem
/www/server/panel/vhost/cert/chat.dyxcloud.com/privkey.pem
```

如果证书文件缺失，从证书库复制：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
SRC=/www/server/panel/vhost/ssl_saved/2ce9711a967cd4a3ecf366882cbc60ff
DST=/www/server/panel/vhost/cert/chat.dyxcloud.com
mkdir -p "$DST"
cp "$SRC/fullchain.pem" "$DST/fullchain.pem"
cp "$SRC/privkey.pem" "$DST/privkey.pem"
nginx -t && nginx -s reload
REMOTE
```

验证证书：

```bash
ssh ss 'openssl x509 -in /www/server/panel/vhost/cert/chat.dyxcloud.com/fullchain.pem -noout -subject -issuer -ext subjectAltName'
```

期望包含：

```text
subject=CN = chat.dyxcloud.com
DNS:chat.dyxcloud.com
```

## 9. 最终验证

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
nginx -t
docker ps --filter name=nextchat --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"
curl -sS -I https://chat.dyxcloud.com/ --max-time 20 | head -20
curl -sS -i http://127.0.0.1:3000/api/db/health --max-time 20 | head -16
python3 - <<'PY'
import sqlite3, json
checks=[
  ('/www/server/panel/data/db/docker.db', ['docker_sites','docker_domain']),
  ('/www/server/panel/data/db/site.db', ['sites','domain']),
  ('/www/server/panel/data/db/ssl_data.db', ['ssl_info']),
]
for db,tables in checks:
    print('\nDB', db)
    con=sqlite3.connect(db); con.row_factory=sqlite3.Row; cur=con.cursor()
    for t in tables:
        rows=cur.execute(f'select * from {t}').fetchall()
        keep=[]
        for r in rows:
            s=json.dumps(dict(r), ensure_ascii=False)
            if 'chat.dyxcloud.com' in s:
                keep.append(dict(r))
        if keep:
            print(t, json.dumps(keep, ensure_ascii=False))
    con.close()
PY
REMOTE
```

## 10. 注意事项

- 不要再绑定 `ngpt.chat`。
- 不要再创建 `/www/server/panel/vhost/nginx/ngpt.chat.conf` 激活文件。
- 不要把 `site_port` 设置成 `['80','443']`。
- 不要把 `ssl_data.db.ssl_info.use_for_site` 指向 DockerSite ID `13`；证书到期提醒需要普通站点兼容 ID `16`。
- 不要删除 `chat.dyxcloud.com` 证书目录，除非你准备重新申请证书。
- 如果容器重建，必须刷新 `docker.db.docker_sites.container_id`。
