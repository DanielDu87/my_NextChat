# NextChat 项目指南

本文件供 Gemini CLI/兼容 AI 代理读取，规则需与 `AGENTS.md`、`CLAUDE.md` 保持一致。

## 项目概览

NextChat 是基于 Next.js 14、React、TypeScript、Zustand 和 SCSS Modules 的跨平台 AI 聊天应用，支持 Web/PWA 与 Tauri 桌面端。

## 目录结构

- `app/`：Next.js 应用核心代码。
- `app/components/`：聊天界面、设置、通用 UI 等组件。
- `app/store/`：Zustand 状态管理。
- `app/client/`：各模型 Provider 客户端。
- `app/api/`：服务端 API 路由。
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
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev up -d
./scripts/docker-compose-safe.sh --env-file .env.docker --profile dev logs -f nextchat-dev
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
- 提交范围默认 `git add -A`。
- 提交信息格式：`YYYY-MM-DD HH:MM 内容`。
- 不提交临时调试文件、历史 `.bak` 文件、空 `div*` 文件和一次性测试文件。
