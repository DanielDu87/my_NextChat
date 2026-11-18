# HANDOFF

记录最近 10 条关键修改。最新记录置顶，历史从新到旧排列。每条记录标题格式为 `## 序号. 【YYYY-MM-DD HH:MM】- 标题`，序号持续递增，最大 999，达到后从 1 开始。超过 10 条时自动删除底部最旧记录。实质修改完成并验证后更新一次，创建 commit 前核对并一起提交.

============================================================

## 248. 【2026-11-18 22:13】- 构建包装器拒绝无法透传的参数

### 修改内容

- 构建分支遇到缺值或不支持的 Compose 全局参数时以非零退出。

### 实现方式

- 保留支持的参数透传和项目既有的显式调用方式。

### 验证

- 通过 sh -n 和差异检查。

### 潜在或遗留问题

- 本轮未重建或重启 NextChat。

============================================================

## 247. 【2026-11-18 15:15】- 修复本地构建下载和启动依赖复用

### 修改内容

- 锁文件只替换 1106 个远程下载主机，入口按清单摘要复用镜像依赖。

### 实现方式

- 依赖版本、哈希和本地 vendor 引用保持原值。

### 验证

- 本地 ./run 返回 0，三个容器健康，宿主 /api/config 返回 200。

### 潜在或遗留问题

- 未触发生产部署。

============================================================

## 246. 【2026-11-18 13:47】- 统一 run 启动日志和访问摘要

### 修改内容

- 替换启动阶段的阻塞等待，健康检查与服务日志并行。

### 实现方式

- 保留安全 Compose 包装器、本地免登录和远端数据库 SSH 隧道。就绪摘要显示前端和 API 核验入口。

### 验证

- 相关 run 脚本通过 bash -n，仓库差异通过 git diff --check。

### 潜在或遗留问题

- 未启动项目或运行功能测试。

============================================================

## 245. 【2026-11-18 11:28】- 重复运行时停止上一轮构建

### 修改内容

- `run` 按项目路径识别上一轮脚本并向其子进程发送 SIGTERM，等待退出后继续。构建完成并通过原有前置检查后再切换旧容器，保留数据卷。

### 验证

- `bash -n run` 和 `git diff --check -- run` 通过。尚未执行真实构建、重启或进程终止测试。

### 潜在问题

- 旧进程超时未退出时，本轮启动中止。已脱离原进程树的进程无法按父子关系识别。

### 实现方式

- 待补充（原记录缺失，未推断事实）。

### 潜在或遗留问题

- 待补充（原记录缺失，未推断事实）。

============================================================

## 244. 【2026-11-04 15:42】- Dockerfile 依赖缓存改造：cache mount 补 id、syntax 固定 1.7

### 修改内容

- 根 `Dockerfile`：`# syntax` 由 `docker/dockerfile:1` 固定为 `docker/dockerfile:1.7`；已有三处 cache mount 补项目化 id——`id=nextchat-yarn-cache`（dev 与 deps 阶段的 yarn 缓存，target `/usr/local/share/.cache/yarn`）、`id=nextchat-next-build-cache`（builder 阶段 `.next` 缓存，target `/app/.next/cache`）。此前无 id，缓存按 target 路径全局共享，多项目会互相污染。
- `scripts/code-interpreter/Dockerfile`：`# syntax=docker/dockerfile:1.7`；pip 安装层加 `--mount=type=cache,id=nextchat-code-interpreter-pip,target=/root/.cache/pip`，并去掉与 cache mount 冲突的 `--no-cache-dir`。
- `docker/postgres-ssh-tunnel/Dockerfile` 只有 `apk add`，无依赖安装，不需要 cache mount，未改。
- 基础镜像仍是 `ARG NODE_IMAGE` / `ARG PYTHON_IMAGE` 注入的官方名，未写入加速域名；构建仍经 `scripts/docker-compose-safe.sh` → 全局构建入口。
- 本轮一并入库本地开发入口 `run` 与 `docker-compose.run.yml`（早前生成、本轮与全局模板对齐后提交）：选项菜单拒绝参数、只读审计先行、软件依赖源探测独立于镜像选源、构建经全局入口（常驻 builder 依赖缓存）、SSH 隧道与免登录覆盖仅进程内生效；配套 `.dockerignore`/`.gitignore`/`README`/`docs/development.md`/`scripts/docker-compose-safe.sh` 同批更新。

### 实现方式

