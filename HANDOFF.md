# HANDOFF

记录最近 10 条关键修改。最新记录置顶，历史从新到旧排列。每条记录标题格式为 `## 序号. 【YYYY-MM-DD HH:MM】- 标题`，序号持续递增，最大 999，达到后从 1 开始。超过 10 条时自动删除底部最旧记录。实质修改完成并验证后更新一次，创建 commit 前核对并一起提交.

============================================================

## 185. 【2026-07-20 13:26】- 附件正文提取并注入模型上下文

### 修改内容

- PDF、DOCX、XLS/XLSX、CSV、TSV 附件提交或重发时，服务端提取正文并与用户问题一起发送给模型，不再只提供文件名、类型和大小。
- 修复缓存文件信任上传 MIME 并同源 inline 渲染的安全风险；Excel 预览不再注入 HTML。
- 合并现有 detached worktree 的已验证聊天、模型参数、同步和样式改动到主工作区。

### 实现方式

- 新增 `/api/cache/extract`，按当前鉴权用户读取缓存文件；PDF 最多 80 页，表格最多 10 个工作表、每表 1000 行，单文件正文限制 24000 字符、单条消息总量限制 60000 字符，并记录截断状态。
- PDF.js worker 由服务端显式加载并注册，避免 Next.js 服务端分包后默认 fake worker 指向不存在的 `.next/server/vendor-chunks/pdf.worker.mjs`。
- 缓存 MIME 只按文件名白名单确定，未知格式仅下载；Range 读取不再重复触发缓存清理，响应加 `nosniff`。
- `ChatMessageAttachedFile` 持久化提取结果；聊天消息使用明确正文边界与文件内指令降权说明注入上下文。

### 验证

- 主工作区 `yarn lint`、`npx tsc --noEmit --pretty false` 与 `git diff --check` 通过。
- 开发容器热加载后，真实缓存 PDF 经 `/api/cache/extract` 返回 `ready`、127 个字符，按 80 页上限标记截断；`docker exec nextchat-dev yarn lint` 通过。
- 当前 `npx tsc --noEmit --pretty false` 仅余既有 `app/mcp/client.ts` 的 Zod 泛型报错，PDF worker 路由不再产生类型错误；`git diff --check` 仍仅报告本轮前已存在的 `HANDOFF.md` 文件末尾空行。

### 潜在或遗留问题

- 扫描版 PDF 没有内嵌文字层时不会自动 OCR，会提示为没有可提取文本；本次修复不增加 OCR。

============================================================

## 184. 【2026-07-20 11:58】- 修复 React 组件命名导致的全量 lint 失败

### 修改内容

- 修复 `chat.tsx` 与 `markdown.tsx` 中内部组件使用下划线开头名称，导致 React Hooks 规则将其识别为普通函数的问题。
- 全量 `yarn lint` 现已无错误、无警告。

### 实现方式

- 将 `_Chat` 更名为 `ChatContent`，保留现有外层 `Chat` 的 URL/会话同步职责和基于会话 ID 的 remount 行为。
- 将 `_MarkDownContent` 更名为 `MarkdownContentInner`，继续由既有的 `React.memo` 导出 `MarkdownContent`。

### 验证

- `docker exec nextchat-dev yarn lint` 通过。
- `docker exec nextchat-dev npx tsc --noEmit --pretty false` 与 `git diff --check` 通过；主页返回 `HTTP 200`。

### 潜在或遗留问题

- 无。

============================================================

## 183. 【2026-07-20 11:52】- 开发容器升级 Node 22 并重建最新依赖

### 修改内容

- 将 Docker 开发与运行阶段的基础镜像统一升级为 `node:22.13.0-alpine3.20`，满足当前依赖的 Node 版本要求。
- 重新生成 `yarn.lock`，并以最新锁文件完整重建本地 `nextchat-dev`。

### 实现方式

- 保留现有 Docker 镜像源、Yarn 与开发容器启动流程，仅调整两个 `NODE_IMAGE` 参数。
- 通过 `docker-compose-safe.sh` 构建并强制重建 `nextchat-dev`；容器继续挂载 `/Users/dyx/Code/NextChat` 到 `/app`。

### 验证

- 镜像构建成功，容器内 `node --version` 为 `v22.13.0`，容器保持运行且主页返回 `HTTP 200`。
- `git diff --check` 通过。
- `yarn lint` 未通过：现有 `app/components/chat.tsx` 中 `_Chat` 函数触发大量 `react-hooks/rules-of-hooks` 错误，未在本次容器配置任务中修改该聊天实现。

### 潜在或遗留问题

