# NextChat 仓库约定

> **全局规则入口**：除本文件约定外，本项目所有任务同时遵守 `/Users/dyx/ai_coding_rules/` 下规则；冲突时按"用户当前明确指令 > 当前项目规则（CLAUDE.md / AGENTS.md / GEMINI.md）> 用户长期偏好 > 专项规则 > 全局规则 > 项目已有代码风格 > 通用最佳实践"处理。
>
> - 规则总索引：`/Users/dyx/ai_coding_rules/README.md`
> - 用户偏好：`/Users/dyx/ai_coding_rules/user-preferences.md`
> - 核心全局规则：`/Users/dyx/ai_coding_rules/coding-global.md`
> - 部署专项：`/Users/dyx/ai_coding_rules/coding-deploy.md`
> - 数据库专项：`/Users/dyx/ai_coding_rules/coding-database.md`
> - 前端专项：`/Users/dyx/ai_coding_rules/coding-frontend.md`
> - Git 专项：`/Users/dyx/ai_coding_rules/coding-git.md`
> - HANDOFF 专项：`/Users/dyx/ai_coding_rules/coding-handoff.md`
> - 命令分类总入口：`/Users/dyx/ai_coding_rules/coding-commands.md`（含 8 个分类文件）

## 本地 Docker 开发

- 本项目本地 Docker 开发统一使用 `dev` profile
- 默认使用 [scripts/docker-compose-safe.sh](./scripts/docker-compose-safe.sh) 包装 `docker compose`
- 不要直接执行 `docker compose build`
  因为部分环境会在 `~/.docker/buildx/activity` 报权限错误；包装脚本会自动把 `BUILDX_CONFIG` 指向 `/tmp/nextchat-docker-buildx`
- 本地热加载测试默认免登录：启动或重建 `nextchat-dev` 时必须用命令行临时覆盖 `NEXTCHAT_DISABLE_AUTH=true`
- 本地免登录模式默认就是 `ccc` 用户，读写和操作都按 `ccc` 处理；用户切换等功能应保持正常
- 本地热加载读取远端聊天记录时，使用项目内 `postgres-ssh-tunnel` 容器连接服务器 PostgreSQL；本地用 SSH key 免密，不输入密码，`nextchat-dev` 用 `PGHOST=postgres-ssh-tunnel PGPORT=5432` 连接隧道服务
- 同理，独立备份库（`BACKUP_PGHOST`）也必须命令行覆盖为 `postgres-ssh-tunnel`，否则 `.env.docker` 默认的 `42.193.15.117` 是远程 PG 的公网 IP（PG 不监听公网，只监听 127.0.0.1 / Docker bridge），会导致 `/backup/api_config` 一直显示「暂无备份」且 `/backup/chat` 直接 500
- 远程部署、宝塔部署、生产环境必须恢复密码鉴权，不要把 `NEXTCHAT_DISABLE_AUTH=true` 写入 `.env.baota` 或生产环境变量
- 远程部署、宝塔部署、生产环境默认仍按正常鉴权进入 `admin`
- 启动命令：

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile ssh-tunnel up -d --build postgres-ssh-tunnel
NEXTCHAT_DISABLE_AUTH=true NEXTCHAT_LOCAL_BYPASS_USER=ccc PGHOST=postgres-ssh-tunnel BACKUP_PGHOST=postgres-ssh-tunnel PGPORT=5432 SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel up -d
```

- 查看日志：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev logs -f nextchat-dev
```

