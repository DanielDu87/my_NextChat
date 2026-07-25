# HANDOFF

记录最近 10 条关键修改。最新记录置顶，历史从新到旧排列。每条记录标题格式为 `## 序号. 【YYYY-MM-DD HH:MM】- 标题`，序号持续递增，最大 999，达到后从 1 开始。超过 10 条时自动删除底部最旧记录。实质修改完成并验证后更新一次，创建 commit 前核对并一起提交.

============================================================

## 220. 【2026-07-25 10:08】- chat.dyxcloud.com 生产部署 7992b382

### 修改内容

- 把 `7992b382 短 Word 文档默认铺满并收敛内联页边距` 推送到 `chat.dyxcloud.com` 宝塔 DockerSite 容器，线上版本与本地提交一致。

### 实现方式

- 标准重部署流程（README_BAOTA.md §3）：在 SSH alias `ss` 服务器（42.193.15.117:222）的 `/www/dk_project/my_NextChat` 目录中放入 `git pull --ff-only`、`./scripts/docker-compose-safe.sh -f docker-compose.baota.yml --env-file .env.baota build nextchat`、`docker rm -f nextchat`、`docker image rm nextchat:latest`、`./scripts/docker-compose-safe.sh ... up -d --force-recreate nextchat`、`./scripts/sync-baota-dockersite-container-id.sh`、`./scripts/fix-pg-hba.sh`，整体放入 tmux 会话 `nextchat-baota-deploy` 防止 SSH 超时；脚本文件 `/tmp/nextchat-baota-deploy.sh` 已上传服务器执行。

### 验证

- Docker：`nextchat` 状态 `Up About a minute (healthy)`，镜像 `nextchat-baota:latest`，端口 `127.0.0.1:3000->3000/tcp`。
- `/api/db/health`：HTTP 200，`{"ok":true,"postgres":{"now":"2026-07-25 10:06:27+08","version":"PostgreSQL 18.0","database":"nextchat","user":"dyx","configuredHost":"172.20.0.1","configuredPort":5432}}`。
- Nginx：`nginx -t` 通过。
- 域名：`https://chat.dyxcloud.com/` 服务器本地与公网均 `HTTP/2 200`；服务器本地 `/chat` 与 `/` 均返回 200。
- 容器内 `printenv BUILD_COMMIT_HASH = 7992b382a5d2f4831df5772b009e434ea4c96be5`；首页 HTML `commitHash` 同样为 `7992b382a5d2f4831df5772b009e434ea4c96be5`；`public.deployment_metadata` 最新行 `commit_hash=7992b382a5d2f4831df5772b009e434ea4c96be5, image_name=nextchat-baota:latest, git_branch=main, deployed_at=2026-07-25T02:05:05.994Z`，三处哈希全部一致。
- 宝塔 DockerSite（chat.dyxcloud.com id=13）返回 `healthy=1`，容器 ID `19368c350549334560e06bc22a6cc9ad8fd16aa387e3374832a4db0d9a216fa6` 与本轮同步一致。
- `fix-pg-hba.sh` 探测容器网络 `172.20.0.2`，写入 `host nextchat|nextchat_backup dyx 172.20.0.0/16 md5` 并通过 `pg_ctl reload` 完成 PostgreSQL 重载，备份到 `/www/server/pgsql/data/pg_hba.conf.backup.20260725100506`。

### 潜在或遗留问题

- 本轮仅包含代码 / 样式 / 文档修改，未涉及 `.env.baota`、Nginx vhost、证书、数据库表结构、镜像基础镜像、Docker 容器名或端口；未对生产服务器、数据库、容器做任何删除或回滚操作，回滚路径仍是上一次成功部署时使用的镜像 `nextchat-baota:latest` 的 `c10e6e10` 构建层。
- `deployment_metadata` 表的列名是 `image_name` 与 `git_branch`（不是 README 中误写的 `image` / `branch`）；后续 `§8 标准验证命令`的 SQL `select commit_hash, image, branch, ...` 因列名差异会返回 `42703 column does not exist`，下次更新文档时同步校正。



