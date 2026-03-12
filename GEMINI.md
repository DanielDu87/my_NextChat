# NextChat (原 ChatGPT-Next-Web) 项目指南

欢迎来到 NextChat 项目。这是一个一键部署、跨平台的个人 AI 助手解决方案，支持多种大语言模型（LLM），包括 OpenAI, Claude, Gemini, DeepSeek 等。

## 项目概览

- **核心定位**: 轻量级、高性能的跨平台 AI 聊天客户端。
- **主要技术栈**:
  - **前端**: Next.js (App Router), React, TypeScript.
  - **状态管理**: Zustand (配合持久化存储).
  - **样式**: Sass (SCSS Modules).
  - **桌面端**: Tauri (Rust).
  - **API 代理**: Next.js API Routes (处理跨域及鉴权).
- **特色功能**:
  - **Masks**: 预定义的提示词模板。
  - **Artifacts**: 独立窗口预览代码和网页内容。
  - **MCP (Model Context Protocol)**: 支持模型上下文协议。
  - **插件系统**: 支持联网搜索、计算器等扩展。
  - **PWA**: 支持渐进式 Web 应用。

## 目录结构

- `app/`: Next.js 应用核心代码。
  - `api/`: 服务端 API 路由，负责与各大模型厂商通信。
  - `components/`: UI 组件库。
  - `store/`: Zustand 状态管理仓库。
  - `masks/`: Mask 模板定义及构建脚本。
  - `client/`: 客户端 API 请求封装。
- `src-tauri/`: Tauri 桌面应用后端代码 (Rust)。
- `public/`: 静态资源及生成的配置文件（如 `masks.json`）。
- `scripts/`: 维护及构建辅助脚本。

## 运行与开发

### 环境准备

- Node.js >= 18
- Yarn (建议版本)
- Rust 环境 (仅桌面端开发需要)

### 关键命令

- **安装依赖**: `yarn install`
- **本地开发**: `yarn dev` (同时启动 Mask 监听和 Next.js 开发服务器)
- **生产构建**: `yarn build` (构建 standalone 版本的 Web 应用)
- **桌面端开发**: `yarn app:dev` (启动 Tauri 调试窗口)
- **桌面端构建**: `yarn app:build` (生成安装包)
- **Mask 构建**: `yarn mask` (手动将 `app/masks/` 下的 TS 定义转为 `public/masks.json`)

## 开发规范

### 1. 状态管理 (Zustand)
- 状态存储位于 `app/store/`。
- 使用 `createPersistStore` 进行持久化，确保存储键名（`StoreKey`）在 `app/constant.ts` 中统一定义。
- 状态更新应遵循不变量原则，优先在 store 内部定义更新 action。

### 2. API 通信
- 所有的模型请求应通过 `app/client/api.ts` 或对应的 provider 客户端。
- 敏感信息和 API Key 默认通过环境变量管理，服务端代理路径位于 `app/api/`。

### 3. UI 与样式
- 优先使用 SCSS Modules (`*.module.scss`) 以避免全局样式污染。
- UI 组件尽量保持原子化，通用组件放在 `app/components/ui-lib.tsx` 或相关目录。
- 支持响应式设计，适配桌面与移动端。

### 4. 国际化 (I18n)
- 语言文件位于 `app/locales/`。
- 添加新功能时，请确保在所有支持的语言文件中添加对应的文案。

## 环境变量配置

请参考 `.env.template` 创建 `.env.local` 文件。常用变量：
- `OPENAI_API_KEY`: OpenAI API 密钥。
- `CODE`: 访问密码。
- `BASE_URL`: API 代理地址。
- `ENABLE_MCP`: 是否启用 MCP 功能。

---
*注：本文件由 Gemini CLI 自动生成，作为项目上下文参考。*