- cache mount 的内容存在 BuildKit builder 状态卷里；全局构建入口默认启用常驻 builder `docker-build-cache`，依赖缓存才能跨构建命中。NextChat 原有的 cache mount 没有 id，BuildKit 会按 target 路径派生全局 id，多项目共用同一缓存目录；补上项目化 id 后互不干扰。
- 基础镜像与 source 策略仍由全局构建入口按当次测速结果决定，Dockerfile 内不写加速域名。

### 验证

- `docker buildx build --check`：根 `Dockerfile` 仅剩 1 个既有 warning（`CMD` 建议 JSON 形式，源于原有的 proxychains shell 形式启动命令，非本次改动引入）；`scripts/code-interpreter/Dockerfile` 通过。

### 潜在或遗留问题

- 本次未对 NextChat 做真实构建验证（用户要求加快节奏，长构建被中止）；改动为 Dockerfile 指令层（syntax 与 cache mount id），镜像内容不变，建议下次 `docker compose-safe.sh --profile dev build` 时确认。
- 新的 cache mount id 首次使用为空缓存，第一次构建会重新填充（一次性成本）；之后依赖层重建不再重复下载。
- 本仓库未提交（用户未授权提交）。

============================================================

## 243. 【2026-10-22 14:10】- 修复绘图记录被新浏览器覆盖为空、恢复 admin 绘图记录、补生产 pg_dump 备份

### 修改内容

- `app/utils/sync.ts` DrawList 合并改为按记录 id 取三方并集（本地 / 内存 / 远端），`deletedTaskIds` 同样取并集（最多 300 条）并写回，合并结果按 `requestedAt` 倒序；不再因本地 `lastUpdateTime` 较新就整体丢弃远端记录。
- `app/styles/globals.scss`：暗色模式下危险按钮图标恢复历史灰色（仅危险按钮保留 `invert(0.5)`），`/api_config` 暗色按钮行与优化前像素一致。
- 经用户确认：`app/components/auth.module.scss`、`tts.module.scss` 移到废纸篓；删除临时容器 `nextchat-login-preview`、`nextchat-baseline` 与卷 `nextchat_preview_node_modules`。
- 生产服务器新增 root crontab `30 3 * * * /www/backup/database/pgsql/nextchat-pgdump.sh`（`nextchat` + `nextchat_backup`，`pg_dump -Fc` + `pg_restore --list` 校验，权限 600，全部成功才清理 14 天前备份），已手动运行一次：nextchat 150M、nextchat_backup 18M。原 crontab 备份在 `/root/crontab-root.bak-*`。
- 文档：`docs/development.md` 新增「绘图记录同步合并（DrawList）」；`README_BAOTA.md` 第 12 节写明备份任务与恢复命令。

### 实现方式

- 根因：DrawList 合并策略“`remoteUpdateTime > localUpdateTime` 才用远端”。新浏览器启动阶段任意一次 `markUpdate()` 都会让本地空状态显得更新，结果用本地 0 条覆盖远端；HEAD 既有问题，12:03 第二次覆盖发生在用户新打开的 Edge 标签页。
- 修复后先刷新 Edge 中的 127.0.0.1:3000 标签页加载新代码，再按上次已确认的方案恢复 admin 的 6 条记录（带版本校验 PUT，只替换 `draw`）。
- `!important` 批量清理按“基线快照 → 去除 → 计算样式差异 → 归因恢复”迭代尝试，未能收敛（见遗留问题），已逐文件校验只差 `!important` 后完整回退。

### 验证

- 容器内 `npx tsc --noEmit` 通过。
- 全新浏览器（拦截真实写库、记录上传内容）依次访问桌面 `/chat`、移动端 `/draw`、`/draw/history`：3 次 draw-list 上传均为 6 条，历史页显示 6 条，服务端仍为 6 条。
- `!important` 回退后 70 个状态计算样式与基线一致（残留差异仅为当前模型名称变化导致的标题宽度和备份列表数据变化，截图核对一致）。