### 修改内容

- 修复只有几行文字的 Word（DOCX）在聊天文件预览中白色文档页高度过小的问题；短文档默认铺满预览正文区，长文档仍可完整纵向滚动。
- 同时收敛 `docx-preview` 自带的内联页边距（常见值 `72pt 90pt`），把上下/左右 padding 收敛为响应式 `clamp(20px, 4vw, 36px) clamp(16px, 5vw, 48px)`，避免预览窗口中正文有效宽度被严重压缩。
- 桌面端与移动端共用同一高度策略；窗口尺寸或手机方向变化时会重新计算，移动端缩放后仍铺满可见区域。

### 实现方式

- `app/components/file-preview.tsx` 的 `applyDocxSectionSizing()` 现在读取 `.docx-preview-root` 扣除上下 padding 后的可用高度，并结合 `section.docx` 当前 zoom 反算动态 `min-height`；同步直接覆盖 `section.style.padding` 为响应式小边距、`box-sizing: border-box` 把 Word 页内边距计入铺满高度。`height: auto`、`max-height: none` 和 `flex: 0 0 auto` 保留，避免重新引入长文档截断。
- `applyDocxAutoScale()` 在每次 `ResizeObserver` 回调完成宽度缩放后同步重算页面最小高度；缓存 Blob 与新下载 Blob 两条渲染路径继续在同步帧、`requestAnimationFrame` 和 100ms 延时执行尺寸修正。
- `app/components/chat.module.scss` 为 `section.docx` 增加同值 `padding: clamp(20px, 4vw, 36px) clamp(16px, 5vw, 48px) !important;` 兜底与 `box-sizing: border-box`，确保首帧和后续重排覆盖库内联样式；`min-height: 100%` 与 `flex: 0 0 auto` 保留。
- `docs/development.md` 同步记录短文档铺满、DOCX 原始页边距覆盖与新响应式 padding 边界。

### 验证

- `yarn prettier --check app/components/file-preview.tsx app/components/chat.module.scss docs/development.md`、`yarn lint`、`npx tsc --noEmit --pretty false` 与 `git diff --check` 全部通过；Lint 仅保留 `file-preview.tsx` 既有 `<img>` 性能提示。
- `nextchat-dev`、`codeinterpreter-local` 和 PostgreSQL SSH 隧道容器均保持运行；`/chat` 返回 HTTP 200，热加载日志显示 5760 modules 编译成功。

### 潜在或遗留问题

- 当前安装未启用 in-app Browser pane，Playwright 又受系统临时目录权限限制，因此未能用浏览器工具点击真实短 DOCX 检查计算高度与最终样式；已完成样式、类型、编译和响应式尺寸链路验证。
- 开发容器旧日志中存在与本次无关的 `cache_file_references` 外键约束错误，本轮未修改数据库或缓存引用链路。

============================================================

## 218. 【2026-07-25 09:17】- 提示词数量徽章复用全局样式

### 修改内容

- 提示词选择弹窗的“共 N 条”数量徽章改为复用 `app/styles/globals.scss` 现有 `.nextchat-modal-count` 公共类，不再由 `app/components/chat.module.scss` 重复声明胶囊外观和暗色覆盖；并通过本地 `.prompt-picker-count` 仅覆盖边框粗细和颜色为 `var(--close-button-border-width)` 与 `var(--close-button-border-color)`，满足特定场景的 1px / `rgba(100, 116, 139, 0.24)` 视觉。
- 关闭按钮继续使用现有 `.nextchat-close-button` 公共样式，不做局部覆盖。

### 实现方式

- `app/styles/globals.scss` 将 `.nextchat-modal-count` 的 `border` 简写拆为 `border-style/border-width/border-color` 三条独立声明，方便后续只覆盖颜色或粗细时无需 `!important`。
- `app/components/chat.tsx` 为数量徽章追加 `nextchat-modal-count` 类，同时保留本地 `prompt-picker-count` 作为移动端隐藏选择器和边框覆盖锚点；关闭按钮不再追加任何本地类。
- `app/components/chat.module.scss` 删除数量徽章的尺寸、边框、背景、字体、阴影及两套暗色外观，只保留既有移动端布局规则中的隐藏行为；本地 `.prompt-picker-count` 仅覆盖边框粗细和颜色，无需 `!important`。