- 停止开发容器：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev down
```

## 热加载规则

- 普通业务代码修改后，不要重启容器，不要重新构建镜像
- 开发容器内使用 `next dev`，应依赖热加载生效
- 只有 `package.json`、`yarn.lock`、`Dockerfile` 变更时，才重新执行 `docker compose ... build`
- `WATCHPACK_POLLING` 和 `CHOKIDAR_USEPOLLING` 默认保持 `false`
- 只有在 Docker Desktop 等环境下文件监听不稳定时，才开启 polling

## 当前聊天 UI 交互约定

- 移动端流式输出时，用户轻微上滑应立即暂停自动贴底，不需要大幅滑动。
- 点击页面空白只收起输入焦点，不应触发自动回到底部。
- “回到底部”按钮采用类似点击标题滚到顶部的两帧滚动方式，避免虚拟消息窗口切换时出现大块空白。
- 点击标题滚到顶部时，即使正在流式输出，也必须暂停自动贴底。
- Token 用量行允许自动换行，窄屏或文本过长时不能撑破消息宽度。

## 临时文件和测试文件规则

- 不提交临时调试文件、历史 `.bak` 文件、截图/浏览器误生成的空 `div*` 文件。
- 当前仓库不维护 Jest 测试目录，`test/`、`jest.config.ts`、`jest.setup.ts`、`setup-test-data.js` 属于已清理内容。
- 不再使用 `yarn test` / `yarn test:ci` 作为默认验证命令；优先使用 `yarn lint`、`yarn build`、针对性脚本或手工验证。
- 后续浏览器手工测试、回归测试默认切换到 `ccc` 用户后再执行，除非用户明确指定其他账号。

## 生产部署

- 用户说“部署”时，默认部署到 SSH alias 为 `ss` 的服务器
- 默认部署路径为 `/www/dk_project/my_NextChat`
- 当前线上是宝塔 DockerSite 部署，必须使用 `docker-compose.baota.yml` + `.env.baota`
- 不要把线上宝塔部署切回 `.env.docker`、`--profile no-proxy` 或内置 PostgreSQL
- 长时间构建必须放入 `tmux`
- 每次部署默认允许替换旧 `nextchat` 容器和旧 `nextchat` 相关镜像，无需再次确认；范围仅限 `nextchat`、`nextchat-baota:latest`、`nextchat:latest`，不要执行全局 Docker prune
- 每次成功重建 `nextchat` 容器后，必须自动执行 `scripts/sync-baota-dockersite-container-id.sh`：脚本会先等待容器健康并写入 `deployment_metadata`，再备份 `/www/server/panel/data/db/docker.db`，仅更新 `docker_sites.name='chat.dyxcloud.com'` 这一条记录的 `container_id`，成功后清理上一轮 `docker.db.bak-nextchat-*` 备份并只保留本轮新备份，无需再次询问。这是部署固定步骤，不得扩大到其他表、站点、字段或备份前缀。

### 标准部署命令

```bash
ssh ss 'tmux new-session -d -s nextchat-baota-deploy "cd /www/dk_project/my_NextChat && git pull --ff-only && ./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota build nextchat && (docker rm -f nextchat 2>/dev/null || true) && (docker image rm nextchat:latest 2>/dev/null || true) && ./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota up -d --force-recreate nextchat && ./scripts/sync-baota-dockersite-container-id.sh 2>&1 | tee /tmp/nextchat-baota-deploy.log"'
ssh ss 'tmux capture-pane -t nextchat-baota-deploy -p -S -120'
ssh ss 'tail -120 /tmp/nextchat-baota-deploy.log'
```

### 宝塔 Compose 面板显示要求

- 宝塔面板读取 `/www/server/panel/data/compose/my_nextchat/docker-compose.yaml`
- 宝塔面板读取 `/www/server/panel/data/compose/my_nextchat/.env`
- 实际 Docker Compose project 必须使用 `03b890c97bdecc48c2294402d8768906`，即 `md5(my_nextchat)`，否则宝塔 Compose 页面可能显示 `exited`
- 重启当前镜像但不重建时使用：

```bash
ssh ss 'bash -s' <<'REMOTE'
set -euo pipefail
PROJECT=03b890c97bdecc48c2294402d8768906
COMPOSE=/www/server/panel/data/compose/my_nextchat/docker-compose.yaml
ENV=/www/server/panel/data/compose/my_nextchat/.env
/usr/bin/docker-compose -p "$PROJECT" -f "$COMPOSE" --env-file "$ENV" up -d --no-build
REMOTE
```

### 宝塔 DockerSite 关键路径

- 宝塔 DockerSite 数据库：`/www/server/panel/data/db/docker.db`，不要修改旧路径 `/www/server/panel/data/docker.db`
- 普通网站冲突记录：`/www/server/panel/data/db/site.db`，如果 `chat.dyxcloud.com` 在普通站点表残留，会阻止 DockerSite 创建
- DockerSite JSON：`/www/dk_project/sites/chat.dyxcloud.com/chat.dyxcloud.com.json`
- Nginx vhost：`/www/server/panel/vhost/nginx/chat.dyxcloud.com.conf`，反代必须是 `http://127.0.0.1:3000`
- SSL 证书：`/www/server/panel/vhost/cert/chat.dyxcloud.com/fullchain.pem` 和 `privkey.pem`，不要在没有新证书时删除
- DockerSite 注册脚本：`/www/dk_project/my_NextChat/scripts/baota-register-dockersite.py`，必须用 `/www/server/panel/pyenv/bin/python3` 执行