- 依赖安装期间 `canvas` 的可选原生编译因 Alpine 镜像未安装 Python 而报错，但 Yarn 安装完成且 Next.js 开发服务正常启动；只有实际使用依赖 `canvas` 的功能时才需补充其编译工具链。

============================================================

## 182. 【2026-07-20 10:35】- 修复缓存文件访问时意外清理问题

### 修改内容

- 移除 `/api/cache/[id]/route.ts` 中 GET、HEAD、DELETE 请求时调用的 `purgeExpiredCacheFiles()`。
- 原因：每次请求文件时都执行清理，会导致刚上传的文件被删除（如果过期或未 pin）。
- 清理操作仅保留在上传文件时（`/api/cache/upload/route.ts`）执行。

### 问题诊断

- 生产日志显示 `cache_file_references` 外键约束冲突错误。
- 根因：文件查看请求触发 `purgeExpiredCacheFiles()`，删除文件后再插入引用记录时失败。
- 用户反馈"聊天记录只有文字可以看到文件看不到"：文件可能被清理后无法访问。

### 验证

- 部署后检查文件下载 API 是否正常。
- 验证消息中的文件 URL 能否正确访问。

### 潜在或遗留问题

- 需要验证历史消息中的文件是否已恢复可访问状态。
- 可能存在其他并发场景导致的外键约束问题。

============================================================

## 181. 【2026-07-20 10:10】- 提亮参数设置深色禁用态

### 修改内容

- 提高参数设置弹窗在 dark 模式下禁用控件的背景、边框和文字明度。
- 同步提亮禁用滑块轨道与滑块，保留禁用语义、鼠标状态、弹窗外围颜色和原有尺寸布局。

### 实现方式

- 仅调整 `model-config.module.scss` 中参数弹窗的五个 dark 禁用态语义变量，不修改公共主题或其他页面。
- 开发文档同步说明禁用控件的视觉层级和严格作用范围。

### 验证

- 按用户要求，本轮只修改，不继续运行浏览器、lint、类型检查或构建验证。

### 潜在或遗留问题

- 新配色尚未完成最终浏览器视觉确认，由用户在当前热加载页面直接检查。

============================================================

## 180. 【2026-07-20 10:06】- 提示词管理读取与全局提示词保存日志

### 修改内容

- 打开 `/prompt-manager` 并完成数据库读取后，控制台分别输出最终提示词数量和当前实际生效的完整全局提示词。
- 点击“保存全局提示词”且 Config 同步成功后，控制台输出保存成功、实际生效内容及字符数；失败继续使用既有错误日志。

### 实现方式

- 页面读取完成后记录提示词数量，并由依赖当前 `effectiveGlobalSystemPrompt` 的副作用延迟 300ms 输出稳定快照，避免热加载或 Config 水合竞态打印旧默认值。
- 保存日志位于 `runWithImmediateStoreSyncPaused()` 和强制 Config 同步成功之后；自定义值为空时按真实请求逻辑输出 `DEFAULT_SYSTEM_TEMPLATE`。
- 开发文档同步补充 `/prompt-manager` 页面进入日志和保存日志契约。

### 验证

- 深色主题热加载页面直接打开 `/prompt-manager`，页面与控制台均确认 129 条提示词；页面文本框和控制台输出同一份 808 字中文全局提示词。
- 页面无 warning/error；`yarn lint`、`npx tsc --noEmit --pretty false` 与 `git diff --check` 通过。

### 潜在或遗留问题

- 为避免测试过程额外改写共享 PostgreSQL，本轮未点击保存按钮；保存日志位置和数据源已通过代码路径、类型检查与现有同步成功分支验证。

============================================================

## 179. 【2026-07-20 00:42】- 复选框 hover 取消缩放并区分勾选状态

### 修改内容

- 设置列表中已勾选和未勾选的复选框在 hover 时都不再产生缩放效果。
- 未勾选框继续保留 2px 主色边框反馈；已勾选框 hover 时保持原有主色背景、边框和勾选图形，不再改变视觉尺寸。

### 实现方式

- 在复选框公共样式 owner `ui-lib.module.scss` 中拆分 `:not(:checked):hover` 与 `:checked:hover`，为两种状态都显式固定 `transform: none`。
- 已勾选 hover 复用静态 checked 样式，并固定伪元素勾选图形为 `scale(1)`；未勾选 hover 只调整边框与轻量背景。

### 验证

- 深色主题热加载页面实测已勾选的“启用Artifacts”：强制 hover 前后均为 `20px × 20px`、`transform: none`，主色背景和勾选图形保持不变。
- 页面截图确认复选框区域无布局位移，控制台无 warning/error；`yarn lint`、`npx tsc --noEmit --pretty false` 与 `git diff --check` 通过。

