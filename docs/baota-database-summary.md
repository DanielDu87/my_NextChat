# NextChat 宝塔面板部署 - 数据库配置总结

## 📋 数据库配置检查清单

### ✅ 已创建的配置文件

| 文件 | 说明 |
|------|------|
| `.env.baota` | 环境变量配置模板 |
| `docs/baota-database-setup.md` | 完整数据库配置指南 |
| `scripts/baota-init-db.sh` | 数据库初始化脚本 |

---

## 🗄️ 数据库配置要点

### 1. PostgreSQL 版本要求
- **最低版本**: PostgreSQL 12
- **推荐版本**: PostgreSQL 16
- **宝塔安装路径**: `/www/server/postgresql`

### 2. 数据库自动初始化

NextChat 会在首次启动时自动创建所有数据库表结构，无需手动执行 SQL。

**自动创建的内容：**
- ✅ 所有数据库表（14 个表）
- ✅ 索引和约束
- ✅ 触发器（自动更新时间戳）
- ✅ 辅助函数（UUID 生成等）

### 3. 必需的数据库权限

用户需要以下权限：
```sql
GRANT ALL PRIVILEGES ON DATABASE nextchat TO nextchat_user;
GRANT ALL PRIVILEGES ON SCHEMA public TO nextchat_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO nextchat_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO nextchat_user;
```

---

## 🔧 环境变量配置

### 必须配置的数据库变量

```bash
# 数据库连接配置（二选一）

# 方案 A: 使用独立参数（推荐）
PGHOST=127.0.0.1          # 数据库地址
PGPORT=5432               # 数据库端口
PGDATABASE=nextchat       # 数据库名称
PGUSER=nextchat_user      # 数据库用户
PGPASSWORD=your_password  # 数据库密码
PGSSL=false               # 是否使用 SSL
PGSSLMODE=disable         # SSL 模式

# 方案 B: 使用连接字符串
DATABASE_URL=postgresql://nextchat_user:your_password@127.0.0.1:5432/nextchat

# 连接池配置（可选）
PGPOOL_MAX=10                    # 最大连接数
PG_CONNECT_TIMEOUT_MS=10000      # 连接超时（毫秒）
PG_IDLE_TIMEOUT_MS=30000         # 空闲连接超时（毫秒）
```

### 配置优先级

如果同时配置了 `DATABASE_URL` 和独立参数（`PGHOST` 等），独立参数优先。

---

## 🚀 快速开始

### 方法 1：使用初始化脚本（推荐）

```bash
# 1. 上传脚本到服务器
cd /www/wwwroot/nextchat
chmod +x scripts/baota-init-db.sh

# 2. 运行初始化脚本
./scripts/baota-init-db.sh

# 3. 编辑生成的配置文件，添加 API 密钥
nano .env.baota.local
# 修改: CODE=your-password
# 修改: OPENAI_API_KEY=your-api-key

# 4. 部署应用
docker-compose --env-file .env.baota.local --profile no-proxy build
docker-compose --env-file .env.baota.local --profile no-proxy up -d
```

### 方法 2：手动配置

```bash
# 1. 在宝塔面板安装 PostgreSQL

# 2. 创建数据库（命令行）
sudo -u postgres psql
CREATE DATABASE nextchat;
CREATE USER nextchat_user WITH ENCRYPTED PASSWORD 'your_password';
GRANT ALL PRIVILEGES ON DATABASE nextchat TO nextchat_user;
\c nextchat
GRANT ALL PRIVILEGES ON SCHEMA public TO nextchat_user;
\q

# 3. 复制并编辑配置文件
cp .env.baota .env.baota.local
nano .env.baota.local
# 修改数据库密码和其他必填配置

# 4. 部署应用
docker-compose --env-file .env.baota.local --profile no-proxy up -d
```

---

## ⚠️ 常见问题

### 1. 认证失败

**错误信息**: `password authentication failed`

**解决方案**:
```bash
# 重置密码
sudo -u postgres psql
ALTER USER nextchat_user WITH PASSWORD 'new_password';
```

### 2. 权限不足

**错误信息**: `permission denied for table xxx`