- 2026-10-22 15:58 已部署 `fe384583` 到宝塔生产（DEPLOY.md 标准流程，tmux 会话 `nextchat-baota-deploy`，`DEPLOY_EXIT=0`）：容器 healthy；`docker.db` 定向同步备份 `/root/docker.db.bak-nextchat-20261022-155849`；`fix-pg-hba.sh` 添加 `172.20.0.0/16` 规则（原文件备份 `pg_hba.conf.backup.20261022155857`）。线上 `/`、`/chat`、`/draw/history` 200，`/api/db/health` `{"ok":true}`，匿名访问 `/api/proxy`、`/api/tencent` 返回 401、`/api/model-probe` 在 JSON 内返回 401；线上登录页为新设计、无页面错误。回滚镜像 `nextchat-baota:rollback-82aecd2c`（部署前的 latest）。
- 本次镜像构建约 40 分钟：Dockerfile 基础镜像由 daocloud 前缀改为官方名后缓存失效，apk 安装 201 个编译依赖时单连接仅约 70 KB/s；后续部署可复用缓存。

### 潜在或遗留问题

- `!important` 未减少（仍约 2259 处）：自动化尝试中去除 911 处“全部选择器都被测试命中”的候选后，归因恢复迭代 3 轮差异仍在 3.5k–12k 之间浮动（大量规则互相依赖 `!important` 争优先级，单点恢复会暴露新的冲突），且测试覆盖不到下拉菜单、弹窗、禁用、聚焦等状态。需要改为逐组件人工重构（先合并公共类与组件模块的重复声明，再去 `!important`），不适合批量处理。
- 开着旧代码的浏览器标签页仍可能按旧合并逻辑上传；所有标签页刷新一次后才完全安全。

============================================================

## 242. 【2026-10-22 12:45】- 修复本地获取模型与余额全部网络失败（容器 DNS 阻塞线程池）

### 修改内容

- 新增 `scripts/dev-ipv4-first-dns.cjs`：未指定 family 的 `dns.lookup` 先只查 IPv4，失败回退原始解析。
- `docker-compose.yml` 的 `nextchat-dev` 增加 `NODE_OPTIONS=--max-old-space-size=4096 --require /app/scripts/dev-ipv4-first-dns.cjs` 与 `UV_THREADPOOL_SIZE=64`；生产服务不变。
- 文档：`docs/development.md` 新增「本地容器 DNS 与线程池」，CLAUDE.md 开发小节补充说明。

### 实现方式

- 根因：宿主机 Shadowrocket DNS 对 `nexus.itssx.com` 只应答 A 不应答 AAAA，musl `getaddrinfo` 等 AAAA 5s 后整体 `EAI_AGAIN`；Node `dns.lookup` 占用默认 4 线程的 libuv 池，4 个慢解析即让 `postgres-ssh-tunnel` 解析排队 10s，触发 PG 连接超时，连带所有供应商的模型获取 / 余额查询和 `/api/db/health` 超时。独立 Node 进程直连数据库正常，证明不是隧道或数据库问题。
- 在一次性容器中分别验证：只加大线程池可消除连带超时但 Nexus 仍失败；IPv4 优先解析让 Nexus 7ms 解析成功；两者组合后再接入 compose。

### 验证

- 重建 `nextchat-dev` 后 `/api/db/health` 200（1.1s），日志 0 次 PG 重试。
- `POST /api/db/provider-balance`：Nexus 返回余额（2.7s，此前 470s 后中止），AGICTO 0.47s。
- 经 `/api/proxy` 获取模型：Nexus 9、DeepSeek 2、AihubMix 677、AGICTO 224。

### 潜在或遗留问题

- 属本机网络环境问题（代理 DNS 不应答 AAAA），生产未受影响也未修改；若换网络/代理后仍有个别域名解析慢，线程池已不会再被拖垮。

============================================================

## 241. 【2026-10-22 02:22】- 全局样式统一、设计 token 与登录页重新设计

### 修改内容

