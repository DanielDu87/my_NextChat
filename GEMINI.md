# NextChat 项目指南

本文件供 Gemini CLI/兼容 AI 代理读取，规则需与 `AGENTS.md`、`CLAUDE.md` 保持一致。

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

## 项目概览

NextChat 是基于 Next.js 14、React、TypeScript、Zustand、PostgreSQL 和 SCSS Modules 的跨平台 AI 聊天应用，支持 Web/PWA 与 Tauri 桌面端。内置聊天、AI 绘画（Draw）、实时语音、MCP 工具、插件、Artifacts 等功能，支持 18 个模型供应商与多 API Key 轮询。模型获取会按 Key 指纹缓存成功路径，模型商分组会修复 Ocoolai 等旧缓存中的伪 vendor。云端数据持久化在 PostgreSQL，本地业务数据在 IndexedDB。更完整的架构导航见 [CLAUDE.md](./CLAUDE.md)。

## 目录结构

- `app/`：Next.js 应用核心代码。
- `app/components/`：聊天界面、设置、绘画（`draw/`）、实时语音（`realtime-chat/`）等组件。
- `app/store/`：Zustand 状态管理（chat、config、access、auth、draw、mask、sync 等）。
- `app/client/`：各模型 Provider 客户端（`platforms/` 下当前有 15 个实现）。
- `app/utils/server/`：服务端数据库 Repository 层（PostgreSQL 连接与各 `*-repository.ts`）。
- `app/api/`：服务端 API 路由（提供商代理、`db/*` 同步、`auth/*` 认证等）。
- `scripts/`：部署、数据库维护、模型同步等脚本。
- `docs/`：中文文档与 Runbook。

## 开发与部署约定

- 本地 Docker 开发统一使用 `dev` profile，不默认使用 `local-db`。
- 默认使用 `./scripts/docker-compose-safe.sh` 包装 `docker compose`，不要直接执行 `docker compose build`。
- 普通业务代码修改后依赖热加载，不重启容器、不重建镜像。
- 只有 `package.json`、`yarn.lock`、`Dockerfile` 变更时才重新 build。
- 生产部署默认走宝塔 DockerSite：`docker-compose.baota.yml` + `.env.baota`。
- 用户说“部署”时，默认部署到 SSH alias `ss`，路径 `/www/dk_project/my_NextChat`。

