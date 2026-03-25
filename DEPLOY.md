# NextChat 部署文档

本文档提供 NextChat 的完整部署指南，包括本地开发和服务器生产环境部署。

---

## 📋 目录

- [前置要求](#前置要求)
- [配置说明](#配置说明)
- [本地开发部署](#本地开发部署)
- [服务器生产部署](#服务器生产部署)
- [Docker 镜像加速](#docker-镜像加速)
- [常见问题](#常见问题)

---

## 前置要求

### 必需软件

- **Docker**: >= 20.10
- **Docker Compose**: >= 2.0

### 验证安装

```bash
docker --version
docker-compose --version
```

---

## 配置说明

### 环境变量配置

创建 `.env` 文件（可选，也可直接设置环境变量）：

```bash
# 必填项
OPENAI_API_KEY=sk-xxxxxxxxxxxxx
CODE=你的访问密码

# 可选项
GOOGLE_API_KEY=                    # Google API 密钥
BASE_URL=                          # 自定义 API 地址
HIDE_USER_API_KEY=true             # 隐藏用户 API 密钥输入
DISABLE_GPT4=false                 # 禁用 GPT-4
ENABLE_BALANCE_QUERY=false         # 启用余额查询

# 仅服务器部署
PROXY_URL=                         # 代理 URL（如 http://127.0.0.1:7890）
PORT=3000                          # 服务端口
IMAGE_TAG=latest                   # 镜像标签
```

---

## 本地开发部署

### 快速开始

```bash
# 启动开发环境（默认端口 3000）
docker-compose up

# 或指定端口
PORT=8080 docker-compose up

# 后台运行
docker-compose up -d

# 查看日志
docker-compose logs -f

# 停止服务
docker-compose down
```

### 开发模式特性

- ✅ **热加载**: 代码修改自动刷新，无需重启容器
- ✅ **源码挂载**: 本地代码实时同步到容器
- ✅ **独立 node_modules**: 避免宿主机依赖冲突
- ✅ **文件监听**: 自动检测 `app/` 目录变化

### 访问应用

打开浏览器访问: http://localhost:3000

**注意**: 如配置了 HTTP 代理，需在浏览器中排除 `localhost,127.0.0.1`。

---

## 服务器生产部署

### 方式一：使用本地构建镜像

```bash
# 1. 上传代码到服务器
git clone <your-repo> && cd NextChat

# 2. 配置环境变量
cp .env.example .env
nano .env  # 编辑配置

# 3. 构建并启动
docker-compose --profile production up -d

# 4. 查看状态
docker-compose --profile production ps
docker-compose --profile production logs -f
```

### 方式二：使用官方镜像（推荐）

```bash
# 1. 创建配置文件
cat > .env << EOF
OPENAI_API_KEY=sk-xxxxx
CODE=your-password
PORT=3000
EOF

# 2. 启动服务
docker-compose --profile official up -d
```

### 方式三：使用部署脚本

```bash
# 一键部署（详见 deploy.sh）
./deploy.sh production
```

### 配置反向代理（Nginx）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### 配置 SSL（Let's Encrypt）

```bash
# 安装 certbot
sudo apt install certbot python3-certbot-nginx

# 获取证书
sudo certbot --nginx -d your-domain.com

# 自动续期
sudo certbot renew --dry-run
```

---

## Docker 镜像加速

### 国内镜像源配置

编辑 `/etc/docker/daemon.json`：

```bash
sudo tee /etc/docker/daemon.json <<EOF
{
  "registry-mirrors": [
    "https://docker.1panel.live",
    "https://docker.m.daocloud.io",
    "https://registry.cn-hangzhou.aliyuncs.com"
  ],
  "max-concurrent-downloads": 10,
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  }
}
EOF

# 重启 Docker
sudo systemctl daemon-reload
sudo systemctl restart docker
```

### 验证配置

```bash
docker info | grep -A 10 "Registry Mirrors"
```

---

## 常见问题

### 1. 端口被占用

```bash
# 修改端口
PORT=8080 docker-compose up

# 或在 .env 中设置
echo "PORT=8080" >> .env
```

### 2. 容器无法启动

```bash
# 查看详细日志
docker-compose logs -f

# 重新构建镜像
docker-compose build --no-cache
docker-compose up -d
```

### 3. 热加载不工作

```bash
# 确保使用开发模式（不带 profile）
docker-compose up

# 检查文件监听
docker-compose exec nextchat-dev ls -la /app
```

### 4. npm 依赖安装失败

```bash
# 清理并重试
docker-compose down
docker volume rm nextchat-node_modules nextchat-next_cache
docker-compose up --build
```

### 5. 服务器性能优化

```bash
# 限制资源使用
docker-compose --profile production up -d \
  --scale nextchat-production=1

# 查看资源占用
docker stats nextchat
```

---

## 更新部署

### 本地开发

```bash
# 拉取最新代码
git pull

# 重建并启动
docker-compose up --build -d
```

### 服务器生产

```bash
# 方式一：使用本地构建
docker-compose --profile production pull
docker-compose --profile production up -d --build

# 方式二：使用官方镜像
docker-compose --profile official pull
docker-compose --profile official up -d
```

---

## 卸载

```bash
# 停止并删除容器
docker-compose down

# 删除数据卷
docker volume rm nextchat-node_modules nextchat-next_cache nextchat-data

# 删除镜像
docker rmi nextchat:latest
```

---

## 技术支持

- GitHub Issues: https://github.com/ChatGPTNextWeb/NextChat/issues
- 文档: https://github.com/ChatGPTNextWeb/NextChat/wiki
