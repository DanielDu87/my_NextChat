# NextChat 开发指南

## 部署场景说明

本项目支持两种部署场景，数据库连接方式不同：

### 场景一：本地开发环境

- **适用于**：在本地 Mac/Windows 开发机上开发
- **数据库连接**：通过 SSH 隧道连接远程数据库（42.193.15.117）
- **配置文件**：`.env`
- **连接方式**：`host.docker.internal:15432 → SSH 隧道 → 远程数据库:5432`
- **⚠️ 重要**：不使用本地 Docker PostgreSQL 容器，只连接远程数据库

### 场景二：远程服务器部署

- **适用于**：在 42.193.15.117 服务器上部署生产环境
- **数据库连接**：直接连接本地数据库（localhost）
- **配置文件**：`.env.production`
- **连接方式**：`localhost:5432 → 本地数据库`

**⚠️ 重要规范：**
- 本地开发永远连接远程数据库，不使用本地 Docker PostgreSQL 容器
- 永远不使用代理（HTTP_PROXY、HTTPS_PROXY）
- Docker 容器内和系统都不使用代理
- 确保配置文件中没有代理相关环境变量

---

## 本地开发环境配置

### 快速开始（推荐）

**一键启动 Docker 热加载开发环境：**

```bash
# 进入项目目录
cd /Users/dyx/Code/NextChat

# 运行启动脚本
./scripts/dev-docker-start.sh
```

脚本会自动完成所有准备工作，包括：
- ✅ 检查并建立 SSH 隧道
- ✅ 构建 Docker 镜像（首次需要 3-5 分钟）
- ✅ 启动开发容器
- ✅ 显示实时日志

**访问地址：** http://localhost:3000

**停止服务：**

```bash
# 停止容器
docker-compose --profile dev down

# 停止 SSH 隧道（可选）
./scripts/dev-stop.sh
```

---

## 本地开发环境配置（详细说明）



## 远程服务器部署配置

### 适用场景

在 42.193.15.117 服务器上部署生产环境时使用此配置。

### 数据库连接

**直接连接本地数据库，不使用 SSH 隧道。**

```
应用 → localhost:5432 → 本地 PostgreSQL
```

### 环境变量配置

使用 `.env.production` 配置文件：

```bash
# 生产环境数据库配置（直接连接本地）
PGHOST=localhost
PGPORT=5432
PGDATABASE=nextchat
PGUSER=dyx
PGPASSWORD=NrCCTyikNREXjiZ6
PGSSL=false

# 完整连接字符串
DATABASE_URL=postgresql://dyx:NrCCTyikNREXjiZ6@localhost:5432/nextchat

# 重要：永远不使用代理
# HTTP_PROXY=
# HTTPS_PROXY=
# NO_PROXY=
```

### 部署步骤

#### 1. 准备环境

```bash
# 1. 克隆代码到服务器
git clone <repository-url> /path/to/nextchat
cd /path/to/nextchat

# 2. 复制生产环境配置
cp .env.production .env

# 3. 根据实际情况修改配置
nano .env
```

#### 2. Docker 部署方式

```bash
# 1. 构建并启动容器
docker-compose up -d --build

# 2. 查看日志
docker-compose logs -f nextchat

# 3. 验证服务状态
curl http://localhost:3000/api/config
```

**docker-compose.yml 配置要点：**

```yaml
services:
  nextchat:
    environment:
      # 确保不使用代理
      - HTTP_PROXY=
      - HTTPS_PROXY=
      - NO_PROXY=
      # 数据库连接本地
      - PGHOST=localhost
      - PGPORT=5432
    network_mode: host  # 使用宿主机网络，方便访问本地数据库
```

#### 3. 直接运行方式

```bash
# 1. 安装依赖
yarn install

# 2. 构建生产版本
yarn build

# 3. 启动生产服务器
yarn start
```

### 重要规范

