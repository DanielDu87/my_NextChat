# HANDOFF

记录最近 10 条关键修改。最新记录置顶，历史从新到旧排列。每条记录标题格式为 `## 序号. 【YYYY-MM-DD HH:MM】- 标题`，序号持续递增，最大 999，达到后从 1 开始。超过 10 条时自动删除底部最旧记录。实质修改完成并验证后更新一次，创建 commit 前核对并一起提交.

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

## 209. 【2026-07-24 09:50】- 修复消息统计时机和流式回复期间会话切换

### 修改内容

- 对话页标题下方的消息数在用户消息发送后立即增加，流式助手占位消息不再提前计数；助手回复落定后再增加。
- 修复启用 React Router 过渡后，流式回复期间点击其他会话可能被旧 URL 选中态切回的问题。
- 后台回复在用户切换会话后仍按原会话 ID 读取上下文和写回结果，避免误用新打开会话的消息。

### 实现方式

- `app/components/chat.tsx` 的标题栏统计排除 `role=assistant && streaming=true` 的消息。
- `app/components/home.tsx` 只在 URL 会话 ID 真正变化时从路由校正 Store 选中态，移除选中态变化反向触发旧路由校正的竞态。
- `app/store/chat.ts` 为 `getMessagesWithMemory()` 增加可选目标会话，发送链路显式传入发起请求的会话。
- `docs/development.md` 同步记录统计、切换和后台请求隔离规则。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false` 与 `git diff --check` 通过。
- 浏览器连续切换“孕妇饮食建议”和“更正收款账户”，两次 URL、页面标题、选中态及“共 2 条对话”均同步更新，控制台无 warning/error。
- `nextchat-dev` 正常运行，宿主机与容器内三个修改代码文件的 SHA-256 完全一致。

### 潜在或遗留问题

- 为避免消耗 API 额度和向远端聊天库写入测试记录，未发送真实流式测试消息；流式计数与原会话后台写回边界已通过代码路径、Lint 和类型检查验证。

============================================================

## 208. 【2026-07-24 09:42】- 标题生成完成前保持默认新的聊天

### 修改内容

- 用户发送首条消息后、AI 标题成功写回前，会话列表和聊天页继续显示当前语言的默认标题“新的聊天 / New Conversation”，不再用首条用户消息或截断正文充当临时标题。
- 标题请求失败、取消或返回无效内容时继续保留默认标题；只有通过解析和版本校验的 AI 标题才能更新 `session.topic` 与 `session.mask.name`。
- 已保存的旧版首条消息临时标题在加载与正文水合时自动迁回默认标题，并继续进入当前可见会话的标题回填流程。

### 实现方式

- `app/store/chat.ts` 移除首条消息生成临时标题的逻辑；默认标题阶段只维护标题生成元数据，不改写 `session.topic`。
- `normalizeSession()` 识别 `titleFallbackText` 与当前 topic 相同的旧版临时标题，恢复默认 topic、mask 名称与待生成状态；手工命名或已生成标题不受影响。
- `shouldBackfillSessionTitle()` 仅处理已有完整问答、尚未生成 AI 标题且 topic 仍为默认值的会话。
- `docs/development.md` 同步明确默认标题、失败保留和旧数据迁移边界。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false`、Prettier 与 `git diff --check` 全部通过。
- 浏览器只读加载 `http://localhost:3000/`，新会话按钮和聊天页主标题均显示“新的聊天”，控制台无 warning/error。
- `nextchat-dev` 正常运行；宿主机与容器内 `app/store/chat.ts`、`docs/development.md` SHA-256 完全一致。

### 潜在或遗留问题

- 为避免写入远程聊天库和消耗 API 额度，本轮未发送真实测试消息；“发送后保持默认标题直到模型返回”的状态转换已通过写入点审查、类型检查和现有页面默认态验证。

============================================================

## 207. 【2026-07-24 09:33】- 消除路由升级警告并收敛标题回填取消日志

### 修改内容

- `BrowserRouter` 显式启用 `v7_startTransition` 与 `v7_relativeSplatPath`，消除 React Router v7 兼容警告；React DevTools 下载提示属于正常开发提示，不做拦截。
- 修复页面初始化标题回填产生 `[Chat Request Error] AbortError` 红色调用栈：主动取消统一识别为正常取消，只输出 `⏹️` 调试日志，不重试也不再记录标题生成错误。
- 页面初始化只为当前选中的可见会话安排标题回填；计时器触发时再次核对当前会话，避免为侧边栏多条历史会话并发发送隐藏标题请求。