### 清理和重注册规则

- 清理前必须备份 `/www/server/panel/data/db/docker.db` 和 `/www/server/panel/data/db/site.db`
- 只清理 `chat.dyxcloud.com` 相关记录，不要清空整个 Docker 或宝塔数据库
- 部署时默认允许替换旧容器/镜像；只删除 `nextchat`、`nextchat-baota:latest`、`nextchat:latest` 相关对象，不要执行全局 Docker prune
- DockerSite 重注册优先执行：

```bash
ssh ss 'cd /www/dk_project/my_NextChat && /www/server/panel/pyenv/bin/python3 scripts/baota-register-dockersite.py'
```

### 验证步骤

```bash
ssh ss 'docker ps --filter name=nextchat --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}\t{{.Image}}"'
ssh ss 'curl -sS -i http://127.0.0.1:3000/api/db/health | head -20'
ssh ss 'nginx -t && curl -k -I https://chat.dyxcloud.com/ --max-time 20'
ssh ss 'cd /www/server/panel && /www/server/panel/pyenv/bin/python3 - <<"PY"
import sys, json
sys.path[:0]=["/www/server/panel/class","/www/server/panel"]
import public
from mod.project.docker.sites.sitesManage import SitesManage
get=public.to_dict_obj({"type":"all","p":1,"row":20,"classify":999,"query":"chat.dyxcloud.com"})
print(json.dumps(SitesManage().get_site_list(get), ensure_ascii=False, default=str)[:4000])
PY'
```

## 域名打不开的当前结论

- 如果服务器内 `curl -k -I https://chat.dyxcloud.com/` 返回 `HTTP/2 200`，但外部无代理访问 `chat.dyxcloud.com` 被 reset 或跳转到 DNSPod webblock，则不是 Docker/Nginx/证书问题，而是腾讯云/DNSPod/安全策略的域名公网链路拦截
- `https://42.193.15.117/` 能打开只代表 IP 默认站点可访问，不代表 `server_name chat.dyxcloud.com` 正常

## 宝塔详细 Runbook

- 详细部署、数据库和证书到期提醒修复步骤见 `docs/baota-chat-dyxcloud-runbook.md`。
- 特别注意：`ssl_data.db.ssl_info.use_for_site` 必须指向 `site.db.sites.id=16`，不是 DockerSite 的 `docker_sites.id=13`。

## Git 提交规则