**解决方案**:
```sql
-- 重新授权
\c nextchat
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO nextchat_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO nextchat_user;
```

### 3. 连接被拒绝

**错误信息**: `Connection refused`

**检查清单**:
- [ ] PostgreSQL 是否运行：`systemctl status postgresql`
- [ ] 端口是否正确：默认 5432
- [ ] 防火墙是否开放（远程数据库）

### 4. 表不存在

**错误信息**: `relation "app_users" does not exist`

**说明**: 这是正常的，应用会在首次启动时自动创建表。

**验证**: 检查容器日志确认表创建成功：
```bash
docker logs nextchat | grep -i "create table"
```

---

## 📊 数据库表结构

### 核心表

| 表名 | 说明 | 预估大小 |
|------|------|---------|
| `app_users` | 用户信息 | < 1 MB |
| `app_settings` | 用户配置 | < 1 MB |
| `provider_configs` | AI 供应商配置 | < 1 MB |
| `conversations` | 对话会话 | 取决于使用量 |
| `messages` | 聊天消息 | 取决于使用量 |

### 自动维护表

| 表名 | 说明 | 清理建议 |
|------|------|---------|
| `model_catalog` | 模型目录缓存 | 自动更新 |
| `user_model_refresh_states` | 用户模型刷新状态 | 7 天后清理 |
| `user_provider_balance_snapshots` | 余额快照 | 7 天后清理 |

---

## 💾 备份恢复

### 自动备份脚本

```bash
# 创建备份目录
mkdir -p /www/backup/nextchat

# 创建备份脚本
cat > /www/backup/backup_nextchat.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
PGPASSWORD=your_password pg_dump -h 127.0.0.1 -U nextchat_user nextchat | \
  gzip > /www/backup/nextchat/nextchat_$DATE.sql.gz
find /www/backup/nextchat -name "*.sql.gz" -mtime +7 -delete
EOF

chmod +x /www/backup/backup_nextchat.sh

# 添加到宝塔计划任务（每天凌晨 2 点）
```

### 恢复数据库

```bash
gunzip < /www/backup/nextchat/nextchat_20260329_020000.sql.gz | \
  PGPASSWORD=your_password psql -h 127.0.0.1 -U nextchat_user nextchat
```

---

## 🔍 监控和调试

### 检查数据库连接

```bash
# 从应用服务器测试
PGPASSWORD=your_password psql -h 127.0.0.1 -U nextchat_user -d nextchat -c "SELECT version();"

# 从容器内部测试
docker exec nextchat sh -c "PGPASSWORD=your_password psql -h 127.0.0.1 -U nextchat_user -d nextchat -c 'SELECT 1'"
```

### 检查 API 健康状态

```bash
# 浏览器访问
https://your-domain.com/api/db/health

# 或命令行
curl https://your-domain.com/api/db/health
```

### 查看数据库表

```sql
-- 连接到数据库
psql -h 127.0.0.1 -U nextchat_user -d nextchat

-- 查看所有表
\dt

-- 查看表大小
SELECT
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
```

---

## 📝 配置检查清单

部署前请确认以下配置：

### 数据库配置
- [ ] PostgreSQL 已安装（推荐版本 16）
- [ ] 数据库 `nextchat` 已创建
- [ ] 用户 `nextchat_user` 已创建并授权
- [ ] `.env.baota.local` 中数据库配置正确
- [ ] 数据库连接测试通过

### 应用配置
- [ ] `CODE` 访问密码已设置
- [ ] `OPENAI_API_KEY` 或其他 API Key 已配置
- [ ] 用户 ID 三个变量已配置且一致
- [ ] `NEXT_PUBLIC_DEFAULT_SYNC_USER_ID` 已配置（重要！）

### 网络配置
- [ ] 防火墙已开放必要端口
- [ ] Nginx 反向代理已配置
- [ ] SSL 证书已配置（如使用 HTTPS）

---

## 📚 相关文档

- [完整部署指南](./baota-deploy-guide.md)
- [部署注意事项清单](./baota-deploy-checklist.md)
- [数据库架构 SQL](../db/nextchat-postgres-schema.sql)