### 验证

- `yarn prettier --check app/components/chat.module.scss`、`yarn lint` 和 `git diff --check` 通过；`chat.tsx` 在修改前已存在全文件 Prettier 基线差异，本次修改片段与 Prettier 输出一致。
- `nextchat-dev` 容器保持运行并完成热加载编译，最新日志显示 5760 modules 编译成功。

### 潜在或遗留问题

- 当前安装未启用 in-app Browser pane，无法附着现有 Docker 页面做截图和计算样式检查；未修改 Browser 配置或产品全局样式。

============================================================

## 217. 【2026-07-25 09:10】- 抽出文件预览与 Code Interpreter 本地容器接入

### 修改内容

- 把散落在 `app/components/chat.tsx` 的附件 Glyph、文件预览对象 URL 缓存、Blob 读取、文件大小请求、PDF/Office 预览分支统一收敛到 `app/hooks/useFilePreview.tsx` 与 `app/components/file-preview.tsx`，新增 `app/hooks/` 目录。
- Markdown 链接与聊天附件的同款文件卡片样式从 `chat.module.scss` 抽到 `app/styles/globals.scss` 的 `.markdown-body .chat-message-attached-file` 公共作用域，让 `markdown.tsx` 也能渲染统一视觉。
- `app/utils/attachment-file.ts` 新增 `isFetchableAttachmentUrl` URL 守卫与 `AttachmentTypeKind` / `AttachmentLike` 类型与 `getAttachmentTypeKind` / `getAttachmentTypeLabel` / `formatAttachmentSize` 等判断函数；`markdown.tsx` 复用同一套判断和 hook。
- `app/utils/generated-file-links.ts` 新增 `assignGeneratedFileAliases`：先按精确文件名匹配，重命名时仅在相同扩展名的沙箱引用与生成文件能一一对应时按顺序建立别名；`plugin.ts` 在 `materializePluginGeneratedFiles` 中调用，把别名持久化进 `result.data.files.aliases`，使流式更新、最终写回和历史消息重渲染复用同一映射。
- `docker-compose.yml` 新增 `codeinterpreter-local` 服务（基于 `scripts/code-interpreter/Dockerfile` 构建，固定镜像名 `codeinterpreter-api-local:latest`，`expose 5000` + `codeinterpreter-local-data` 数据卷），并把本地启动命令改为带 `--profile codeinterpreter-local`；`CLAUDE.md` / `README.md` / `docs/development.md` 同步记录本地容器接入、Code Interpreter 文件下载链路与 DOCX 预览滚动 owner 约束。
- 新建 `.githooks/commit-msg` 校验脚本，强制提交首行必须是 `YYYY-MM-DD HH:MM ` 时间戳前缀；`git config core.hooksPath .githooks` 切换到独立钩子目录，最近 5 次提交格式审计已通过、无需 filter-branch。

### 实现方式