- 每轮修改完成并通过必要验证后，默认执行一次 `git add -A`；暂存前后检查范围，不加入密钥、真实 `.env`、临时产物或明显无关内容。自动暂存不授权 commit、push 或部署。
- 不允许自动提交。只有用户明确单独说出"提交"或"commit"时才能执行提交。
- 用户明确单独说出"提交"或"commit"时，默认表示**提交并推送**；如果用户只说"推送"或"push"，表示推送当前已提交内容。
- 用户在其他语境中提到"提交""推送"等词（如"我说提交时，就..."）不视为执行命令；只有明确下达执行指令时才执行。
- 本仓库同时使用 GitHub 和 Gitee。执行推送时必须检查远程配置，并将当前分支分别推送到 GitHub（`origin`）和 Gitee（`gitee`），不能只依赖单个远程的默认 push 行为。
- 执行拉取或部署前，必须分别获取并检查 GitHub 与 Gitee 的目标分支；确认两端目标提交一致后，才允许继续构建或部署。
- 生产服务器的 `origin` 当前指向 Gitee。部署前必须先确认 Gitee 已包含本地待部署提交，并在服务器 `git pull --ff-only` 后核对 `HEAD` 与待部署提交一致。
- 每次工作完成后检查本地仓库与生产服务器仓库的全部 Git stash；如需清空、drop 或 pop，必须先逐条读取，并用直白语言逐文件说明每个 stash 修改了什么，取得用户针对本次具体清单的明确确认后才能删除。未确认时只报告，不清理。
- 每次工作完成后必须核对本地、GitHub、Gitee与生产服务器的目标分支提交；在用户已授权的提交/推送或部署范围内，将各端更新到同一最新提交并确认工作区干净。未获得相关授权时，只报告差异，不擅自推送或部署。

## 部署执行规则

- 不允许自动部署。只有用户明确单独说出"部署"或"deploy"时才能执行部署操作。
- 用户在其他语境中提到"部署"不视为执行命令。

## AI 部署注意事项

- 构建时优先使用仓库内置的 `vendor/rt-client-0.5.0.tgz`
- 默认关闭 Google Fonts、ShareGPT、MCP 市场、Edge TTS 等海外运行期依赖，除非用户明确要求开启
- 如果 Docker 生产构建失败，先检查 `buildx`、`.dockerignore`、构建上下文和环境变量，不要先假设是外网问题
- 版本号来自 `package.json`；如果页面里出现 `vundefined`，先检查 `package.json` 的 `version`
- 如果宿主机访问 `127.0.0.1:3000` 异常，但容器日志显示 `Ready`，先在容器内执行 `wget http://127.0.0.1:3000`，再判断是不是宿主机代理或端口转发干扰

## 删除操作强制确认规则

**所有删除动作都必须用户单独确认**，不得用「清理过期」「顺手」「按规则」等理由批量执行。

覆盖范围（与全局 §16.3 一致）：

- **文档 / 脚本 / 配置**：`git rm`、`rm` 删除 `docs/`、`scripts/`、`*.yml`、`*.json`、`*.ts`、`*.tsx`、`.env*`、`Dockerfile`、`next.config.mjs`、`tsconfig.json`、`package.json`、`yarn.lock`、`.github/**` 等；删除前必须**列出每个具体路径**，逐项等待用户确认。
- **数据库 / Schema**：`DROP TABLE / DATABASE`、`TRUNCATE`、`DELETE FROM ... 无 WHERE`、`ALTER TABLE DROP COLUMN / CONSTRAINT`、直接 SQL 修改宝塔数据库（docker.db / site.db / ssl_data.db）；删除前必须打印 SQL + 影响行数 + 备份状态。
- **容器 / 镜像 / 卷 / 网络**：`docker rm / rm -f`、`docker image rm`、`docker volume rm`、`docker network rm`、`docker system prune`；删除前必须列出每个具体名称；**禁止全局 prune**。
- **构建产物 / 缓存**：`rm -rf .next / dist / build / node_modules`、`yarn cache clean`、`docker builder prune`。
- **Git stash / branch / tag / reflog**：`git stash drop`、`git branch -D`、`git tag -d`、`git reflog expire --expire=now --all`、`git filter-branch / filter-repo`。
- **远程推送 / 强推**：`git push --force`、`git push --force-with-lease`、`git push origin --delete <branch>` 一律禁止，需逐项单独授权；普通 `git push` 仅在用户明确执行"提交"/"commit"或"推送"/"push"时允许。
- **宝塔数据库 / 配置 / 证书**：docker.db / site.db / ssl_data.db 的 DELETE / UPDATE / INSERT、Nginx vhost、证书目录。

