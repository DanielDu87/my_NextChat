# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working on code in this repository.

## 项目概述

NextChat 是一个基于 Next.js 14 的跨平台 AI 聊天应用，支持多个 AI 服务提供商（OpenAI、Claude、Gemini、DeepSeek 等）。项目可作为 Web 应用（PWA）或 Tauri 桌面应用运行。

## 数据库连接规范

**⚠️ 重要：本项目永远连接远程数据库，不使用本地 Docker PostgreSQL 容器作为数据存储。**

### 连接方式

应用通过 SSH 隧道连接远程数据库（42.193.15.117）：

```
本地应用 → host.docker.internal:15432 → SSH 隧道 → 远程数据库:5432
```

### 数据库规范

- ✅ **本地开发**：通过 SSH 隧道连接远程数据库
- ❌ **禁止使用**：本地 Docker PostgreSQL 容器（`--profile local-db`）
- ✅ **远程服务器部署**：直接连接本地数据库（localhost:5432）

### 开发前必须操作

启动应用前，必须先建立 SSH 隧道：

```bash
ssh -f -N -L 15432:127.0.0.1:5432 root@42.193.15.117 -p 222
```

详细说明请参考 [docs/development.md](./docs/development.md)

## Git 提交规范

**⚠️ 重要：只有用户明确说"提交"时才执行 git commit 和 push。**

### 提交规则

1. **不主动提交**
   - 开发过程中不自动提交代码
   - 完成修改后不主动提交
   - 只有当用户明确说"提交"、"commit"、"提交代码"等明确指令时才执行提交

2. **提交后自动推送**
   - 执行 `git commit` 后自动执行 `git push`
   - 确保本地提交同步到远程仓库

3. **提交信息格式**
   ```
   YYYY-MM-DD HH:MM 提交内容描述
   ```

### 提交流程

当用户说"提交"时：

```bash
# 1. 暂存所有修改
git add -A

# 2. 创建提交（使用规范格式）
git commit -m "$(cat <<'EOF'
2026-05-15 10:30 提交内容描述

详细说明（可选）

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
EOF
)"

# 3. 推送到远程
git push
```

### 示例对话

**错误示例（不要这样做）：**
```
用户: "修改完成了"
助手: [自动执行 git commit] ❌ 错误！
```

**正确示例：**
```
用户: "修改完成了"
助手: "修改已完成。" ✅ 正确，不提交

用户: "提交"
助手: [执行 git add、git commit、git push] ✅ 正确
```

## 常用命令

### 开发

**⚠️ 重要：本地开发必须使用 Docker 热加载模式，禁止直接使用 `yarn dev`。**

默认使用 `dev` profile 和 `scripts/docker-compose-safe.sh`。普通业务代码修改后依赖热加载，不要重启容器、不要重新构建镜像。

```bash
cp .env.docker.example .env.docker
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev build
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev logs -f nextchat-dev

# Tauri 桌面应用开发（例外，不走 Docker）
yarn app:dev
```

停止开发环境：

```bash
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev down
```

### 构建

```bash
# 构建 Web 应用（standalone 模式）
yarn build

# 构建静态导出
yarn export

# 构建 Tauri 桌面应用
yarn app:build

# 构建 mask（通常在 build 前自动执行）
yarn mask
```

### 测试与质量

```bash
# 代码检查
yarn lint

# 类型检查（当前会受 tsconfig 的 moduleResolution=node10 废弃提示影响）
npx tsc --noEmit --pretty false

# 生产构建
yarn build
```

说明：本仓库已移除 Jest 配置、`test/` 目录和 `yarn test` / `yarn test:ci` 脚本；不要再把它们作为默认验证命令。

### 其他

```bash
# 获取 prompts
yarn prompts
```

## 架构概览

### 状态管理（Zustand + Persist）

项目使用 Zustand 进行状态管理，配合自定义的持久化存储系统：

- **`app/store/chat.ts`** - 核心聊天状态（会话、消息、记忆压缩）
- **`app/store/config.ts`** - 应用配置（模型、主题、TTS 等）
- **`app/store/access.ts`** - API 访问控制（API Key、访问码）
- **`app/store/mask.ts`** - Prompt 模板（Masks）管理
- **`app/store/sync.ts`** - 聊天记录与配置同步（Database/WebDAV 等）

### 存储架构

项目当前使用双层存储：

1. **PostgreSQL** - 主要业务存储

   - 存储对话、配置、Prompt、Mask、插件、模型同步快照等核心数据