**⚠️ 代理配置规范：**

1. **永远不使用代理**
   - 不设置 `HTTP_PROXY`、`HTTPS_PROXY` 环境变量
   - Docker 容器内不使用代理
   - 系统级别不使用代理

2. **验证代理未启用**
   ```bash
   # 检查环境变量
   env | grep -i proxy
   
   # 应该没有任何输出，或者值为空
   ```

3. **Docker 容器代理配置**
   ```yaml
   # docker-compose.yml 中明确禁用代理
   environment:
     - HTTP_PROXY=
     - HTTPS_PROXY=
     - NO_PROXY=
   ```

---

## 本地开发环境配置（续）

### 远程数据库信息

- **服务器地址**: 42.193.15.117
- **SSH 端口**: 222
- **数据库端口**: 5432（通过 SSH 隧道映射到本地 15432）
- **数据库名**: nextchat
- **用户名**: dyx

### 连接方式

应用通过 SSH 隧道连接远程数据库：

```
本地应用 → host.docker.internal:15432 → SSH 隧道 → 42.193.15.117:5432
```

## 本地开发环境启动

### 前置条件

1. 确保已安装 Docker 和 Docker Compose
2. 确保已安装 Node.js 18+ 和 Yarn
3. 确保 `.env` 文件配置正确（见下文）

### 启动步骤

#### 1. 建立 SSH 隧道（必须）

在启动应用前，必须先建立 SSH 隧道连接远程数据库：

```bash
# 建立 SSH 隧道，将远程 5432 端口映射到本地 15432
ssh -f -N -L 15432:127.0.0.1:5432 root@42.193.15.117 -p 222
```

**参数说明：**
- `-f`: 后台运行
- `-N`: 不执行远程命令，仅建立隧道
- `-L 15432:127.0.0.1:5432`: 本地 15432 端口映射到远程 5432

**验证隧道是否建立成功：**

```bash
# 检查隧道进程
ps aux | grep "ssh.*15432" | grep -v grep

# 检查端口监听
lsof -i :15432
```

**关闭 SSH 隧道：**

```bash
# 查找进程 ID
ps aux | grep "ssh.*15432" | grep -v grep

# 杀死进程
kill <PID>
```

#### 2. 启动方式选择

根据开发需求选择以下启动方式之一：

---

### 方式一：Docker 热加载模式（推荐）

**适用于日常开发，代码挂载实现热更新，无需重启容器。**

使用一键启动脚本：

```bash
# 快速启动（推荐）
./scripts/dev-docker-start.sh
```

或手动启动：

```bash
# 1. 建立 SSH 隧道（如果还没有）
ssh -f -N -L 15432:127.0.0.1:5432 root@42.193.15.117 -p 222

# 2. 启动 Docker 开发容器
docker-compose --profile dev up -d --build

# 3. 查看日志
docker-compose logs -f nextchat-dev

# 4. 停止容器
docker-compose --profile dev down
```

**特点：**
- ✅ 代码修改后自动热更新（挂载代码目录）
- ✅ 环境隔离，与生产环境一致
- ✅ 无需本地安装 Node.js
- ✅ 支持 React Fast Refresh
- ✅ 实时查看修改效果
- ⚠️ 首次启动需要构建镜像（约 3-5 分钟）

**访问地址：** http://localhost:3000

**工作原理：**
- 代码目录挂载到容器：`.:/app`
- node_modules 使用独立卷：避免宿主机干扰
- 容器内运行 `yarn dev`：支持热更新

---

### 方式二：本地热加载模式

适用于不想使用 Docker 的开发场景。

```bash
# 1. 安装依赖
yarn install

# 2. 启动开发服务器（包含 mask 监听）
yarn dev

# 或者仅启动 Next.js（不监听 mask）
yarn next dev
```

**特点：**
- ✅ 代码修改后自动热更新
- ✅ 启动速度快
- ✅ 支持 React Fast Refresh
- ⚠️ 需要本地安装 Node.js 18+
- ⚠️ 环境可能与生产不一致