唯一例外：在用户明确授权的 NextChat 生产部署中，容器健康后自动执行
`scripts/sync-baota-dockersite-container-id.sh`，对已备份的 `docker.db` 执行唯一定向
`UPDATE docker_sites SET container_id=? WHERE name='chat.dyxcloud.com'`，并在成功后只清理上一轮
`/root/docker.db.bak-nextchat-*` 备份、保留本轮最新备份，不需要逐次确认。除此之外的任何宝塔数据库修改或文件删除仍必须逐项确认。

执行要求：

1. 涉及上述任何一类，AI 必须**先列出待删除 / 修改的对象清单**（路径 / SQL / 命令 + 影响），逐项等待用户 Yes / No。
2. 用户单字回答「是 / 好 / 继续」**只对当时列出的那一项有效**，不能延伸到下一项。
3. 删除前**必须先备份**（`cp -a <path> /root/<path>.bak-<TS>` 或 `git mv` 到暂存区），备份是默认行为，不是可选项。
4. 最终交付摘要必须**逐行列出已删除对象**，便于用户审计。
5. 当用户明确说出「这次的全部都要」时，AI 必须先完整列出本次剩余删除对象及影响，并再发起一次批量确认；用户确认后，该次确认可覆盖清单内全部对象，无需继续逐项询问。此授权仅对当次明确列出的清单有效，新增对象仍须重新确认。

凡是以上任一类操作跳过单独确认直接执行，等同违反本规则。详见 `~/.claude/CLAUDE.md`（或对应全局 AI md）的 §16.3。

## 文档同步规则（每完成一个功能立即更新文档 + 删除多余文档）

- 任何新增 / 修改 / 删除的功能、页面、API、数据库表、配置项，都必须在**同一轮 commit 内**同步**更新文档**，不允许只改代码留下一份过期文档留给下次清理。
- **更新文档**优先列表：`README.md`、`docs/development.md`、`docs/db/data-storage-sync-matrix.md`、`docs/db/nextchat-postgres-schema.sql`、`docs/db/local-first-sync-rules.md`、`docs/sync-usage-guide.md`、`docs/user-manual-cn.md`、`docs/yuto-balance-query.md`、各专题 Runbook；新增或重命名的文档必须在 `README.md` 的「文档入口」登记。
- **删除多余 / 过期文档**：删除 / 重命名页面或文档时，必须彻底移除对应文件并从所有 README / 文档入口清除死链，不保留为「历史背景」。过期 / 临时 / 历史修复总结类文档（fix-*.md、*-summary.md、current-database-audit-*.md 等）如果已经没有参考价值，直接删除；如必须保留作历史参考，须在文档顶部明确标注「⚠️ 已过时，以 *最新文档* 为准」并指向权威文档链接。
- schema 版本、表结构、字段、数据矩阵和顶部「以代码为准」日期必须与代码同步更新；新增 DDL 时同步修改 `docs/db/nextchat-postgres-schema.sql`。
- 提交或部署前必须自检：所有新增 / 修改的功能点是否都有对应文档段落；README 文档入口是否仍然完整；是否存在可以删除的过期文档。
- 不为了凑文档而堆模板；只写仍然准确、能帮助未来 AI / 工程师快速理解的内容。

每次完成代码修改后都解决lint问题
每次完成代码修改后都确保容器是最新代码
