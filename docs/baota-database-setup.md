# NextChat 宝塔面板数据库配置指南

## 数据库架构概览

NextChat 使用 PostgreSQL 存储所有数据，包括：
- 用户数据（app_users）
- 对话历史（conversations, messages）
- 配置设置（app_settings）
- API 配置（provider_configs, provider_api_keys）
- 模型目录（model_catalog）
- 同步缓存（多个缓存表）

**版本要求：PostgreSQL 12+（推荐 PostgreSQL 16）**

---

## 方法一：宝塔面板安装 PostgreSQL（推荐）

### 1. 安装 PostgreSQL

1. **登录宝塔面板**
2. **软件商店 -> 搜索 "PostgreSQL"**
3. **选择 PostgreSQL 16 点击安装**
4. **等待安装完成**

### 2. 创建数据库和用户

#### 通过宝塔面板创建：

1. **数据库 -> PostgreSQL**
2. **添加数据库**
   - 数据库名：`nextchat`
   - 用户名：`nextchat_user`
   - 密码：[设置强密码，记住它]
   - 访问权限：`localhost`（如果应用和数据库在同一服务器）

#### 通过命令行创建：

```bash
# 切换到 postgres 用户
sudo -u postgres psql

# 执行以下 SQL 命令
CREATE DATABASE nextchat;
CREATE USER nextchat_user WITH ENCRYPTED PASSWORD 'your_secure_password_here';
GRANT ALL PRIVILEGES ON DATABASE nextchat TO nextchat_user;
\q
```

### 3. 配置 PostgreSQL 访问权限

#### 编辑 pg_hba.conf（如需要）：

```bash
# 找到配置文件
sudo find /www/server -name pg_hba.conf

# 编辑文件，确保有这一行（本地访问）
sudo nano /www/server/postgresql/pg_hba.conf

# 添加或确认以下行：
local   all             all                                     md5
host    nextchat        nextchat_user   127.0.0.1/32          md5
```

#### 重启 PostgreSQL：

```bash
# 宝塔面板操作：
# 软件商店 -> PostgreSQL -> 重载配置

# 或命令行：
sudo systemctl restart postgresql
```

---

## 方法二：使用远程 PostgreSQL

如果数据库在其他服务器：

### 1. 服务器端配置

```bash
# 编辑 pg_hba.conf 允许远程连接
sudo nano /etc/postgresql/16/main/pg_hba.conf

# 添加应用服务器 IP
host    nextchat        nextchat_user   YOUR_APP_SERVER_IP/32    md5

# 编辑 postgresql.conf 监听所有地址
sudo nano /etc/postgresql/16/main/postgresql.conf
# 修改: listen_addresses = '*'

# 重启
sudo systemctl restart postgresql
```

### 2. 防火墙配置

```bash
# 开放 PostgreSQL 端口
sudo ufw allow 5432/tcp

# 宝塔面板操作：
# 安全 -> 添加端口规则 -> 端口 5432
```

### 3. 测试远程连接

```bash
# 从应用服务器测试
psql -h REMOTE_DB_IP -U nextchat_user -d nextchat
```

---

## 环境变量配置

### .env.baota 数据库配置部分

```bash
# ---------------------------------------------------------------------------
# 数据库配置 - 宝塔 PostgreSQL
# ---------------------------------------------------------------------------
# 使用本地宝塔 PostgreSQL
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=nextchat
PGUSER=nextchat_user
PGPASSWORD=your_secure_password_here
PGSSL=false
PGSSLMODE=disable

# 连接池配置（可选）
PGPOOL_MAX=10
PG_CONNECT_TIMEOUT_MS=10000
PG_IDLE_TIMEOUT_MS=30000

# 或者使用 DATABASE_URL（二选一）
# DATABASE_URL=postgresql://nextchat_user:your_secure_password_here@127.0.0.1:5432/nextchat
```

### 远程数据库配置

```bash
# 使用远程 PostgreSQL
PGHOST=your-remote-db-ip
PGPORT=5432
PGDATABASE=nextchat
PGUSER=nextchat_user
PGPASSWORD=your_secure_password_here
PGSSL=false
PGSSLMODE=disable

# 远程数据库建议开启 SSL
# PGSSL=true
# PGSSLMODE=require
```

---

## 数据库表结构（自动创建）

**重要：** NextChat 会在首次启动时自动创建所需的数据库表结构，无需手动执行 SQL。

### 核心表说明

| 表名 | 说明 | 数据量预估 |
|------|------|-----------|
| app_users | 用户信息 | 少量 |
| app_settings | 用户配置设置 | 少量 |
| conversations | 对话会话 | 中等 |
| messages | 聊天消息 | 大量 |
| provider_configs | AI 供应商配置 | 少量 |
| provider_api_keys | API 密钥存储 | 少量 |
| model_catalog | 模型目录缓存 | 中等 |

### 自动创建的函数

- `generate_uuid_v4()` - UUID 生成
- `set_updated_at()` - 自动更新时间戳

---

## 验证数据库连接

### 1. 在启动容器前测试