**访问地址：** http://localhost:3000

---

### 方式三：Tauri 桌面应用开发

适用于桌面应用开发和测试。

```bash
# 1. 安装依赖
yarn install

# 2. 启动 Tauri 开发模式
yarn app:dev
```

**特点：**
- ✅ 桌面应用环境
- ✅ 支持热更新
- ✅ 原生系统集成
- ⚠️ 需要安装 Rust 和 Tauri CLI

---

## 环境变量配置

### .env 文件配置（必须）

确保 `.env` 文件包含以下配置：

```bash
# 远程数据库配置（通过 SSH 隧道连接）
PGHOST=host.docker.internal
PGPORT=15432
PGDATABASE=nextchat
PGUSER=dyx
PGPASSWORD=NrCCTyikNREXjiZ6
PGSSL=false

# SSH 隧道配置
SSH_TUNNEL_HOST=42.193.15.117
SSH_TUNNEL_PORT=222
SSH_TUNNEL_USER=root
SSH_TUNNEL_PASSWORD=123qweZC
SSH_TUNNEL_REMOTE_HOST=127.0.0.1
SSH_TUNNEL_REMOTE_PORT=5432
SSH_TUNNEL_LOCAL_PORT=15432

# 访问密码
CODE=nextchat@local123

# WebDAV 同步配置（可选）
WHITE_WEBDAV_ENDPOINTS=https://webdav.dyxcloud.com/
WEBDAV_USERNAME=dyx
WEBDAV_PASSWORD=dyx123
```

### 配置说明

**关键配置项：**

1. **PGHOST=host.docker.internal**
   - Docker 容器访问宿主机的特殊域名
   - 热加载模式下可以使用 `localhost` 或 `127.0.0.1`

2. **PGPORT=15432**
   - SSH 隧道在宿主机上的本地端口
   - 必须与 SSH 隧道的 `-L` 参数一致

3. **DATABASE_URL**
   - 完整的数据库连接字符串
   - 格式：`postgresql://用户名:密码@主机:端口/数据库名`

---

## 开发工作流

### 完整启动流程

```bash
# 1. 建立 SSH 隧道（每次开机后执行一次）
ssh -f -N -L 15432:127.0.0.1:5432 root@42.193.15.117 -p 222

# 2. 验证隧道连接
lsof -i :15432

# 3. 启动开发服务器
yarn dev

# 4. 访问应用
open http://localhost:3000
```

### 常用开发命令

```bash
# 代码检查
yarn lint

# 运行测试
yarn test

# 构建生产版本
yarn build

# 构建 mask
yarn mask

# 获取 prompts
yarn prompts

# 构建 Tauri 桌面应用
yarn app:build
```

---

## 数据库操作

### 连接远程数据库

通过 SSH 隧道连接后，可以使用以下方式操作数据库：

**方式一：使用 Docker 容器中的 psql**

```bash
docker exec nextchat-postgres psql \
  -h host.docker.internal \
  -p 15432 \
  -U dyx \
  -d nextchat
```

**方式二：使用 Node.js 脚本**

项目根目录下的 `check-remote-db.js` 可以快速查询远程数据库：

```bash
node check-remote-db.js
```

### 常用数据库查询

```sql
-- 查看所有用户
SELECT id, username, display_name, role, created_at 
FROM app_users 
ORDER BY created_at DESC;

-- 查看会话数量
SELECT COUNT(*) FROM conversations;

-- 查看消息数量
SELECT COUNT(*) FROM messages;

-- 查看 API 配置
SELECT id, provider, base_url, created_at 
FROM api_configs 
ORDER BY created_at DESC;
```

---

## 故障排查

### 问题 1：无法连接数据库

**症状：** 应用启动报错 `connection refused` 或 `ECONNREFUSED`