2. **localStorage** - 纯本地偏好存储
   - 存储语言、页面宽度、横幅关闭状态、临时输入草稿等设备级状态

### API 客户端架构

多服务提供商支持的抽象层：

- **`app/client/api.ts`** - `ClientApi` 类，根据提供商路由到具体实现
- **`app/client/platforms/*.ts`** - 各服务提供商的具体实现
  - `openai.ts` - OpenAI/Azure
  - `anthropic.ts` - Claude
  - `google.ts` - Gemini
  - `deepseek.ts` - DeepSeek
  - 等其他提供商...

每个平台实现 `LLMApi` 抽象类的 `chat()`、`speech()`、`usage()`、`models()` 方法。

### 关键组件

- **`app/components/chat.tsx`** - 主聊天界面
- **`app/components/sidebar.tsx`** - 侧边栏（会话列表）
- **`app/components/settings.tsx`** - 设置页面
- **`app/components/api-config.tsx`** - API 配置页面
- **`app/components/mask.tsx`** - Mask 编辑器
- **`app/components/artifacts.tsx`** - Artifacts 预览窗口

### MCP (Model Context Protocol)

MCP 功能位于 `app/mcp/` 目录：

- **`actions.ts`** - MCP 动作执行和工具获取
- **`client.ts`** - MCP 客户端管理
- **`types.ts`** - MCP 类型定义

MCP 通过 `ENABLE_MCP` 环境变量启用。

### 插件系统

插件支持位于 `app/store/plugin.ts` 和 `app/components/plugin.tsx`。插件仓库：`https://github.com/ChatGPTNextWeb/NextChat-Awesome-Plugins`

### 实时聊天

使用 Azure Realtime Audio SDK（`rt-client`）实现语音实时对话，相关配置在 `app/store/config.ts` 的 `realtimeConfig`。

### Tauri 桌面应用

桌面相关代码在 `src-tauri/` 目录，使用 Tauri 1.x API。

## 当前聊天 UI 注意事项

- 移动端流式输出时，用户轻微上滑应立即暂停自动贴底，不需要大幅滑动。
- 点击页面空白只负责收起输入焦点，不应触发自动回到底部。
- “回到底部”按钮采用类似点击标题滚到顶部的两帧滚动方式，避免虚拟消息窗口切换时出现大块空白。
- 点击标题滚到顶部时，即使正在流式输出，也必须暂停自动贴底。
- Token 用量行允许自动换行，窄屏或文本过长时不能撑破消息宽度。

## 清理规则

- 不提交临时调试文件、历史 `.bak` 文件、截图/浏览器误生成的空 `div*` 文件。
- 不提交一次性测试文件；如需验证，优先使用针对性脚本并在完成后清理。
- 当前仓库不维护 Jest 测试目录，相关文档不要再引用 `test/`、`jest.config.ts`、`jest.setup.ts`。

## 环境变量

关键环境变量（见 `.env.template`）：

- `OPENAI_API_KEY` - OpenAI API 密钥
- `CODE` - 访问密码（逗号分隔多个）
- `BASE_URL` - 自定义 API 代理地址
- `ENABLE_MCP` - 启用 MCP 功能
- `HIDE_USER_API_KEY` - 隐藏用户 API Key 输入
- `CUSTOM_MODELS` - 自定义模型列表
- `DEFAULT_MODEL` - 默认模型

## 样式系统

- **SCSS** - 使用 `sass` 包
- **CSS Modules** - `.module.scss` 文件
- **全局样式** - `app/styles/` 目录

## 工具函数

- **`app/utils/store.ts`** - Zustand 持久化存储创建器
- **`app/utils/chat.ts`** - 聊天相关工具
- **`app/utils/token.ts`** - Token 估算
- **`app/utils/chat-sync.ts` / `app/store/sync.ts`** - 聊天记录与状态同步
- **`app/utils/model.ts`** - 模型相关工具

## 构建模式

通过 `BUILD_MODE` 环境变量控制：

- `standalone` - 独立部署模式（默认）
- `export` - 静态导出模式

## 开发注意事项

1. **修改 store 后**：确保更新对应的 `version` 号和 `migrate` 函数
2. **添加新平台 API**：在 `app/client/platforms/` 创建文件，在 `ClientApi` 构造函数中添加 case
3. **Mask 系统**：Masks 是 prompt 模板，存储在 `app/masks/` 目录，构建时生成
4. **国际化**：语言文件在 `app/locales/` 目录