### 实现方式

- `app/components/home.tsx` 在唯一 `BrowserRouter` owner 上设置两项 future flags。
- `app/utils/stale-revalidate.ts` 的 `isAbortLikeError()` 补充普通 `Error.name === "AbortError"` 识别；`app/client/platforms/openai.ts` 在通用请求 catch 中将主动取消与真实请求失败分流。
- `app/store/chat.ts` 在标题候选请求层返回明确 `aborted` 状态，自动与手动标题均静默终止；`scheduleSessionTitleBackfill()` 要求目标会话仍是当前会话。
- `docs/development.md` 同步记录路由兼容标志、可见会话回填边界和取消日志语义。

### 验证

- `yarn lint`、`npx tsc --noEmit --pretty false`、Prettier 与 `git diff --check` 全部通过。
- 干净加载 `http://localhost:3000/`，等待 2.2 秒覆盖标题回填窗口后，页面标题为 `NextChat`，浏览器控制台 warning/error 数量为 0。
- `nextchat-dev` 正常运行；宿主机与容器内 5 个目标文件 SHA-256 完全一致，开发容器已读取最新源码。

### 潜在或遗留问题

- 未人为构造真实模型请求中途取消；浏览器验证覆盖了首屏加载和标题回填等待窗口，主动取消分流同时通过静态类型与 lint 检查。

============================================================

## 206. 【2026-07-24 00:11】- 优化并修复自动与手动标题生成

### 修改内容

- 修复手动刷新已写回标题却仍返回失败的问题；自动与手动标题统一复用同一请求、重试、解析和写回链路，避免两套逻辑再次漂移。
- 恢复自动标题的有限触发策略：首次完整问答生成标题，只允许在前 3 条用户消息内再润色一次，不再每轮对话重复请求和持续改名。
- 标题请求锁只阻止重复标题请求，不再提前退出并跳过同一轮历史内存摘要。
- 标题 JSON 只接受显式 `title` / `topic` 字段，拒绝完整 `chat.completion`、错误对象和其他协议包；纯文本标题移除 Markdown 与常见标题前缀，超过 80 个字符时拒绝写回。
- 优化中英文标题提示词，中文建议 6 到 12 个汉字，其他语言不超过 6 个词，并要求沿用对话主要语言。

### 实现方式

- `app/store/chat.ts` 新增统一的标题文本规范化、纯文本上下文构建和候选请求函数；上下文只保留有效的用户/助手文本，按 `historyMessageCount` 截取，不重复发送图片、工具载荷、附件元数据和消息状态。
- 标题请求版本增加实际解析到的 `providerId` / `profileId`，返回时会重新核对消息数量、末条消息、模型与 Profile 身份，过期结果不写回。
- 网络瞬时失败仍只在同一最终模型和 API 上等待 400ms 后重试一次；手动请求与自动请求分别保留完整日志和余额不足终止语义。
- `docs/development.md` 同步记录触发频率、共享请求链、上下文边界、解析边界和内存摘要互不阻断的约定。

### 验证

- `yarn lint` 通过，无 ESLint warning/error。
- `npx tsc --noEmit --pretty false` 通过，无 TypeScript 错误。
- `git diff --check` 与目标文件 Prettier 检查通过。
- `nextchat-dev` 处于运行状态，仓库挂载到 `/app`；宿主机与容器内 4 个目标文件 SHA-256 完全一致，容器已读取最新源码。

### 潜在或遗留问题

- 未发起真实模型标题请求，避免消耗 API 额度和向远程聊天库写入测试会话；浏览器端自动生成、前三轮有限润色及手动刷新提示仍需用真实会话最终确认。

============================================================

## 205. 【2026-07-23 23:05】- 代码审查修复、插件加载动画优化

### 修改内容