**解决方案：**

1. 检查 SSH 隧道是否建立：
   ```bash
   lsof -i :15432
   ```

2. 如果没有输出，重新建立隧道：
   ```bash
   ssh -f -N -L 15432:127.0.0.1:5432 root@42.193.15.117 -p 222
   ```

3. 验证远程数据库是否可访问：
   ```bash
   node check-remote-db.js
   ```

### 问题 2：Docker 容器无法访问宿主机端口

**症状：** Docker 模式下无法连接数据库

**解决方案：**

1. 确认 `.env` 中使用 `host.docker.internal`：
   ```bash
   PGHOST=host.docker.internal
   ```

2. 如果是 Linux 系统，需要添加 `--add-host` 参数：
   ```yaml
   # docker-compose.yml
   extra_hosts:
     - "host.docker.internal:host-gateway"
   ```

### 问题 3：SSH 隧道断开

**症状：** 开发过程中突然无法连接数据库

**解决方案：**

1. 杀死旧的隧道进程：
   ```bash
   pkill -f "ssh.*15432"
   ```

2. 重新建立隧道：
   ```bash
   ssh -f -N -L 15432:127.0.0.1:5432 root@42.193.15.117 -p 222
   ```

### 问题 4：端口被占用

**症状：** SSH 隧道建立失败，提示端口已被占用

**解决方案：**

1. 查找占用端口的进程：
   ```bash
   lsof -i :15432
   ```

2. 杀死占用进程：
   ```bash
   kill -9 <PID>
   ```

---

## 最佳实践

### 1. 开发前检查清单

- [ ] SSH 隧道已建立并正常工作
- [ ] `.env` 文件配置正确
- [ ] 依赖已安装（`yarn install`）
- [ ] 远程数据库可访问

### 2. Git 提交规范

**⚠️ 重要规则：**

1. **不主动提交和推送**
   - 开发过程中不自动提交代码
   - 只有当用户明确说"提交"时才执行 `git commit`
   - 提交后自动推送到远程仓库

2. **提交信息格式**
   ```
   YYYY-MM-DD HH:MM 提交内容描述
   ```

3. **提交流程**
   ```bash
   # 用户说"提交"时执行：
   git add -A
   git commit -m "2026-05-15 10:30 优化数据库连接配置，添加开发文档"
   git push
   ```

**示例对话：**

```
用户: "修改完成了"
助手: [不提交，仅确认修改完成]

用户: "提交"
助手: [执行 git add、git commit、git push]
```

### 3. 数据库操作规范

- ⚠️ **永远连接远程数据库**，不使用本地 Docker PostgreSQL
- ⚠️ 生产环境操作前务必备份数据
- ⚠️ 避免在开发环境执行 `DROP TABLE` 等危险操作
- ✅ 使用事务处理批量数据修改
- ✅ 定期检查数据库连接状态

### 4. 性能优化建议

- 使用热加载模式进行日常开发（启动快）
- 仅在需要完整测试时使用 Docker 模式
- 定期清理 `node_modules` 和重新安装依赖
- 使用 `yarn build` 验证生产构建是否正常

---

## 相关文档

- [CLAUDE.md](../CLAUDE.md) - 项目架构和技术栈说明
- [docker-deploy-cn.md](./docker-deploy-cn.md) - Docker 部署指南
- [local-dev-guide.md](./local-dev-guide.md) - 本地开发指南（旧版）
- [database-quick-fix.md](./database-quick-fix.md) - 数据库问题修复指南

---

## 技术支持

如遇到问题，请按以下顺序排查：

1. 检查 SSH 隧道状态
2. 验证 `.env` 配置
3. 查看应用日志
4. 查看数据库连接日志
5. 参考故障排查章节

**日志查看：**

```bash
# 热加载模式：直接在终端查看
yarn dev

# Docker 模式：查看容器日志
docker-compose logs -f nextchat
```
