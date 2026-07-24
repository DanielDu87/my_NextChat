# HANDOFF

记录最近 10 条关键修改。最新记录置顶，历史从新到旧排列。每条记录标题格式为 `## 序号. 【YYYY-MM-DD HH:MM】- 标题`，序号持续递增，最大 999，达到后从 1 开始。超过 10 条时自动删除底部最旧记录。实质修改完成并验证后更新一次，创建 commit 前核对并一起提交.

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

- 未获生产部署授权，因此服务器现有 Code Interpreter 镜像尚未重建；公网服务仍可能在 30 秒超时或缺少依赖，但本地 `localhost:3000` 已不再调用它。

============================================================

## 203. 【2026-07-22 12:30】- API 配置页新增配置按钮桌面端固定在最右

### 修改内容

- `/api_config` 页"配置条目"卡片标题右侧的"新增配置"按钮在桌面端不再随副标题/容器宽度漂移到下方，按钮永远固定在标题右上角；移动端（≤900px）维持 column + 100% 宽度沾满，符合"电脑端右对齐、移动端沾满"的双端行为。

### 实现方式

- 根因不在 `.profileSectionTitle` 本身，而是 ListItem 多层 flex 容器链：ui-lib 的 `.list-item > .list-header` 默认 `max-width: 70% / flex-shrink: 0` 把标题容器限到 70%。ListItem 渲染时给标题容器加的是**全局类** `nextchat-list-header` / `nextchat-list-item-title`，但 ui-lib 内部的 `.list-header` 规则编译后变成 hash 类（如 `.ui-lib_list-header__xxx`），此前 `.sectionCard :global(.list-header)` 字面选择器**根本没命中**，全部被静默忽略。
- `api-config.module.scss` 改用匹配**全局类** `.nextchat-list-header` / `.nextchat-list-item-title`，并加 `!important` 压过 ui-lib 的 hash 类同特异性规则。
- `.sectionCard :global(.nextchat-list-header)`：`align-items: flex-start !important; max-width: 100% !important; flex-shrink: 1 !important; width: 100% !important; box-sizing: border-box !important`。
- `.sectionCard :global(.nextchat-list-item-title), .sectionCard :global(.nextchat-list-item-title) > div`：`width: 100% !important; min-width: 0 !important; max-width: 100% !important; box-sizing: border-box !important; overflow: visible !important; text-overflow: clip !important; white-space: normal !important`。
- `.profileSectionTitle` 加 `max-width:100%; box-sizing:border-box; position:relative`，按钮加 `position:relative; z-index:2`，锁定布局上下文与层叠，避免任何溢出与被遮罩问题。
- `@media screen and (max-width: 900px)` 块的 `.profileSectionTitle { flex-direction: column; ... width: 100% !important }` 不动，移动端保持"独占一行沾满"。
- 同步修复 `/backup/api_config` 页"配置备份历史"卡片的"立即备份"按钮：api-config-backups.module.scss 的 `.historyHeader` 加同款 `flex-wrap:nowrap/max-width:100%/box-sizing:border-box/position:relative`，按钮加 `flex:0 0 auto/flex-shrink:0/margin-left:auto/white-space:nowrap/position:relative/z-index:2`；并对 `.nextchat-hover-card` 内的 `:global(.nextchat-list-header)` / `:global(.nextchat-list-item-title)` 加与 api-config 同款的 `!important` 锁定规则。`@media (max-width: 700px)` 的 `.historyHeader { flex-direction: column }` 不动，保留移动端独占一行行为。
- 同步修复 `/backup/chat` 页"对话备份历史"卡片的"立即备份"按钮：chat-backups.module.scss 的 `.historyHeader` 加全套 `!important`（`display:flex/flex-direction:row/justify-content:space-between`）防止被覆盖；`.createBackupButton` 关键修复是去掉原 `margin-right:15px`（把按钮推向右 15px 而非最右）改为 `margin-left:auto !important; margin-right:0 !important`，并加 `flex:0 0 auto/flex-shrink:0/align-self:flex-start/white-space:nowrap/position:relative/z-index:2`；并对 `.content > ... :global([class*="list-item"]).hoverCard` 内的 `:global(.nextchat-list-header)` / `:global(.nextchat-list-item-title)` 加同款 `!important` 锁定规则。chat-backups 用的是 CSS Modules 自引用 `.hoverCard` 而非 `nextchat-hover-card` 全局类（与 api-config-backups 不同），CSS Modules 自引用 `.hoverCard` 能正确匹配编译后的 hash 类。
- 实际诉求仅是"按钮右缘贴齐下方表格的右边框"：之前对 `.profileTable` 去掉 `border / border-radius / padding` 的多改动属于误判，已撤回；表格的 1px 边框、14px 圆角、行 padding 恢复原样。按钮与表格右边框对齐通过上文 `:global(.nextchat-list-header/max-width:100% !important)` + 按钮 `margin-left:auto` 自动实现：`.profileTable` 是 `width:100%`，表格右外缘 = sectionCard 内容区右缘 = 按钮右缘（被 `margin-left:auto` 推到 `.profileSectionTitle` 右缘、而 `.profileSectionTitle` 与表格都受同一 sectionCard 内容区约束）。
- 用户管理菜单（`user-menu.tsx` manageList 三行）"密码 / 对话数 / 最近对话"三列上下对齐：`user-menu.module.scss` 的 `.userIdentity` 由 `flex-shrink:0/min-width:0` 改为 `flex:0 0 130px; min-width:130px; max-width:130px`。`.userDetails` 是 grid + fr 列宽列宽依赖容器剩余宽度；用户名长度不同时 `.userIdentity` 自然宽窄不一，导致每行 `.userDetails` 剩余宽度不同，fr 列宽错位。把 `.userIdentity` 三轴定宽 130px 后，三行 `.userDetails` 剩余宽度严格一致，grid fr 比例列宽自然对齐，上下三行每列左/右缘对齐。
- 移动端（≤600px）该区域同样修复：上面桌面端把 `.userIdentity` 锁 130px 后，移动端仍在窄屏下生效，导致 `.userDetails` 被压到只剩少量空间、"当前"徽章被 `.userDetails` 内容溢出覆盖。`@media screen and (max-width: 600px)` 块内：`.userIdentity` 改回 `flex:0 0 auto; min-width:0; max-width:none` 让其弹性收缩、`.userRow { padding-right:64px }` 给徽章和操作位留更多空间、`.userBadge { right:40px; z-index:2; pointer-events:none }` 贴右置顶、`.rowAction { right:2px; width:32px; z-index:3 }` 收紧操作位、`.userDetailWide` 加 `min-width:0; overflow:hidden` + `.userInfoValue` 用 `text-overflow:ellipsis` 防最近对话时间戳溢出覆盖徽章。后面用户反馈移动端右边部分太宽：`.userRow { padding-right: 64px }` 收紧到 `36px`、`.badge { right: 40px }` 调到 `38px`，让 `.userDetails` 视觉上更靠右、`.rowAction` 不显空。再后第三列 fr 过大导致最近对话时间戳不被 ellipsis 截断、反而覆盖"当前"徽章：移动端 `.userDetails` 第三列 `minmax(96px, 1.45fr)` 改为 `minmax(80px, 1.1fr)`，3 列 fr 比例 0.55:0.7:1.1（总和 2.35）让第三列占约 47%（之前 53.7%），最小宽从 96 降到 80，时间戳更易触发 ellipsis 截断，不再溢出覆盖徽章。再后用户要求徽章改相对定位靠右：移动端 `.badge` 与 `.rowAction` 都由 `position:absolute` 改为 `position:relative; top:auto; right:auto; transform:none`，`.userRow { padding-right:0 }`，`.rowAction { margin-left:auto; align-self:center }` 把徽章和操作位都用 flex 流自然排在行末靠右，徽章紧贴 `.userDetails` 右外侧、`.rowAction` 32px 在最右缘，不再 absolute 浮在上面导致覆盖。撤回，恢复绝对定位方案；最后 `.badge { right: 38px }` 用户反馈不够右，改为 `right: 6px` 几乎贴行末右缘、`.rowAction { right: 32px; width: 32px }` 让操作位左移 30px 让出徽章空间、`.badge z-index:3 / .rowAction z-index:2` 徽章浮在操作位之上避免视觉重叠、`.userRow { padding-right: 72px }` 保证 `.userDetails` 不与两个 absolute 元素重叠。再后用户反馈徽章导致其他元素移动（ccc 行徽章占位、其他行无徽章 DOM，子节点数不同 → flex 流布局不一致）：`user-menu.tsx` 两处 ListItem 把 `effectiveUser.id === managedUser.id && (<div className={styles.badge}>当前</div>)` 改为总是渲染 `<div className={clsx(styles.badge, { [styles.badgeActive]: ... })}>`，并在非当前用户行加 `aria-hidden="true"`；新增 `.badgeActive { visibility:visible; background:var(--primary); color:#ffffff; border-radius:999px }`，默认 `.badge` 在桌面端与移动端都 `visibility:hidden / color:transparent / background:transparent / width:30px; height:18px; box-sizing:border-box` 占位，确保三行子节点一致，徽章只对当前用户生效并显绿色，其余两行徽章隐形但仍占位，ccc 行 vs admin/dyx 行的 `.rowAction` 右缘位置严格对齐。

### 验证

- 待人工确认：浏览器 ≥ 901px 宽度打开 `/api_config`，左侧标题文案无论长短，"新增配置"按钮都固定在右上；≤ 900px 宽度下按钮仍沾满整行居中。

============================================================