- 代码审查修复：新增 `isLegacyPluginId()` 明确排除旧 `codeinterpreterapi` 插件 ID；重构 `isPluginRunnable` 条件逻辑为早返回模式，语义更清晰；`fetchOpenApiSpec` 统一使用 `CODE_INTERPRETER_PLUGIN_ID` 常量；Schema `files` 对象增加 `base64` 属性定义；删除未使用的 `shouldPrefetchBuiltinPluginSchema` 和 `fetchPluginSchema` 函数；`onRehydrateStorage(state)` 参数加下划线前缀。
- `PasswordInput` 组件禁用态优化：输入框和眼睛按钮在 `readOnly` 时同步禁用；添加 `password-input-disabled` 和 `password-eye-disabled` CSS 样式（cursor、opacity、灰色背景）。
- 插件加载动画优化：新增 `isToolLoading()` 函数统一判断工具加载状态；所有插件（搜索、CodeInterpreter 等）加载中时统一显示转圈图标；图标与文字改为垂直居中对齐（`align-items: center`，`gap: 5px`）。
- Code Interpreter 目录补充：新增上游 `requirements.txt` 和 `app.py`；本地构建 `codeinterpreter-api-local:latest` 镜像并启动 `codeinterpreter-local` 容器。
- Code Interpreter 部署文档：重写 `scripts/code-interpreter/README.md`，包含首次部署、日常操作、鉴权说明、回滚步骤等完整说明。

### 验证

- `npx tsc --noEmit` 通过，无类型错误。
- `yarn lint` 通过，无 ESLint 警告/错误。

============================================================

## 204. 【2026-07-23 13:27】- 固定插件集合并修复 Code Interpreter 下载链路

### 修改内容

- 保留 `codeinterpreterapi` 的内置插件身份，避免页面初始化时删除并重建插件后丢失 Bearer Token；插件请求头改用 Axios 默认请求头的 `common` 结构，使 Web 代理的 `X-Base-URL` 与鉴权头稳定随请求发送。
- Code Interpreter schema 切换到 `https://chat.dyxcloud.com/codeinterpreter` 自建入口并声明 Bearer 鉴权。
- 新增可复用 Dockerfile 和扩展依赖清单，安装 Gunicorn 以及 DOCX、XLSX、数据处理、图表、图片与 PDF 常用 Python 包，修复运行代码时 `ModuleNotFoundError: No module named 'docx'`，并确保干净镜像具备实际启动命令。
- Compose 健康检查改用 Python 标准库，不再依赖 `python:3.10-slim` 默认不存在的 `wget`；根 README 登记独立服务运维文档。
- 修复生成文件下载：自建解释器不再只返回 stdout/图片，而是捕获工作目录和 `/mnt/data` 中新生成的常见文件；NextChat 将其写入用户文件缓存并把真实下载 URL 返回模型，替代浏览器无法处理的 `sandbox:/mnt/data/...`。
- 本地 `localhost:3000` 自动把内置 Code Interpreter 以及指向项目公网解释器地址的现有自定义插件路由到 Docker 网络别名 `codeinterpreter-local:5000`，不再误调尚未更新的公网服务；Python 执行与 gunicorn worker 超时分别提高到 90/120 秒。
- 代理收到上游 HTML 5xx 时保留原始错误，不再错误触发 baseURL 自适配并重复 POST；插件错误正文改为独立日志，文件写入缓存成功后记录文件名、真实 URL 与大小。
- 本地隔离解释器不映射宿主机端口并关闭 Token 校验，避免现有自定义插件保存的生产 Token 与临时本地 Token 不一致而返回 401；生产 Compose 仍要求 `.env.codeinterpreter` 提供非空 Token。
- `Tavily Search & Extract` 和 `CodeInterpreter` 改为不可删除的内置固定只读插件，schema/content 从项目文件硬编码加载；插件页保留原有新增、启用、删除、URL 读取和内容编辑 UI，但固定插件的鉴权参数、URL 读取和 schema 内容只能查看，自定义插件仍可完整编辑。
- 同步与初始化统一通过 `normalizeFixedPluginState` 收敛固定插件数据，清除旧 Code 类插件并保证两个固定项始终存在；敏感 Token 不写入代码，Tavily 继续沿用已有 Token，CodeInterpreter 本地固定为无 Token 鉴权，同时保留后续用户新增的自定义插件及删除标记。
- 提交前安全审计确认 `.env.codeinterpreter.example` 只保留 `replace-with-a-random-secret` 占位符，真实 Bearer Token 不进入 Git 历史。

### 实现方式

