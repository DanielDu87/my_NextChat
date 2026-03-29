# NextChat 宝塔面板部署指南（服务器已配置自定义 AI 提供商）

## 重要说明

本项目使用 **自定义构建的 NextChat Docker 镜像**，而非官方预构建镜像。

### 自定义镜像特性

- ✅ 已集成自定义 AI 提供商
- ✅ 服务器端配置 API Key
- ✅ 其他定制功能和优化

### 部署特点

因此部署时 **不需要** 配置 OpenAI API Key 或自定义 API 地址，这些已在镜像构建时配置。

**部署时只需配置：**
1. ✅ 访问密码（CODE）
2. ✅ 数据库连接信息
3. ✅ 用户标识配置

**可选配置：**
- ❌ OpenAI API Key（已由镜像配置）
- ❌ 自定义 API 地址（已由镜像配置）

**部署时只需配置：**
1. ✅ 访问密码（CODE）
2. ✅ 数据库连接信息
3. ✅ 用户标识配置

**可选配置：**
- ❌ OpenAI API Key（不需要，已由服务器配置）
- ❌ 自定义 API 地址（不需要，已由服务器配置）

---

## 🚀 5 分钟快速部署

### 第一步：创建网站（1 分钟）

1. **宝塔面板 -> 网站 -> 添加站点**
   - 域名：`your-domain.com`（或服务器 IP）
   - 根目录：`/www/wwwroot/nextchat`
   - PHP 版本：纯静态

### 第二步：创建数据库（2 分钟）

1. **宝塔面板 -> 软件商店 -> 安装 PostgreSQL 16**
2. **数据库 -> PostgreSQL -> 添加数据库**
   - 数据库名：`nextchat`
   - 用户名：`nextchat_user`
   - 密码：[设置强密码]

### 第三步：下载项目（1 分钟）

**在宝塔面板 -> 终端执行：**

```bash
cd /www/wwwroot
git clone https://github.com/ChatGPTNextWeb/NextChat.git nextchat
cd nextchat
```

### 第四步：配置环境（1 分钟）

```bash
# 创建配置文件
cat > .env.baota.local << 'EOF'
# 必填配置
PORT=3000
CODE=your-access-password-here

# 用户标识（三个必须一致）
NEXTCHAT_DEFAULT_USER_ID=single-user
DEFAULT_SYNC_USER_ID=single-user
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=single-user

# 数据库配置
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=nextchat
PGUSER=nextchat_user
PGPASSWORD=your-db-password-here
PGSSL=false

# 国内加速
ALPINE_MIRROR=https://mirrors.aliyun.com/alpine
NPM_REGISTRY=https://registry.npmmirror.com/

# 允许用户配置自己的 API Key（不隐藏输入框）
HIDE_USER_API_KEY=false
EOF

# 修改必填项
nano .env.baota.local
```

**只需修改：**
- `CODE` = 设置访问密码
- `PGPASSWORD` = 数据库密码

### 第五步：部署容器（3-5 分钟）

**宝塔面板 -> Docker -> Compose 项目**

1. **添加项目**
   - 名称：`NextChat`
   - 路径：`/www/wwwroot/nextchat`
   - Compose 文件：`docker-compose.baota.yml`
   - 环境文件：`.env.baota.local`

2. **构建**（首次需要 3-5 分钟）

3. **启动**

---

## 配置 Nginx（1 分钟）

**网站 -> NextChat -> 设置 -> 配置文件**

找到 `location / { ... }` 部分，替换为：

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_buffering off;
}
```

**保存 -> 重载配置**

---

## 验证部署

1. **浏览器访问** `https://your-domain.com`
2. **输入访问密码**（CODE 配置的密码）
3. **进入聊天界面**
4. **点击右上角设置图标**
5. **配置 AI 提供商**

### 配置自定义 AI 提供商

在设置页面中：
1. **点击 "API 配置" 或 "模型提供商"**
2. **选择你的 AI 提供商类型**
3. **填写 API Key 和 Base URL**
4. **保存配置**

---

## 用户使用流程

### 首次访问

1. **打开网站** → 输入访问密码
2. **进入聊天界面** → 点击右上角设置
3. **配置 AI 提供商** → 填写 API Key 和 Base URL
4. **保存配置** → 开始使用

### 后续使用

- 用户配置的 API Key 存储在浏览器本地
- 刷新页面后配置仍然保留
- 数据库存储聊天记录和用户设置

---

## 与完整版配置的区别

| 配置项 | 完整版 | 服务器已配置版 |
|--------|--------|---------------|
| 访问密码 CODE | 必填 | 必填 |
| OpenAI API Key | 必填 | ❌ 不需要 |
| 自定义 API 地址 | 必填 | ❌ 不需要 |
| HIDE_USER_API_KEY | true | **false**（允许用户配置） |
| 数据库配置 | 必填 | 必填 |
| 用户标识配置 | 必填 | 必填 |

---

## 宝塔面板管理

### 容器管理

**位置：** Docker -> 容器 -> nextchat

- 查看状态
- 查看日志
- 重启容器

### 网站管理

**位置：** 网站 -> 列表 -> NextChat

- 访问网站
- 查看访问日志
- 配置 SSL

### 数据库管理

**位置：** 数据库 -> PostgreSQL -> nextchat

- 管理数据库
- 备份数据

---

## 常见问题

### Q: 为什么不配置 OpenAI API Key？

**A:** 因为服务器已配置自定义 AI 提供商，用户可以在界面中自行配置自己的 API Key，更加灵活。

### Q: 多个用户可以配置不同的 API Key 吗？

**A:** 可以。每个用户在浏览器中配置自己的 API Key，存储在本地，互不影响。

### Q: 数据库中存储的是什么？

**A:**
- 聊天记录和对话历史
- 用户设置和偏好
- 配置的提供商信息
- 不存储用户的 API Key（存储在浏览器本地）

### Q: 如何重置用户配置？

**A:** 用户清除浏览器缓存或使用无痕模式即可重新配置。

---

## 配置文件说明

### .env.baota.local 必填项

```bash
# 访问密码
CODE=your-password

# 用户标识
NEXTCHAT_DEFAULT_USER_ID=single-user
DEFAULT_SYNC_USER_ID=single-user
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=single-user

# 数据库
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=nextchat
PGUSER=nextchat_user
PGPASSWORD=your-password
```

### 可选项（无需配置）

```bash
# AI 服务商配置（可选 - 留空即可）
OPENAI_API_KEY=
GOOGLE_API_KEY=
BASE_URL=

# 其他提供商配置（可选）
ANTHROPIC_API_KEY=
BAIDU_API_KEY=
# ... 等等

# 允许用户配置（设置为 false）
HIDE_USER_API_KEY=false
```

---

## 更新项目

```bash
cd /www/wwwroot/nextchat

# 拉取最新代码
git pull

# 在宝塔 Docker 管理器中
# Docker -> Compose 项目 -> NextChat -> 重新构建 -> 重启
```
