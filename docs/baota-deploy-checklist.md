# NextChat 宝塔面板部署注意事项清单

## 🚨 关键配置（必须修改）

### 1. 用户标识配置 ⚠️
**问题：** 如果配置不正确，会导致数据无法加载或数据隔离错误

**必须配置的环境变量：**
```bash
# 三个变量必须保持一致
NEXTCHAT_DEFAULT_USER_ID=single-user
DEFAULT_SYNC_USER_ID=single-user
NEXT_PUBLIC_DEFAULT_SYNC_USER_ID=single-user  # 前端需要
```

**说明：**
- `NEXTCHAT_DEFAULT_USER_ID` - 后端使用
- `DEFAULT_SYNC_USER_ID` - 后端备用
- `NEXT_PUBLIC_DEFAULT_SYNC_USER_ID` - **前端使用，必须以 NEXT_PUBLIC_ 开头**

### 2. 代码构建注意事项 ⚠️
**问题：** `NEXT_PUBLIC_*` 变量在构建时嵌入代码，修改后必须重新构建

**修改环境变量后的步骤：**
```bash
# 1. 停止容器
docker-compose --env-file .env.baota.local --profile no-proxy down

# 2. 重新构建（重要！）
docker-compose --env-file .env.baota.local --profile no-proxy build

# 3. 启动容器
docker-compose --env-file .env.baota.local --profile no-proxy up -d
```

### 3. WebSocket 配置 ⚠️
**问题：** NextChat 使用 WebSocket 实现实时对话，Nginx 必须正确配置

**Nginx 必需配置：**
```nginx
proxy_set_header Upgrade $http_upgrade;
proxy_set_header Connection "upgrade";
proxy_buffering off;
```

---

## 🔧 常见问题

### 1. 访问密码错误

**原因：** CODE 配置的密码会经过 MD5 加存储

**解决方案：**
- 确保 CODE 配置正确
- 多个密码用逗号分隔：`CODE=password1,password2`
- 密码区分大小写

### 2. 数据库连接失败

**检查项：**
```bash
# 1. 检查 PostgreSQL 是否运行
systemctl status postgresql

# 2. 测试连接
psql -h 127.0.0.1 -U nextchat_user -d nextchat

# 3. 检查防火墙
ufw allow 5432
```

### 3. 镜像拉取失败（国内服务器）

**解决方案：**
```json
// /etc/docker/daemon.json
{
  "registry-mirrors": [
    "https://docker.m.daocloud.io",
    "https://docker.1panel.live"
  ]
}
```

### 4. 端口冲突

**检查：**
```bash
# 检查 3000 端口占用
netstat -tlnp | grep 3000

# 修改端口（.env.baota 中）
PORT=3001
```

---

## 📋 部署前检查清单

### 环境检查
- [ ] Docker 已安装
- [ ] Docker Compose 已安装
- [ ] PostgreSQL 已安装（或远程数据库可访问）
- [ ] Nginx 已安装

### 配置检查
- [ ] CODE 已配置（访问密码）
- [ ] OPENAI_API_KEY 或其他 API Key 已配置
- [ ] 用户 ID 三个变量已配置且一致
- [ ] 数据库连接信息正确
- [ ] 端口 3000 未被占用

### 网络检查
- [ ] 防火墙已放行必要端口
- [ ] 域名已解析到服务器（如使用域名）
- [ ] SSL 证书已申请（如使用 HTTPS）

---

## 🚀 快速部署命令

```bash
# 1. 创建目录
mkdir -p /www/wwwroot/nextchat
cd /www/wwwroot/nextchat

# 2. 克隆项目
git clone https://github.com/ChatGPTNextWeb/NextChat.git .

# 3. 配置环境变量
cp .env.baota .env.baota.local
nano .env.baota.local  # 修改必填配置

# 4. 构建并启动
docker-compose --env-file .env.baota.local --profile no-proxy build
docker-compose --env-file .env.baota.local --profile no-proxy up -d

# 5. 检查状态
docker logs -f nextchat
```

---

## 📝 配置文件对照表

| 环境变量 | 用途 | 是否必填 | 默认值 |
|---------|------|---------|--------|
| CODE | 访问密码 | ✅ 必填 | 无 |
| OPENAI_API_KEY | OpenAI API密钥 | ✅ 必填* | 无 |
| BASE_URL | API代理地址 | ❌ 可选 | 无 |
| NEXTCHAT_DEFAULT_USER_ID | 用户ID（后端） | ✅ 必填 | 无 |
| DEFAULT_SYNC_USER_ID | 用户ID（后端备用） | ✅ 必填 | 无 |
| NEXT_PUBLIC_DEFAULT_SYNC_USER_ID | 用户ID（前端） | ✅ 必填 | 无 |
| PGHOST | 数据库地址 | ✅ 必填 | 无 |
| PGPORT | 数据库端口 | ✅ 必填 | 5432 |
| PGDATABASE | 数据库名 | ✅ 必填 | nextchat |
| PGUSER | 数据库用户 | ✅ 必填 | 无 |
| PGPASSWORD | 数据库密码 | ✅ 必填 | 无 |
| PORT | 服务端口 | ❌ 可选 | 3000 |
| HIDE_USER_API_KEY | 隐藏用户API输入 | ❌ 可选 | true |
| DISABLE_GPT4 | 禁用GPT4 | ❌ 可选 | false |

*至少配置一个 AI 服务的 API Key

---

## 🔄 更新升级

```bash
cd /www/wwwroot/nextchat

# 拉取最新代码
git pull

# 重新构建并部署
docker-compose --env-file .env.baota.local --profile no-proxy build
docker-compose --env-file .env.baota.local --profile no-proxy up -d
```

---

## 💾 数据备份

```bash
# 备份数据库
pg_dump -h 127.0.0.1 -U nextchat_user nextchat > backup_$(date +%Y%m%d_%H%M%S).sql

# 备份环境配置
cp .env.baota.local .env.baota.local.backup

# 备份 Docker 数据卷
docker run --rm -v nextchat-data:/data -v $(pwd):/backup alpine tar czf /backup/nextchat-data-$(date +%Y%m%d).tar.gz /data
```