- 固定插件 ID 为 `tavilysearch` 与 `PGy3Tgi25BQL4AU88lI5_`；`normalizeFixedPluginState` 在初始化、读取和同步合并时覆盖名称、schema、content、鉴权类型和启用状态，同时保留 Tavily 的既有 Token。
- CodeInterpreter 固定展示公网服务 URL 与 Bearer 授权定义；在 `localhost` / `127.0.0.1` 上自动改走 Docker 内网并允许本地无 Token 解释器运行，生产页面继续使用公网地址和已保存的生产 Token。
- `axiosConfigDefaults.headers.common` 同时承载代理目标与 Authorization；本地 Code Interpreter 固定无 Token，并通过 Docker 内网访问不映射宿主机端口的解释器。
- `scripts/code-interpreter/Dockerfile` 在构建阶段同时安装上游 `requirements.txt` 与仓库维护的 `requirements.nextchat.txt`，运行阶段继续复用原有双阶段镜像结构。
- 上游 `PyYAML==5.4.1` 需要兼容版 pip/setuptools/wheel/Cython 和关闭构建隔离；Dockerfile 固定构建工具范围、补充 `libpq-dev`，并默认使用阿里云 PyPI 镜像，避免干净构建的 `cython_sources` 与官方 PyPI 下载中断问题。
- 健康检查执行 `python -c` 请求容器内 Flask 根路径，避免额外安装探活工具。
- `nextchat_runtime.py` 包装上游 `/runcode` 入口，对 30MB 以内的 DOCX/XLSX/PDF/PPTX/CSV/文本/ZIP 等文件返回 base64、MIME 和大小后删除容器临时文件；`plugin.ts` 在工具结果进入模型前上传 `/api/cache/upload`、从 URL 提取 UUID 提交缓存，并将结果改写为 `/api/cache/<id>.<ext>`。
- Web 端只在页面主机为 `localhost` 或 `127.0.0.1`，且插件 ID 为 `codeinterpreterapi` 或配置地址精确匹配 `https://chat.dyxcloud.com/codeinterpreter` 时覆盖服务地址，生产页面及其他自定义插件不受影响。

### 验证

- `yarn lint` 通过，无 ESLint warning/error。
- Prettier 检查 `app/store/plugin.ts`、插件 schema、根 README、Code Interpreter README 和 Compose 均通过。
- `js-yaml` 与 JSON 针对性解析检查通过，确认 Compose 包含健康检查且 schema 指向预期自建 URL；`git diff --check` 通过。
- Apple Silicon 本地从干净上游源码成功构建 `codeinterpreter-api-local:latest`，所有 Python 扩展依赖和 Gunicorn 均安装成功。
- 本地容器只加入 `nextchat_default` Docker 网络、不映射宿主机端口；通过现有 `http://localhost:3000/api/proxy/runcode` 验证：无 Token 返回 HTTP 401，普通 Python 返回 HTTP 200 + `2`，导入 `python-docx` 并创建文档返回 HTTP 200 + `local docx ok`。
- 本地生成 `random_document.docx` 后，解释器返回正确 DOCX MIME、36587 字节和文件内容；经 3000 端口写入 `/api/cache/upload` 得到真实 `.docx` URL，随后下载返回 HTTP 200/36587 字节，解压 `word/document.xml` 确认包含 `download works`。
- 浏览器首次复测仍返回 sandbox 链接，定位为自定义插件实际指向 Compose 自动启动的旧 `codeinterpreter-local`，而先前新版只接管了 `codeinterpreter-local-v2`；已停止旧容器并由 `codeinterpreter-local-v6` 接管原网络别名。通过插件原地址再次生成 `/mnt/data/active_document.docx`，确认返回 files、正确 DOCX MIME 和 36590 字节。
- `npx tsc --noEmit --pretty false`、更新后的 `yarn lint` 和 `git diff --check` 均通过。
- 已重写当前 `ccc` 用户插件同步数据：只剩 `tavilysearch` 与 `PGy3Tgi25BQL4AU88lI5_`，方法数分别为 2 和 1，`deletedPluginIds` 清空。
- 未删除旧容器或镜像；最新 `codeinterpreter-local-v8` 使用 `TIMEOUT=90`、gunicorn `--timeout 120` 接管本地网络别名，仅加入 `nextchat_default`、无宿主机端口映射且 `AUTH_TOKEN` 为空；使用任意旧插件 Token 请求 `/runcode` 成功返回 `python-docx 1.1.2`。
- 经现有 3000 端口生成 `local_download_test.docx`，返回正确 MIME、36600 字节和 48800 字符 base64 文件内容；完整缓存链路返回 `/api/cache/939bef6e-b86a-4a2a-b2fb-6688e8c3fcad.docx`，提交 HTTP 200、下载 HTTP 200/36590 字节。

### 潜在或遗留问题

- 本条记录当时未获生产部署授权；生产镜像更新与公网文件返回验证现已由记录 213 完成。