### 潜在或遗留问题

- 当前模型的可编辑复选框均已勾选，为避免改变配置并触发数据库同步，未通过点击制造未勾选状态；未勾选 hover 由独立 CSS 选择器和静态检查验证。

============================================================

## 178. 【2026-07-20 00:34】- 停止序列文本域统一输入控件交互样式

### 修改内容

- “停止序列”文本域复用设置页统一输入控件样式，补齐 2px 边框、hover、focus、过渡和鼠标反馈。
- 可编辑态使用文本光标，禁用态明确使用 `not-allowed`，并继续保留深色主题禁用配色与原有宽度。

### 实现方式

- 在停止序列文本域上增加公共语义类 `nextchat-input-control`，由 `globals.scss` 的输入控件规则统一负责边框、背景、阴影和交互状态。
- `model-config.module.scss` 只保留参数文本域的 10px 圆角及禁用光标覆盖，避免复制一套局部 hover/focus 规则。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 与 `git diff --check` 通过。
- 深色主题热加载页面实测空闲态为 2px 边框、10px 圆角、260px 宽度和文本光标；点击聚焦后主色边框及 inset shadow 生效。

### 潜在或遗留问题

- 浏览器调试接口未稳定取得纯 hover 状态的独立计算值；公共 hover 选择器已确认命中该 textarea，且同一公共类的交互规则未被局部样式覆盖。

============================================================

## 177. 【2026-07-20 00:12】- 移除应用启动时的旧备份表清理 DDL

### 修改内容

- 删除主业务库五张旧备份表的运行时清理函数，以及 API 配置和对话自动备份调度器中的两个调用点。
- 自动备份继续正常读写独立 `nextchat_backup` 数据库；应用启动不再执行 `DROP TABLE ... CASCADE`。

### 实现方式

- 核对当前仓库、Schema、备份 repository 和迁移记录，确认现行备份表均为独立备份库的 `backup_*` 表，旧主库表已完成迁移并实际删除。
- 开发文档明确：一次性主库清理不得挂在应用启动或定时任务上，后续必须使用显式、可审计的数据库维护操作。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 与 `git diff --check` 通过；全仓搜索确认旧清理函数、白名单、日志标签和对应 DROP 语句均不存在。
- 重启 `nextchat-dev` 后两个正常备份调度器启动，日志不再出现 `[Backup Cleanup]`；Next.js 进入 Ready，首页返回 HTTP 200。

### 潜在或遗留问题

- 启动期间 PostgreSQL 曾出现一次可重试的 `tuple concurrently updated`，随后自动备份扫描正常完成；与已删除的 DROP 清理无关。

============================================================

## 176. 【2026-07-20 00:02】- 本地 Docker 构建切换为国内镜像源

### 修改内容

- 本地开发与生产 Dockerfile 的默认 BuildKit 前端、Node/Alpine、PostgreSQL、官方 NextChat 基础镜像、APK 源和 NPM/Yarn 源统一切换为国内镜像，不依赖本机代理。
- PostgreSQL SSH 隧道镜像同步改用 DaoCloud Alpine 与阿里云 APK 源，解决 OrbStack 构建容器无法解析 Alpine 官方源的问题。

### 实现方式

- BuildKit 语法镜像以及 Node/Alpine、PostgreSQL、官方 NextChat 镜像使用 `docker.m.daocloud.io`，APK 使用 `https://mirrors.aliyun.com/alpine`，NPM/Yarn 使用 `https://registry.npmmirror.com/`；现有 Compose 的国内 build args 保持不变。
- README 记录完整国内构建源链路与 SSH 隧道覆盖范围。

### 验证

- 无代理环境下，SSH 隧道镜像完成构建并启动；主开发镜像从 DaoCloud 拉取 BuildKit/Node、从阿里云安装 APK，并从 npmmirror 获取 Yarn 依赖后成功生成。
- `git diff --check` 通过。用户确认自行测试后，`nextchat-dev` 使用现有国内源镜像以 `ccc` 免登录和 SSH 隧道配置启动，Next.js 约 1.4 秒进入 Ready，首页返回 HTTP 200。

### 潜在或遗留问题

- `instrumentation.ts` 会无条件启动备份调度器，其首次运行调用 `DROP TABLE IF EXISTS ... CASCADE` 清理主库旧备份表；本次启动日志再次确认该路径执行。用户已知情并明确要求启动，后续仍建议改为仅显式维护命令可触发。