- `app/styles/globals.scss` 新增设计 token：文字层级 `--text-secondary/muted/placeholder`、`--surface-muted`、`--border-subtle`、`--icon-color`，圆角 / 动效 / z-index 刻度；全部 SCSS 的圆角、过渡时长字面量收敛到 token（离刻度 1-2px 的值就近吸附）。**字体与字号按用户要求已全部恢复为原值**（字体栈、9/10/11/17px 等字面量与 HEAD 编译产物逐选择器一致，`--font-*` 变量已移除）。
- 修复缺陷：约 60 处未定义 CSS 变量（`--black-alpha-*`、`--black-2`、`--gray-*`、`--bg-color`、`--window-header-height` 等）；按钮配色曾提升到 WCAG AA，**按用户要求已恢复为原配色**（`--primary-button-*`、`--danger-*`、`--backup-green*` 与 HEAD 一致）；`home.tsx` 水合前沿用预加载主题，修复深色用户首屏 dark→light→dark 闪烁；超大 z-index（被浏览器截断成同值）改为有序刻度；移动端断点 600/700px 统一为 650px（与 `MOBILE_MAX_WIDTH` 一致）。
- 暗色模式只由 `.light/.dark` class 驱动：删除永不命中的 `body:not(.light):not(.dark)` 系统暗色分支、依赖系统配色的 `prefers-color-scheme` 分支和 `.dark`/`body.dark` 重复选择器；`globals.scss` 中失效的 `:global(body.dark)` 规则改为 `body.dark` 后生效；绘画页暗色规则尊重 `data-draw-theme="light"`（修复全局深色 + 绘画浅色时否定提示词框变黑）。
- 移除暗色全局 `div:not(.no-dark)>svg { filter: invert(0.5) }`；`app/icons` 单色图标 `#333` 改为 `var(--icon-color, #333)`（属性写法由 `:where([stroke="#333"])` 兜底），彩色图标在暗色下保留原色。
- 键盘焦点环（`:where(button, a, …):focus-visible`）、`prefers-reduced-motion` 兜底、100vh → 100dvh、卡片鼠标光斑只在悬停时出现。
- 删除 81 个从未被组件引用的 CSS Module 类及其规则（含 mcp-market 旧配置表单、provider-balances attempt*、api-config mobileOnly* 等）；文件预览样式从 `chat.module.scss` 拆到 `app/components/file-preview.module.scss`（`file-preview.tsx`、`hooks/useFilePreview.tsx` 改为引用新模块，`attach-file-*` 仍在 chat.module）。
- 登录页 `site-password-gate.tsx/.module.scss` 重新设计：左对齐表单 + 字段标签、`autocomplete=username/current-password`、显示/隐藏密码正确的 `aria-label`/`aria-pressed`、大写锁定提示、`role=alert` 错误条、加载 spinner、深浅色适配。
- 文档：CLAUDE.md「设计 token」小节与关键组件、README 聊天界面文件列表、docs/development.md 文件预览样式位置。

### 实现方式

- 批量改写用一次性脚本（注释感知的 SCSS 块解析）完成：token 吸附、死选择器删除、暗色重复选择器去重、文件预览样式按“选择器只含 file-preview/docx-preview/xlsx-preview 类”拆分；每步后 sass 全量编译 + HEAD 选择器对比兜底。
- 截图对比用 HEAD 快照容器（3001）与当前热加载容器（3000）；视觉测试脚本在浏览器层拦截 PUT/POST/DELETE（仅放行 `/api/config`、`/api/db/chat-sync/sessions`），避免全新上下文把空状态同步回库。

### 验证

- 34 个 SCSS 文件 sass 编译 0 错误；HEAD 与当前编译产物逐选择器对比，所有删除均可由死类 / 重复 `.dark` / 死暗色分支解释，新增均为预期规则。
- 容器内 `npx tsc --noEmit` 通过；`next lint` 仅既有 `<img>` 提示；变量引用检查 0 个未定义变量。
- Playwright（Chrome Beta，拦截全部写请求）截图核对 14 个页面 × 桌面/移动 × 浅/深色，另测模型选择器层级、悬停光斑、键盘焦点、绘画页主题；登录页在开启鉴权的独立预览容器（3002）中截图核对四种状态与错误态。
- TSX/MD 经 `format.sh`、SCSS 经 prettier 格式化后复核编译与截图无差异。

### 潜在或遗留问题

- 本轮测试早期未拦截写请求，全新浏览器上下文访问移动端 `/draw` 触发既有同步竞态，把 **user:admin**（本地免登录绘画同步落在 admin）的 `user_draw_stores` 覆盖为空（2026-10-21T15:38:50Z）。服务器无 pg_dump 备份，已用 Edge 中 chat.dyxcloud.com 的 IndexedDB 副本（2026-09-29，6 条，与覆盖前截图一致、图片均属 admin）经 `PUT /api/db/sync/draw-list`（带 expected 版本校验）只恢复 `draw` 字段，2026-10-22 已验证页面显示 6 条且图片可加载；恢复前原行备份在 `/tmp/ncaudit/idb/admin_draw_store_before_restore.json`（2026-10-22 经用户确认整个 `/tmp/ncaudit` 已移到废纸篓）。竞态本身（读到远端数据后又写回本地默认状态）未修复；服务器 `/www/backup/database/pgsql` 为空，宝塔 pg_dump 计划任务实际未产出备份，需要补配。
- `!important`（约 2300 处）未批量移除：组件模块与公共类互相以 `!important` 竞争优先级，静态截图无法覆盖 hover/禁用等全部状态，批量移除需单独排期逐文件回归。
- `auth.module.scss`、`tts.module.scss` 已经用户确认移到废纸篓；`/settings` 桌面端空白为 HEAD 既有行为，未改。
- 临时容器 `nextchat-baseline`、`nextchat-login-preview` 已停止未删除，卷 `nextchat_preview_node_modules` 与 `/tmp/ncaudit` 已经用户确认清理（容器/卷已删除，目录移到废纸篓）。
- 全局 `format.sh` 不识别 `.scss` 扩展名，本次直接用注册表 CSS 族的 prettier 执行。