- `app/hooks/useFilePreview.tsx` 暴露 `useFilePreview()`：`openFilePreview(url, name, options)` 维护对象 URL 缓存（最大 24 条命中 LRU）、按内容类型派发到 PDF/Office/图片/纯文本分支；`app/components/file-preview.tsx` 提供 `FilePreviewModal` 与 `AttachmentFileGlyph`，缓存 blob 与下载 blob 两条 DOCX 渲染分支均通过 `applyDocxSectionSizing()` 把渲染出的 `section.docx` 强制设为 `width: 100%; max-width: 100%; height: auto; min-height: 0; max-height: none; flex: 0 0 auto`。
- `app/components/chat.tsx` 移除已抽出的 `AttachmentFileGlyph` / `filePreviewObjectUrlCache` / `getCachedPreviewBlob` / `setCachedPreviewBlob` 等实现，仅保留 `clearComposerAttachmentDraftCache` 等写回逻辑；`app/components/chat.module.scss` 同步删除对应 `.docx-preview-*`、`.file-preview-*` 重复样式，仅保留布局/尺寸/暗色图标。
- `app/styles/globals.scss` 新增 187 行 Markdown 卡片公共样式，并补齐 `nextchat-primary-button` 的 `font-family` 兜底（避免本机缺字体时按钮高度被异常撑高）。
- `app/utils/generated-file-links.ts` 在 `getFileNameVariants` 中补 `decodeURIComponent` 变体；新增 `getPathFileName` / `getFileExtension` 帮助函数与顺序回退匹配；`plugin.ts` 在文件上传并提交缓存后调用 `assignGeneratedFileAliases` 写回别名。
- `.githooks/commit-msg` 使用 `head -1 | grep -qE '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2} '` 校验，首行不合规直接 `exit 1`；`git config core.hooksPath .githooks` 切换到独立目录。

### 验证

- `yarn lint` 通过；`npx tsc --noEmit --pretty false` 通过；`git diff --check` 与 Prettier 通过。
- `.githooks/commit-msg` 通过两条手工测试：无时间戳消息 exit 1，合规消息 exit 0。
- 远程分支 `origin/main` 当前 HEAD = `012e30ea`，与本地一致；`gitee/main` 与 `ss/main` 待推送后由 `git ls-remote` 验证。

### 潜在或遗留问题

- 本地未启用 in-app Browser pane，本轮未通过浏览器工具手动点击 DOCX 滚动；HANDOFF #215/#216 完成的运行态与缓存接口验证仍然有效，本次主要是把已有能力抽到独立 hook/组件并接入本地 Code Interpreter 容器。
- `scripts/git-commit-push.sh` 当前仓库内不存在，本次提交直接走 `git add` + `git commit` + `git push`，未走脚本；后续如需引入该脚本需补齐 `rules-audit.sh` 与脚本文件。

============================================================

## 216. 【2026-07-25 09:10】- Word 预览支持纵向滚动查看长文档

### 修改内容

- 修复 Code Interpreter 生成的 Word 文档在弹窗内只能看到上半部分、长内容被截断的问题；改为由预览根容器内部纵向滚动，可完整查看整份文档。
- 保留桌面端宽度自适应、移动端等比缩放、PDF/Excel/图片/纯文本等其它预览不受影响。

### 实现方式

- `app/components/chat.module.scss` 调整 `.docx-preview-container.docx-preview-container`：移除对自身的 `height: 100% / flex: 1`，让内部 `section.docx` 按内容自然增长；`:global(section.docx)` 改为 `height: auto; min-height: 0; max-height: none; flex: 0 0 auto; margin: 0 auto`，只保留宽度自适应并保持白底/边框/阴影。
- 滚动 owner 仍是 `.docx-preview-root`（`flex: 1; min-height: 0; overflow-y: auto; padding: 16px`），文档页超出根视口时由外层滚动条接管；移动端 `.docx-preview-container` 的 `align-items: flex-start` 不变，宽度缩放仍交由 `applyDocxAutoScale` 处理。
- `app/components/file-preview.tsx` 新增 `applyDocxSectionSizing()`：把渲染出的 `section.docx` 强制设为 `width: 100%; max-width: 100%; height: auto; min-height: 0; max-height: none; flex: 0 0 auto`，并在渲染同步帧、`requestAnimationFrame` 与 100ms 延时各执行一次，覆盖 `docx-preview` 内联样式。两条 DOCX 渲染分支（缓存 blob 与全新下载 blob）均改用该 helper，删除旧 `fixDocxSection`。
- `docs/development.md` 在 Code Interpreter 文件预览段后新增规则说明滚动 owner、容器/段落约束和禁止恢复 `height: 100% / flex: 1`。

### 验证