```bash
# 从服务器命令行测试
PGPASSWORD=your_password psql -h 127.0.0.1 -U nextchat_user -d nextchat -c "SELECT version();"
```

### 2. 检查数据库健康状态

```bash
# 容器启动后检查
docker exec nextchat sh -c "
  PGPASSWORD=your_password psql -h 127.0.0.1 -U nextchat_user -d nextchat -c '
    SELECT
      current_database,
      current_user,
      version() as version
  '
"
```

### 3. 查看数据库 API 健康检查

```bash
# 浏览器访问
https://your-domain.com/api/db/health

# 应该返回数据库信息 JSON
```

---

## 数据库维护

### 日常备份

```bash
# 创建备份脚本
cat > /www/backup/backup_nextchat.sh << 'EOF'
#!/bin/bash
BACKUP_DIR="/www/backup/nextchat"
DATE=$(date +%Y%m%d_%H%M%S)
mkdir -p $BACKUP_DIR

# 备份数据库
PGPASSWORD=your_password pg_dump -h 127.0.0.1 -U nextchat_user nextchat | gzip > $BACKUP_DIR/nextchat_$DATE.sql.gz

# 删除 7 天前的备份
find $BACKUP_DIR -name "nextchat_*.sql.gz" -mtime +7 -delete

echo "Backup completed: nextchat_$DATE.sql.gz"
EOF

# 设置执行权限
chmod +x /www/backup/backup_nextchat.sh

# 添加到宝塔计划任务
# 计划任务 -> 添加任务 -> shell脚本
# 每天凌晨 2 点执行：/www/backup/backup_nextchat.sh
```

### 恢复数据库

```bash
# 解压并恢复
gunzip < /www/backup/nextchat/nextchat_20260329_020000.sql.gz | \
  PGPASSWORD=your_password psql -h 127.0.0.1 -U nextchat_user nextchat
```

### 数据库清理（定期）

```sql
-- 连接到数据库
psql -h 127.0.0.1 -U nextchat_user -d nextchat

-- 查看表大小
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- 清理已删除的对话数据（30 天前）
DELETE FROM messages
WHERE conversation_id IN (
  SELECT id FROM conversations
  WHERE is_deleted = true
  AND deleted_at < NOW() - INTERVAL '30 days'
);

-- 清理旧的同步缓存
DELETE FROM user_model_refresh_states WHERE updated_at < NOW() - INTERVAL '7 days';
DELETE FROM user_provider_balance_snapshots WHERE updated_at < NOW() - INTERVAL '7 days';

-- 清理数据库
VACUUM ANALYZE;
```

---

## 常见问题排查

### 问题 1：连接被拒绝

```
error: Connection refused
```

**解决：**
1. 检查 PostgreSQL 是否运行：`systemctl status postgresql`
2. 检查端口是否正确：默认 5432
3. 检查防火墙是否开放端口

### 问题 2：认证失败

```
error: password authentication failed
```

**解决：**
1. 检查 `.env.baota` 中的密码是否正确
2. 重置数据库密码：
   ```sql
   ALTER USER nextchat_user WITH PASSWORD 'new_password';
   ```

### 问题 3：权限不足

```
ERROR: permission denied for table app_users
```

**解决：**
```sql
-- 重新授权
GRANT ALL PRIVILEGES ON DATABASE nextchat TO nextchat_user;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO nextchat_user;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO nextchat_user;
```

### 问题 4：表不存在

```
ERROR: relation "app_users" does not exist
```

**解决：**
- 这是正常的，NextChat 会在首次启动时自动创建表
- 检查容器日志：`docker logs nextchat`
- 确认数据库连接配置正确

### 问题 5：连接超时

```
error: Connection timed out
```

**解决：**
1. 检查 `PG_CONNECT_TIMEOUT_MS` 配置（默认 10000ms）
2. 检查数据库负载：`top` 查看 PostgreSQL 进程
3. 检查网络连接（远程数据库）

---

## 性能优化建议

### PostgreSQL 配置优化

编辑 `/www/server/postgresql/data/postgresql.conf`：

```ini
# 连接设置
max_connections = 100
shared_buffers = 256MB
effective_cache_size = 1GB

# 查询优化
random_page_cost = 1.1
effective_io_concurrency = 200

# 写入优化
wal_buffers = 16MB
checkpoint_completion_target = 0.9
```

### 创建索引优化查询

```sql
-- 为常用查询创建额外索引
CREATE INDEX IF NOT EXISTS idx_conversations_user_updated
ON conversations(user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_seq
ON messages(conversation_id, seq);
```

---

## 监控数据库状态

### 查看活跃连接

```sql
SELECT
  count(*) as connections,
  state,
  count(*) * 100.0 / sum(count(*) OVER()) as percentage
FROM pg_stat_activity
WHERE datname = 'nextchat'
GROUP BY state;
```

### 查看慢查询

```sql
-- 需要先启用 pg_stat_statements
SELECT
  query,
  calls,
  total_time,
  mean_time
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;
```

### 查看表大小

```sql
SELECT
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size,
  pg_total_relation_size(schemaname||'.'||tablename) as bytes
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY bytes DESC;
```