============================================================

## 240. 【2026-10-22 01:58】- 全面安全审计修复：鉴权、代理、MCP、流式性能与依赖

### 修改内容

- MCP Server Actions（`app/mcp/actions.ts`）每个导出函数校验 `ENABLE_MCP` 与登录态，增删改/暂停/恢复/重启仅管理员（本地免登录放行）；修复未登录即可远程启动任意 stdio 命令的问题。
- `nextchat_effective_user` 切换用户 cookie 只对管理员会话生效；非法 UUID 不再导致全部接口 500；畸形 cookie 值不再抛错；登录改用异步 scrypt。
- `/api/proxy` 要求登录，校验 http/https，拒绝 `169.254.0.0/16`、`fe80::/10`、`metadata.google.internal`；服务端 OpenAI Key 仅在主机名精确为 `api.openai.com` 时附带；请求体先缓冲（自适应重试可重发 POST）、合并客户端断开与 10 分钟超时信号、自适应缓存上限 200 并修复命中缓存后 path 多一段 `v1/` 的问题。
- `/api/[provider]/*`、`/api/tencent`（改为 nodejs runtime）、`/api/model-probe` 要求登录；model-probe 用解析后的 pathname 校验白名单并转发 cookie。
- 共享 Plugin store 仅管理员可写（403 `admin_only_store`）；插件编辑器内容按纯文本渲染；`file-preview` 图片回退改用 DOM API，消除文件名 XSS。
- 流式输出期间会话 IndexedDB 落盘节流为 1 秒、结束后立即落盘；侧边栏、`useHotKey` 与聊天页辅助组件改为按需订阅。
- PG 重试只在连接层错误且池未被他人重建时关闭连接池（主库与备份库）；`GET /api/db/sync/[key]` 降级改返回 503；sync PUT 与 cache upload 先鉴权并按 Content-Length 预检；移除 cache upload 调试埋点；`/api/db/health` 匿名只返回 `ok`；服务端日志不再打印 API Key 明文。
- `scripts/docker-compose-safe.sh` 解析改在函数内，未识别参数降级原生构建时不再丢失 `-f/--env-file/--profile`。
- 依赖：`xlsx` 升级为仓库内置 `vendor/xlsx-0.20.3.tgz`（修复 CVE-2023-30533 / CVE-2024-22363）；移除 `@ai-sdk/anthropic`、`node-fetch`、`concurrently`、`watch`、`ts-node`、jest 与 `@testing-library/*`；显式声明 `markdown-to-txt` 实际依赖的 `lodash`。
- 经用户确认删除死代码 `app/utils/database-state-storage.ts`、`app/api/site-auth/route.ts`、`app/utils/server/site-password.ts`（备份于 `/tmp/nextchat-deleted-backup-20261021232130/`，原文件在废纸篓）；`site_access_settings` 标为遗留表不再创建。
- `.gitignore` / `.dockerignore` 增加 `.zcode/`、`.dbg/` 等 AI 产物；同步 CLAUDE.md、README.md、README_BAOTA.md、docs/development.md、docs/db schema 文档。

### 实现方式