- `yarn lint` 通过，仅保留 `file-preview.tsx` 既有 `<img>` 性能提示；`npx tsc --noEmit --pretty false`、Prettier、`git diff --check` 通过。
- 针对性 `tsx` 检查：文件中 `applyDocxSectionSizing` 引用 7 处（1 定义 + 6 调用：缓存分支 + 下载分支 × `fixDocxSection + rAF + setTimeout`），旧 `fixDocxSection` 已为 0；helper 内含全部 6 个期望属性赋值。
- `nextchat-dev` 正常运行，`/chat` 返回 HTTP 200，热加载编译成功；宿主机与容器内 `app/components/file-preview.tsx` 与 `app/components/chat.module.scss` SHA-256 完全一致，真实 `HEAD /api/cache/<uuid>.docx` 仍返回 HTTP 200。

### 潜在或遗留问题

- 当前安装未启用 in-app Browser pane，未通过该工具在浏览器中拖动滚动条验证长文档；运行态、热加载、容器源码一致性、纯函数行为已完成替代验证；建议在启用 Browser pane 后用真实 DOCX 做最终滚动确认。

============================================================

## 215. 【2026-07-25 08:50】- 修复 Code Interpreter 生成文件预览失败

### 修改内容

- 修复模型正文保留 `sandbox:/tmp/...` 时，Markdown 和文件预览对浏览器不支持的沙箱协议发起请求的问题。
- 支持 Code Interpreter 生成文件被重命名后，仍将原始沙箱路径安全改写为当前用户的 `/api/cache/<uuid>.<ext>` 下载与预览地址。
- 修复文件预览原先拒绝同源 `/api/cache/...` 相对 URL 的协议判断。

### 实现方式

- `app/utils/generated-file-links.ts` 为生成文件增加持久化 aliases：先按文件名精确匹配；重命名时仅在相同扩展名的沙箱引用与生成文件能够一一对应时按顺序关联，数量不一致或有歧义时不猜测。
- `app/store/plugin.ts` 在文件上传并提交缓存后，从原始工具输出提取 `sandbox:/mnt/data/...` 与 `sandbox:/tmp/...`，把映射写回工具结果并复用现有下载链接追加逻辑。
- `app/utils/attachment-file.ts` 新增共享 URL 守卫；Markdown 文件大小请求和文件预览统一允许同源根相对 URL、HTTP(S) 及受控 Blob，拒绝其他协议。
- `app/components/markdown.tsx` 对无法映射的 `sandbox:` 链接显示非交互失效提示，不再创建无效文件卡片；`README.md` 与 `docs/development.md` 同步记录行为边界。

### 验证

- `yarn lint` 通过，仅保留 `file-preview.tsx` 既有 `<img>` 性能提示；`npx tsc --noEmit --pretty false`、Prettier、`git diff --check` 通过。
- 针对性 `tsx` 检查覆盖重命名单 DOCX 映射与多 DOCX 数量不一致时不猜测，全部通过。
- `nextchat-dev` 正常运行，`/chat` 返回 HTTP 200，热加载编译成功；目标源码与容器 `/app` 内 SHA-256 一致，真实 `HEAD /api/cache/...docx` 返回 HTTP 200。

### 潜在或遗留问题

- 当前安装未启用 in-app Browser pane，专用预览工具无法附加到现有 Docker 页面，因此未通过该工具点击 Word/Excel 预览；运行态、缓存接口、编译、类型与纯函数映射已完成替代验证。

============================================================

## 214. 【2026-07-24 11:30】- 修复用户切换时对话跨用户污染问题

### 修改内容

- 修复用户切换后，A 用户的对话可能被错误合并到 B 用户的问题（P1 高优先级）。
- 修复每次切换用户都重复执行完整同步链路的问题（P2）。
- 修复 `_hasHydrated` 标志未在用户切换时重置，导致本地缓存被忽略的问题。

### 实现方式

**P1 修复：同步流程增加用户上下文绑定**

