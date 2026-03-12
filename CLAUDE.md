# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

NextChat 是一个基于 Next.js 14 的跨平台 AI 聊天应用，支持多个 AI 服务提供商（OpenAI、Claude、Gemini、DeepSeek 等）。项目可作为 Web 应用（PWA）或 Tauri 桌面应用运行。

## 常用命令

### 开发

```bash
# 本地开发（包含 mask 监听）
yarn dev

# 仅启动 Next.js（不监听 mask）
next dev

# Tauri 桌面应用开发
yarn app:dev
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
# 运行测试
yarn test

# 运行测试（CI 模式）
yarn test:ci

# 代码检查
yarn lint
```

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
- **`app/store/sync.ts`** - 聊天记录同步（WebDAV）

### 存储架构

项目使用双层存储：

1. **IndexedDB** - 主要存储（`app/utils/indexedDB-storage.ts`）
   - 存储大量聊天记录
   - 支持自动迁移到旧版本浏览器

2. **localStorage** - 备用存储
   - 当 IndexedDB 不可用时回退
   - 存储小型配置项

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
- **`app/utils/sync.ts`** - WebDAV 同步
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