## 常用命令

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile ssh-tunnel up -d --build postgres-ssh-tunnel
NEXTCHAT_DISABLE_AUTH=true NEXTCHAT_LOCAL_BYPASS_USER=ccc PGHOST=postgres-ssh-tunnel PGPORT=5432 SSH_TUNNEL_HOST=42.193.15.117 SSH_TUNNEL_PORT=222 SSH_TUNNEL_USER=root SSH_TUNNEL_KEY_FILE=$HOME/.ssh/id_ed25519 ./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev --profile ssh-tunnel logs -f nextchat-dev
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev down
```

构建与检查：

```bash
yarn build
yarn lint
npx tsc --noEmit --pretty false
```

说明：本仓库已移除 Jest 测试脚本和 `test/` 目录，不要再引用 `yarn test` / `yarn test:ci` 作为默认验证方式。

## 当前聊天 UI 注意事项

- 移动端流式输出时，用户轻微上滑应立即暂停自动贴底。
- 点击页面空白不应触发自动回到底部。
- “回到底部”按钮使用类似点击标题滚到顶部的两帧滚动方式，避免虚拟消息窗口切换时出现大块空白。
- 点击标题滚到顶部时，即使正在流式输出，也必须暂停自动贴底。
- Token 用量行允许自动换行，窄屏或文本过长时不能撑破消息宽度。

## Git 与清理规则

- 不要自动提交；只有用户明确要求“提交/commit”时才执行提交并推送。
- 任何 stash 清空、drop 或 pop 前，必须逐条读取，并用直白语言逐文件说明每个 stash 修改了什么；只有用户针对本次具体清单明确确认后才能删除。
- 提交信息格式：`YYYY-MM-DD HH:MM 内容`。
- 不提交临时调试文件、历史 `.bak` 文件、空 `div*` 文件和一次性测试文件。

## 删除操作强制确认规则

**所有删除动作都必须用户单独确认**，不得用「清理过期」「顺手」「按规则」等理由批量执行。完整规则见全局 `~/.gemini/GEMINI.md`（或对应全局 AI md）§16.3，本节列重点：

例外：当用户明确说出「这次的全部都要」时，必须先完整列出本次剩余删除对象及影响，并再发起一次批量确认；用户确认后，该次确认可覆盖清单内全部对象。此授权仅对当次列出的清单有效。

- **文档 / 脚本 / 配置**：`docs/`、`scripts/`、`*.yml`、`*.json`、`*.ts`、`*.tsx`、`.env*`、`Dockerfile`、`next.config.mjs`、`tsconfig.json`、`package.json`、`yarn.lock`、`.github/**` 等；**逐路径列出**让用户确认，**不能批量删除**。
- **数据库 / Schema**：`DROP TABLE / DATABASE`、`TRUNCATE`、`DELETE FROM ... 无 WHERE`、`ALTER TABLE DROP COLUMN / CONSTRAINT`、直接 SQL 修改宝塔数据库（docker.db / site.db / ssl_data.db）；删除前必须打印 SQL + 影响行数 + 备份状态。
- **容器 / 镜像 / 卷 / 网络**：`docker rm / rm -f`、`docker image rm`、`docker volume rm`、`docker network rm`、`docker system prune`；**禁止全局 prune**。
- **构建产物 / 缓存**：`rm -rf .next / dist / build / node_modules`、`yarn cache clean`、`docker builder prune`。
- **Git stash / branch / tag / reflog**：`git stash drop`、`git branch -D`、`git tag -d`、`git reflog expire --expire=now --all`、`git filter-branch / filter-repo`。
- **远程推送 / 强推**：`git push --force`、`git push --force-with-lease`、`git push origin --delete <branch>` 一律禁止；普通 `git push` 仅在用户明确执行“提交/commit”或“推送/push”时允许。
- **宝塔数据库 / 配置 / 证书**：docker.db / site.db / ssl_data.db 的 DELETE / UPDATE / INSERT、Nginx vhost、证书目录。

执行要求：删除前必须先备份（`cp -a <path> /root/<path>.bak-<TS>` 或 `git mv` 到暂存区）；最终交付摘要逐行列出已删除对象；用户单字确认「是 / 好 / 继续」**只对当下那一个具体项有效**。

## 文档同步规则（每完成一个功能立即更新文档 + 删除多余文档）

- 任何新增 / 修改 / 删除的功能、页面、API、数据库表、配置项，都必须在**同一轮 commit 内**同步**更新文档**，不允许只改代码留下一份过期文档留给下次清理。
- **更新文档**优先列表：`README.md`、`AGENTS.md`、`CLAUDE.md`、各专题 `docs/*.md`；新增或重命名的文档必须在 `README.md` 的「文档入口」登记。
- **删除多余 / 过期文档**：删除 / 重命名页面或文档时，必须彻底移除对应文件并从所有 README / 文档入口清除死链，不保留为「历史背景」。过期 / 临时 / 历史修复总结类文档（fix-*.md、*-summary.md、current-database-audit-*.md 等）如果已经没有参考价值，直接删除；如必须保留作历史参考，须在文档顶部明确标注「⚠️ 已过时，以 *最新文档* 为准」并指向权威文档链接。
- schema 版本、表结构、字段、数据矩阵和顶部「以代码为准」日期必须与代码同步更新；新增 DDL 时同步修改 `docs/db/nextchat-postgres-schema.sql`。
- 提交或部署前必须自检：所有新增 / 修改的功能点是否都有对应文档段落；README 文档入口是否仍然完整；是否存在可以删除的过期文档。
- 不为了凑文档而堆模板；只写仍然准确、能帮助未来 AI / 工程师快速理解的内容。