- `app/store/sync.ts`：在 `sync()` 方法中捕获同步开始时的 `userId` 和 `generation`。
- 新增 `isStaleSync()` 验证函数，在关键写回点检查用户是否已切换。
- 聊天同步写回前 (`setLocalStoreState`) 和常规 store 写回前均添加用户验证，过时结果直接丢弃。
- 同步完成后再次检查用户上下文，确保污染结果不会写入。
- `lastChatSyncCompletedAt` 更新前验证用户状态，防止旧冷却时间影响新用户。

**P1 修复：用户切换时清理同步状态**

- `app/store/sync.ts`：新增 `clearSyncStateForUserSwitch()` 函数，清除 `syncInFlight`、`queuedSyncKeys`、防抖定时器、`startupChatSyncInFlight` 和冷却时间。
- `app/store/auth.ts`：`switchUser()` 中在设置新 cache marker 后立即调用清理函数。

**P2 修复：已有缓存用户快速切换**

- `app/utils/chat-persist-storage.ts`：新增 `resetAll()` 方法，清除 `cache`、`hydrated`、`hydrating`、`pendingWrites`。
- `app/store/chat.ts`：`resetForUserSwitch()` 中调用 `resetAll()` 并显式重置 `_hasHydrated = false`，强制后续从 IndexedDB 重新加载。
- `app/store/auth.ts`：切换时的远端同步添加 `force: true`，避免被旧用户冷却时间跳过。

**P2 修复：getItem fallback 路径增加 ownerId 校验**

- `app/utils/chat-persist-storage.ts`：`getItem()` 的 fallback 分支（无 index 时）添加 `isScopedChatStoreKeyActive` 检查，确保不返回旧用户缓存。

**其他**

- `app/store/auth.ts`：导出 `getActiveSwitchGeneration()` 和 `getCurrentCacheMarkerUserId()` 供 sync.ts 验证使用。
- `app/store/chat.ts`：`hydrateSessionIntoMemory()` 已有用户验证逻辑保持不变。

### 验证

- `yarn lint` 和 `npx tsc --noEmit --pretty false` 全部通过。
- 预期行为：切换到已有缓存的用户时，立即显示本地缓存；远端同步在后台增量执行；有变化时才拉取最新数据。

### 潜在或遗留问题

- 未在真实多用户环境下触发竞态测试；通过代码路径审查、用户上下文捕获点和写回验证覆盖主要污染路径。

============================================================

## 213. 【2026-07-24 10:47】- 部署生产 Code Interpreter 文件下载链路

### 修改内容

- 将生产服务器独立 `codeinterpreter` 服务更新到仓库内已验证的文件生成包装版本，线上现在会返回 `files.base64`，NextChat 可以继续写入 `/api/cache` 并生成真实下载链接。
- 修复旧生产镜像使用不存在的 `wget` 探活而长期显示 `unhealthy`，新版 Compose 改用 Python 标准库请求根路径。
- Code Interpreter 构建阶段新增阿里云 Debian 镜像源，解决生产服务器从 Debian 官方源下载约 102MB 编译依赖时长时间停滞的问题；Python 包继续使用阿里云 PyPI。

### 实现方式

- 生产目录 `/www/dk_project/code_interpreter_api` 同步 `app.py`、`Dockerfile`、`docker-compose.codeinterpreter.yml`、`requirements.txt`、`requirements.nextchat.txt` 和 `nextchat_runtime.py`，保留原 `.env.codeinterpreter`、Nginx、数据卷与 NextChat 主容器。
- `scripts/code-interpreter/Dockerfile` 新增 `APT_MIRROR`，构建前把 Debian 与 Debian Security 源替换为阿里云镜像；`scripts/code-interpreter/README.md` 同步记录 Debian/PyPI 双镜像边界。
- 覆盖前备份旧文件到 `/root/codeinterpreter-backup-20260724-103317`，并将旧镜像保留为 `codeinterpreter-api-baota:rollback-20260724-103317`；新版镜像构建成功后才由 Compose 替换旧容器。

### 验证

