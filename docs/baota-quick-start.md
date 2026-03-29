# NextChat 宝塔面板部署 - 快速上手

## 📋 部署前准备

- [ ] 服务器已安装宝塔面板
- [ ] 宝塔面板已安装 Docker
- [ ] 宝塔面板已安装 PostgreSQL 16
- [ ] 已准备好域名（或使用服务器 IP）
- [ ] 已准备好 OpenAI API Key

---

## 🚀 5 步完成部署

### 步骤 1：创建网站（1 分钟）

1. 宝塔面板 -> **网站**
2. 点击 **添加站点**
   - 域名：`your-domain.com`
   - 根目录：`/www/wwwroot/nextchat`
   - PHP 版本：纯静态
3. 点击 **提交**

### 步骤 2：创建数据库（2 分钟）

1. 宝塔面板 -> **软件商店** -> 安装 **PostgreSQL 16**
2. 宝塔面板 -> **数据库** -> **PostgreSQL**
3. 点击 **添加数据库**
   - 数据库名：`nextchat`
   - 用户名：`nextchat_user`
   - 密码：[设置密码并记住]
4. 记录数据库密码

### 步骤 3：上传项目（3 分钟）

在宝塔面板 -> **终端**执行：

```bash
cd /www/wwwroot
git clone https://github.com/ChatGPTNextWeb/NextChat.git nextchat
cd nextchat
```

### 步骤 4：配置环境（2 分钟）

```bash
# 创建配置文件
cat > .env.baota << 'EOF'
PORT=3000
CODE=your-password-here
OPENAI_API_KEY=your-api-key-here

NEXTCHAT_DEFAULT_USER_ID=single-user
DEFAULT_SYNC_USER_ID=single-user
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=single-user

PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=nextchat
PGUSER=nextchat_user
PGPASSWORD=your-db-password-here
PGSSL=false

ALPINE_MIRROR=https://mirrors.aliyun.com/alpine
NPM_REGISTRY=https://registry.npmmirror.com/

HIDE_USER_API_KEY=true
DISABLE_GPT4=false
EOF

# 编辑配置文件，修改密码和 API Key
nano .env.baota
```

**必填项：**
- `CODE` = 设置访问密码
- `OPENAI_API_KEY` = 你的 API 密钥
- `PGPASSWORD` = 数据库密码

### 步骤 5：部署容器（5-10 分钟）

**方法 A：使用宝塔 Docker 管理器（推荐）**

1. 宝塔面板 -> **Docker** -> **Compose 项目**
2. 点击 **添加项目**
3. 填写信息：
   - 名称：`NextChat`
   - 路径：`/www/wwwroot/nextchat`
   - Compose 文件：选择 `docker-compose.baota.yml`
   - 环境文件：`.env.baota`
4. 点击 **提交** -> 等待构建完成

**方法 B：使用命令行**

```bash
cd /www/wwwroot/nextchat
docker-compose -f docker-compose.baota.yml --env-file .env.baota build
docker-compose -f docker-compose.baota.yml --env-file .env.baota up -d
```

---

## 🔧 配置 Nginx（1 分钟）

1. 宝塔面板 -> **网站** -> 找到 NextChat 站点 -> **设置**
2. 点击 **配置文件**
3. 在 `location /` 部分替换为：

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

4. 保存 -> **重载配置**

---

## ✅ 验证部署

### 检查清单

- [ ] 浏览器访问 `https://your-domain.com`
- [ ] 看到 NextChat 登录页面
- [ ] 输入密码成功登录
- [ ] 首次打开后等待几秒，服务器 PostgreSQL 中已有的聊天和配置自动恢复到页面
- [ ] 宝塔 Docker -> 容器中看到 `nextchat` 运行中
- [ ] 宝塔网站列表中看到 NextChat 站点

---

## 📊 宝塔面板管理位置

| 功能 | 位置 |
|------|------|
| 查看容器状态 | Docker -> 容器 -> nextchat |
| 查看容器日志 | Docker -> 容器 -> nextchat -> 日志 |
| 重启容器 | Docker -> 容器 -> nextchat -> 重启 |
| 查看网站 | 网站 -> 列表 -> NextChat |
| 查看数据库 | 数据库 -> PostgreSQL -> nextchat |
| SSL 证书 | 网站 -> NextChat -> 设置 -> SSL |

---

## 🔄 更新项目

```bash
cd /www/wwwroot/nextchat
git pull
docker-compose -f docker-compose.baota.yml --env-file .env.baota build
docker-compose -f docker-compose.baota.yml --env-file .env.baota up -d
```

---

## 📝 常见问题

**Q: 容器启动失败？**
```bash
# 查看日志
docker logs nextchat

# 常见原因：
# 1. 数据库密码错误 -> 检查 .env.baota
# 2. 端口被占用 -> docker ps 检查
# 3. 环境变量缺失 -> 检查 NEXT_PUBLIC_* 变量
```

**Q: 网站无法访问？**
```bash
# 检查 Nginx 配置是否正确
# 检查容器是否运行：docker ps

# 测试容器内部
docker exec nextchat wget -qO- http://localhost:3000
```

**Q: 数据库连接失败？**
```bash
# 测试数据库连接
PGPASSWORD=your_password psql -h 127.0.0.1 -U nextchat_user -d nextchat

# 检查 PostgreSQL 是否运行
systemctl status postgresql
```