- 鉴权统一复用 `app/utils/server/auth.ts`：路由用 `requireAuthContext(req)`，模型代理经 `app/api/auth.ts` 新增的 `requireApiSession`，MCP Server Actions 经 `next/headers` 的 `headers()` 取 cookie；管理员判断沿用 switch-user 的「免登录模式放行」约定。
- 共享 store 写权限在 `sync-user.ts` 的 `requireWritableStoreSyncUserId` 中按 `ADMIN_ONLY_WRITE_STORE_KEYS` 收口，客户端同步按单 key 失败处理，不影响其他 store。
- 流式节流放在 `chat.ts` 的 `updateTargetSession`：存在 `streaming` 消息时按会话 id 设 1 秒定时器，触发时从 `get().sessions` 读最新会话落盘（用户切换后旧会话不在内存即跳过）。
- 连接池只在 `shouldResetPoolForError` 为真且 `globalThis` 上的池仍是本次尝试开始时的池时才关闭。
- lockfile 在一次性 `node:22-alpine` 容器内以 `yarn install --ignore-scripts` 生成，未在宿主机安装依赖。

### 验证

- 宿主机 `npx tsc --noEmit`、`yarn lint` 通过（仅既有 `<img>` 提示）；容器内用新 lockfile 完整 `yarn build` 通过。
- 容器内启动 standalone 产物（假 PG）实测：匿名访问 proxy / provider / tencent / model-probe / cache upload / sync PUT 均 401，PUT 声明 100MB 时立即返回；MCP 开启时 12 个 action 匿名均被拒，未能创建测试文件；免登录模式下自适应 POST 首次与缓存命中均带完整 body 且 path 正确，元数据地址 403、`file://` 400，仿冒 `api.openai.com` 路径不再注入服务端 Key；日志中无 Key 明文。

### 潜在或遗留问题

- 流式节流与 PG 连接池策略未做浏览器/真实数据库实测；页面关闭发生在流式中途时最多丢失约 1 秒内的流式内容。
- 宿主机 `node_modules` 未重装（仍是旧 xlsx），本地 dev 容器需按 CLAUDE.md 重新 `build` 才会使用新依赖。
- 普通用户在 `/plugins` 修改插件会同步失败（403），属预期；Access/Config 共享 store 仍对所有登录用户可读写（用户选择保持现状）。
- 另一会话报告：全新浏览器上下文打开移动端 `/draw` 会把远端 draw-list 覆盖为空（HEAD 既有竞态），ccc 的绘画历史已被覆盖，尚未修复。

============================================================

## 239. 【2026-08-11 14:01】- 收敛供应商保存操作并新增对话测试

- 删除模型获取分区内“当前模型 / 模型专用 Key”提示，仅保留模型获取状态。
- 测试对话改为等待流式完成或错误回调后更新结果，修复 DeepSeek 等上游已返回成功响应却被误判为“响应未正常完成”的问题。
- 余额查询在当前卡片有未保存编辑时，只有保存成功才继续请求；保存失败或字段校验未通过会取消查询，避免使用服务端旧配置返回误导性结果。
- 官方 DeepSeek 根地址在自定义 Profile 与测试对话中固定请求 `/chat/completions`，并禁用通用路径探测与旧路径缓存，避免失败后尝试不属于 DeepSeek 官方接口的候选地址。
- 主聊天的 DeepSeek 等专用供应商改为优先读取模型选择器对应数据库 Profile 的 API Key，旧全局 Key 仅作兼容回退，避免测试可用但正常对话因使用旧 Key 返回 400。
- 主聊天向候选专用供应商显式传递其 Profile Base URL 与 API Key；DeepSeek 专用客户端按该次候选直接构造官方请求，消除旧全局字段或并发会话状态造成的 400。
- 主聊天、自动标题和记忆摘要均统一显式传递 `/api_config` 中选定 Profile 的 Base URL 与 API Key；各供应商客户端保留既有路径拼接和自动匹配，同时识别已填写完整对话端点的 URL 并直接请求，避免重复拼接。
- 对话失败后的候选范围收紧为当前供应商在 `/api_config` 已获取或手动添加的模型；不再跨供应商，也不尝试未添加模型，当前选中模型仍固定为首次请求。
- 官方 DeepSeek Profile 的主聊天改复用配置页测试已验证的 OpenAI 兼容代理请求；内置插件工具暂不随官方请求发送，使主聊天与已验证的测试请求保持一致并消除 400。
- 同步审计全部聊天入口：明确标记 `openAICompatible` 的 Profile 在主聊天、自动标题和记忆摘要统一改走配置页测试同款兼容代理；未标记兼容的供应商仍保留专用客户端，避免协议误判。
- 所有支持推理的模型默认使用中等强度；Token 预算型模型默认使用 4096，且“展示思考”默认开启。
- 增加一次性 `reasoningDefaultsVersion` 迁移，同时覆盖本地持久化与数据库同步导入：旧版默认 `high / 0 / false` 升级为 `medium / 4096 / true`，之后用户手动关闭或调整的设置会被保留。