- 线上公网 `/codeinterpreter/runcode` 未带 Token 返回 HTTP 401，使用生产 Token 返回 HTTP 200。
- 真实生成 `online_download_check.txt` 后响应包含 `files` 与 `output`；文件 MIME 为 `text/plain`、大小 18 字节，base64 解码内容为 `online download ok`，响应后容器内临时文件不存在。
- 线上解释器可导入 `python-docx 1.1.2`；公网根路径返回 HTTP 200，`codeinterpreter` 容器状态为 `healthy`。
- `git diff --check` 通过；生产文件与仓库对应版本的 SHA-256 一致。

### 潜在或遗留问题

- 为避免消耗模型额度和向生产聊天库写入测试会话，未通过真实聊天再次触发文件生成；生产解释器返回结构与此前已通过的本地 `/api/cache` 完整链路现已一致。

============================================================

## 212. 【2026-07-24 09:58】- 限制生成标题不超过十五个字符

### 修改内容

- 自动标题和手动刷新标题生成的最终文字统一限制为最多 15 个字符，空格和标点也计入长度。
- 超长结果不截断、不写回，避免把完整回答前 15 个字符误当作标题。

### 实现方式

- `app/store/chat.ts` 新增 `SESSION_TITLE_MAX_CHARACTERS=15`，标题请求在现有本地化提示词后追加中英文硬限制。
- `normalizeGeneratedSessionTitle()` 使用 Unicode 字符数组校验最终标题，超过限制返回无效结果并保留原有默认或旧标题。
- `docs/development.md` 同步将原 80 字符边界更新为 15 字符。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false`、Prettier 与 `git diff --check` 通过。
- 宿主机与 `nextchat-dev` 容器内 `app/store/chat.ts`、`docs/development.md` SHA-256 完全一致。

### 潜在或遗留问题

- 为避免消耗 API 额度和写入远端聊天记录，未触发真实标题请求；提示词和返回值校验两层限制已完成。

============================================================

## 211. 【2026-07-24 09:57】- 统一侧边栏与标题栏消息计数

### 修改内容

- 侧边栏会话卡片与对话页标题栏统一消息计数口径：用户消息立即计入，流式助手占位不计入，助手回复落定后两处同时增加。
- 历史已完成消息的数量保持不变，不修改持久化结构。

### 实现方式

- `app/store/chat.ts` 新增共享 `countCompletedSessionMessages()`，`buildSessionSummary()` 使用该函数生成侧边栏 `messageCount`。
- `shouldRefreshSessionSummary()` 改为比较已完成消息数，保证助手由 `streaming=true` 变为完成时即使数组长度不变也会刷新侧边栏摘要。
- `app/components/chat.tsx` 的标题栏统计复用同一函数，`docs/development.md` 同步记录统一口径。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false`、Prettier 与 `git diff --check` 通过。
- 浏览器打开“随机数字规律”会话，侧边栏显示“8 条对话”，标题栏显示“共 8 条对话”，URL 和选中态正确，控制台无 warning/error。

### 潜在或遗留问题

- 为避免写入远端聊天库，未发送真实流式测试消息；流式完成时的摘要刷新条件已通过代码检查和类型检查覆盖。

============================================================

## 210. 【2026-07-24 09:53】- 消除对话选中边框延迟

### 修改内容

- 对话列表点击切换时，主题色选中边框立即显示，不再先出现 hover 背景、随后才补上边框。
- 保留原有背景色渐变和多选模式左右位移动画，不改变列表尺寸、颜色或交互结构。

### 实现方式

- `app/components/home.module.scss` 从 `.chat-item` 的 `transition` 中移除 `border-color 0.25s ease`，让 `.chat-item-selected` 的边框颜色同步生效。
- `docs/development.md` 同步记录选中边框的即时反馈边界。

### 验证

- `yarn lint`、Prettier 与 `git diff --check` 通过。
- 浏览器在点击后 80ms 检查“孕妇饮食建议”会话，URL、标题、统计和主题色选中边框均已显示，控制台无 warning/error。

### 潜在或遗留问题

- 无。

============================================================