### 修改内容

- 页面只保留顶部一个“保存并同步”按钮，卡片内移除重复保存按钮；该总按钮同时保存对话 / 模型配置和有变更的余额配置。
- 每个供应商卡片明确提供“获取模型”“获取余额”和“测试对话”操作；测试对话模型名可独立输入并原样请求一次，不携带插件工具，也不自动切换模型、路径、Key 或请求参数。
- 测试对话控制台沿用聊天页的开始、成功、失败和停止日志格式；只有响应正常完成且有实际文本回复时，卡片和 Toast 才显示成功及回复摘要。
- 模型选择器手动指定供应商后，主聊天故障转移只在该供应商内尝试候选模型，避免 DeepSeek 等官方供应商失败后自动切换并写回晴辰云等其他供应商；未手动选择时保留既有跨供应商故障转移。
- 模型获取的“获取成功：N 个模型”等状态从卡片底部移至模型获取分区下方；底部仅保留余额查询结果与删除配置。
- 对话 Base URL 与模型获取、余额查询 URL 一样，在填写后使用绿色强调样式。
- 启用 New-API-User 或 UUID 查询时，User ID / UUID 改为位于余额 API Key 下方的独立字段行；API Key、User ID、UUID 与“查询 URL”共用标签外框宽度和输入起点，桌面与移动端均保持对齐，同时保留原有标签尺寸（桌面 98px、移动端 88px）。
- 移除供应商管理页的“用于对话”开关；供应商和模型选择继续由对话页面负责。
- 获取模型不再等待顶部同步；余额配置有改动时只保存当前卡片后立即查询；对话测试会可靠收集请求错误。三种操作各自维护状态，可同时运行，并在开始、成功或失败时立即给出提示。
- 卡片右上角在余额左侧展示持久化的模型数量；模型获取成功后同余额查询成功一样显示绿色勾选更新态，清空模型后会清除该更新标记。
- 顶部增加独立的“全部获取模型”按钮，原“全部查询”明确为“全部查询余额”；两项批量操作可并行执行，模型批量操作会逐卡显示结果并汇总成功数量。
- 对话配置、测试对话、模型获取和余额查询的分区标题改用主题主色，保持字号和布局不变。
- 批量模型获取或余额查询运行时锁定新增、保存、清空、删除等配置按钮及对应单项操作；运行按钮显示“模型获取中...”或“余额查询中...”，禁用态使用 `not-allowed` 鼠标样式，两类批量任务仍可相互并行。
- 模型获取和余额查询的结果移入卡片底部，与“删除配置”同一桌面行展示；移动端自动将结果置于全宽删除按钮上方。
- 对话测试、模型获取、余额查询进行时分别锁定各自依赖的输入框；编辑可持久化配置后立即提示点击“保存并同步”，并在顶部保存按钮显示“有修改”直到成功保存。
- 顶部操作栏分为左右两组：新增配置与清空已添加模型固定在左侧，保存和批量操作保留右侧；移动端各组正常换行并保持全宽按钮。
- 移动端卡片右上角的模型数量和余额统一为相同的 13px 字号与行高，避免两项数值视觉大小不一致。

### 实现方式

- 测试对话显式使用被点击供应商卡片的 Base URL、对话 Key 和输入模型发送“请只回复 OK”的最小流式请求，不依赖对话页面的全局供应商配置；该请求关闭插件工具、请求兼容重试和多 Key 回退，但保留既有端点探测与成功路径记忆。
- 客户端按 Profile ID 解析测试目标，因此不依赖供应商是否设为当前全局对话配置。

### 验证

- `npx tsc --noEmit --pretty false`、`yarn lint` 与 `git diff --check` 通过；Lint 仅保留 `app/components/file-preview.tsx` 既有 `<img>` 提示。
- 本地 `nextchat-dev` 的 `/api_config` 返回 HTTP 200；网页使用 Nexus `gpt-5.6-terra` 发送思考模式测试成功。该次上游未返回可展示的 reasoning 内容，页面不会伪造思考区。

### 潜在或遗留问题

- 已实测官方 DeepSeek `deepseek-v4-flash`：配置页测试对话和正常网页对话均完成并收到回复；正常对话会新增本地聊天记录。

============================================================
