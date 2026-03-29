# NextChat 数据库故障排查指南

本文档提供了 NextChat 在宝塔面板部署过程中常见的数据库问题及解决方案。

## 🚨 常见问题

### 1. 数据下载/导出报错 - app-config 格式不正确 ⭐ **新增**

**症状：**
- 控制台提示：`[API Config] ❌ 数据库下载失败: Error: app-config 格式不正确`
- 前端无法同步配置
- API 配置页面报错

**原因：**
`model_settings` 字段中缺少必需的 `app-config` 键。这通常发生在清理 `app_settings` 表后，因为 `model_settings` 被重置为空对象 `{}`。

**解决方案：添加 app-config 配置**

#### 步骤 1：检查当前配置

```bash
# 查看 model_settings 的内容
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  user_id,
  model_settings,
  jsonb_object_keys(model_settings) as keys
FROM app_settings;
"
```

如果 `keys` 列为空或没有 `app-config`，说明需要修复。

#### 步骤 2：使用修复脚本（推荐）

```bash
cd /www/wwwroot/nextchat
./scripts/fix-app-config.sh
```

#### 步骤 3：手动修复

```bash
# 获取用户 ID
USER_ID=$(docker exec nextchat-postgres psql -U nextchat_user -d nextchat -t -c "SELECT id FROM app_users LIMIT 1;")

# 添加 app-config 配置
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
UPDATE app_settings
SET model_settings = jsonb_build_object(
  'app-config', jsonb_build_object(
    'models', '[]'::jsonb,
    'customModels', ''::text,
    'providers', '{}'::jsonb,
    'lastUpdate', 0,
    'version', '1.0'
  )
)
WHERE user_id = '$USER_ID';
"
```

#### 步骤 4：验证修复

```bash
# 检查 app-config 是否已添加
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  model_settings -> 'app-config' as app_config
FROM app_settings;
"
```

应该看到：
```
app_config
----------------------------------------
{"models": [], "version": "1.0", "providers": {}, "lastUpdate": 0, "customModels": ""}
```

#### 步骤 5：刷新浏览器

**重要！** 必须刷新浏览器页面：
- 按 `Ctrl+F5` 强制刷新
- 或清除浏览器缓存后刷新

---

### 2. 数据下载/导出报错 - app_settings 数据过大

**症状：**
- 在宝塔面板中下载数据库时报错
- 导出的 SQL 文件过大或不完整
- JSON 字段包含大量重复数据

**原因：**
`app_settings` 表中的 `plugin_settings` 字段包含了大量插件的 JSON Schema 数据，这些数据会占用大量空间并可能导致导出失败。

**解决方案：清理 app_settings 数据**

#### 步骤 1：查看当前数据状态

```bash
# 查看 app_settings 表的数据大小
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  user_id,
  length(ui_settings::text) as ui_size,
  length(chat_settings::text) as chat_size,
  length(plugin_settings::text) as plugin_size
FROM app_settings;
"
```

如果 `plugin_size` 很大（超过 10000），说明需要清理。

#### 步骤 2：获取用户 ID

```bash
# 查看用户表
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT id, external_id FROM app_users;
"
```

记下需要清理的 `user_id`。

#### 步骤 3：执行清理操作

```bash
# 方式 1：使用 psql 命令
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
-- 备份当前设置（创建临时表）
CREATE TEMP TABLE app_settings_backup AS SELECT * FROM app_settings;

-- 清理旧数据
DELETE FROM app_settings WHERE user_id = 'YOUR_USER_ID';

-- 插入干净的配置
INSERT INTO app_settings (user_id, ui_settings, chat_settings, model_settings, plugin_settings, sync_settings, security_settings, extra_settings)
VALUES (
  'YOUR_USER_ID',
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb
);
"
```

**或者使用脚本文件：**

```bash
# 创建清理脚本
cat > /tmp/clean_app_settings.sql << 'EOF'
-- 备份当前设置
CREATE TEMP TABLE IF NOT EXISTS app_settings_backup AS SELECT * FROM app_settings;

-- 清理旧数据
DELETE FROM app_settings WHERE user_id = 'YOUR_USER_ID';

-- 插入干净的配置
INSERT INTO app_settings (user_id, ui_settings, chat_settings, model_settings, plugin_settings, sync_settings, security_settings, extra_settings)
VALUES (
  'YOUR_USER_ID',
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb
);

-- 显示结果
SELECT user_id,
  length(ui_settings::text) as ui_size,
  length(plugin_settings::text) as plugin_size
FROM app_settings
WHERE user_id = 'YOUR_USER_ID';
EOF

# 执行清理（替换 YOUR_USER_ID）
sed -i 's/YOUR_USER_ID/b6e1e0c1-96fe-429c-8e51-0af1ff832c55/g' /tmp/clean_app_settings.sql
docker exec -i nextchat-postgres psql -U nextchat_user -d nextchat < /tmp/clean_app_settings.sql
```

#### 步骤 4：验证清理结果

```bash
# 检查清理后的数据大小
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  user_id,
  length(ui_settings::text) as ui_size,
  length(plugin_settings::text) as plugin_size
FROM app_settings;
"

# 应该看到所有字段大小都是 2（空 JSON 对象）
```

#### 步骤 5：测试应用

```bash
# 测试应用是否正常运行
curl http://127.0.0.1:3000

# 访问网站测试
# https://your-domain.com
```

---

### 3. 数据库连接失败

**症状：**
- 应用启动时显示数据库连接错误
- 日志中出现 `ENOTFOUND` 或 `EAI_AGAIN` 错误
- 无法访问应用

**检查步骤：**

```bash
# 1. 检查 PostgreSQL 容器是否运行
docker ps | grep postgres

# 2. 检查网络连接
docker network inspect nextchat_nextchat-network

# 3. 测试容器间连接
docker exec nextchat ping nextchat-postgres

# 4. 检查环境变量
docker exec nextchat env | grep PG
```

**解决方案：**

**问题 A：容器不在同一网络**

```bash
# 将 NextChat 容器添加到 PostgreSQL 网络
docker network connect nextchat_nextchat-network nextchat

# 重启 NextChat 容器
docker restart nextchat
```

**问题 B：环境变量配置错误**

```bash
# 检查 .env.baota.local 配置
cat /www/wwwroot/nextchat/.env.baota.local | grep -E "PGHOST|PGUSER|PGPASSWORD"

# 确保 PGHOST 配置正确
# 如果使用容器名：PGHOST=nextchat-postgres
# 如果使用 host.docker.internal：PGHOST=host.docker.internal

# 修改后需要重新构建容器
cd /www/wwwroot/nextchat
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy down
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy build
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local --profile no-proxy up -d
```

**问题 C：数据库密码错误**

```bash
# 测试数据库连接
docker exec nextchat-postgres psql -U nextchat_user -d nextchat

# 如果提示密码错误，检查环境变量中的 PGPASSWORD
# 确保与数据库实际密码一致
```

---

### 4. 数据库性能问题

**症状：**
- 应用响应缓慢
- 数据库查询超时
- CPU 或内存使用率高

**检查步骤：**

```bash
# 1. 查看数据库连接数
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT count(*) as connections FROM pg_stat_activity;
"

# 2. 查看活跃查询
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT pid, state, query, wait_event_type, wait_event
FROM pg_stat_activity
WHERE state = 'active'
ORDER BY query_start;
"

# 3. 查看表大小
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  schemaname,
  tablename,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"
```

**解决方案：**

**优化 app_settings 表：**

```sql
-- 清理历史数据（如果有）
DELETE FROM app_settings WHERE updated_at < NOW() - INTERVAL '30 days';

-- 创建索引（如果不存在）
CREATE INDEX IF NOT EXISTS idx_app_settings_user_id ON app_settings(user_id);
CREATE INDEX IF NOT EXISTS idx_app_settings_updated_at ON app_settings(updated_at);

-- 清理死元组
VACUUM FULL ANALYZE app_settings;
```

**优化连接池配置：**

```bash
# .env.baota.local
PGPOOL_MAX=10                      # 减少最大连接数
PG_CONNECT_TIMEOUT_MS=10000        # 10秒连接超时
PG_IDLE_TIMEOUT_MS=30000           # 30秒空闲超时
```

---

### 5. 数据损坏或数据不一致

**症状：**
- 应用功能异常
- 数据显示不正确
- 用户无法登录

**检查步骤：**

```bash
# 1. 检查表结构
docker exec nextchat-postgres psql -U nextchat_user -d nextcast -c "\d app_settings"

# 2. 检查数据完整性
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT COUNT(*) FROM app_users;
SELECT COUNT(*) FROM app_settings;
SELECT COUNT(*) FROM conversations;
SELECT COUNT(*) FROM messages;
"

# 3. 检查是否有孤立记录
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
-- 检查是否有 messages 没有对应的 conversations
SELECT COUNT(*) FROM messages m
WHERE NOT EXISTS (
  SELECT 1 FROM conversations c
  WHERE c.id = m.conversation_id
);
"
```

**解决方案：**

**重置用户配置：**

```bash
# 创建清理脚本
cat > /tmp/reset_user_config.sh << 'EOF'
#!/bin/bash
USER_ID=$1

if [ -z "$USER_ID" ]; then
  echo "Usage: $0 <user_id>"
  exit 1
fi

docker exec nextchat-postgres psql -U nextchat_user -d nextchat << SQL
-- 开始事务
BEGIN;

-- 删除用户设置
DELETE FROM app_settings WHERE user_id = '$USER_ID';

-- 重新创建干净的设置
INSERT INTO app_settings (user_id, ui_settings, chat_settings, model_settings, plugin_settings, sync_settings, security_settings, extra_settings)
VALUES (
  '$USER_ID',
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb,
  '{}'::jsonb
);

-- 提交事务
COMMIT;

-- 显示结果
SELECT user_id, ui_settings, chat_settings FROM app_settings WHERE user_id = '$USER_ID';
SQL
EOF

chmod +x /tmp/reset_user_config.sh

# 使用方法（替换为实际的用户 ID）
/tmp/reset_user_config.sh b6e1e0c1-96fe-429c-8e51-0af1ff832c55
```

---

## 🔧 数据库维护命令

### 日常维护

```bash
# 1. 查看数据库大小
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  pg_database.datname,
  pg_size_pretty(pg_database_size(pg_database.datname)) AS size
FROM pg_database
WHERE datname = 'nextchat';
"

# 2. 查看表统计
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  schemaname,
  tablename,
  n_live_tup as row_count,
  pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) AS size
FROM pg_stat_user_tables
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;
"

# 3. 清理死元组
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
VACUUM ANALYZE;
"
```

### 数据备份

```bash
# 1. 完整备份
docker exec nextchat-postgres pg_dump -U nextchat_user nextchat > backup_$(date +%Y%m%d_%H%M%S).sql

# 2. 只备份表结构
docker exec nextchat-postgres pg_dump -U nextchat_user --schema-only nextchat > schema_$(date +%Y%m%d).sql

# 3. 只备份数据
docker exec nextchat-postgres pg_dump -U nextchat_user --data-only nextchat > data_$(date +%Y%m%d).sql

# 4. 备份特定表
docker exec nextchat-postgres pg_dump -U nextchat_user -t app_settings -t app_users nextchat > partial_backup_$(date +%Y%m%d).sql
```

### 数据恢复

```bash
# 1. 恢复完整备份
docker exec -i nextchat-postgres psql -U nextchat_user nextchat < backup_20260329.sql

# 2. 恢复特定表
docker exec -i nextchat-postgres psql -U nextchat_user nextchat < partial_backup_20260329.sql

# 3. 恢复前删除现有数据
docker exec nextchat-postgres psql -U nextchat_user nextchat -c "
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;
GRANT ALL ON SCHEMA public TO nextchat_user;
"

docker exec -i nextchat-postgres psql -U nextchat_user nextchat < backup_20260329.sql
```

---

## 📊 性能监控

### 实时监控

```bash
# 1. 监控数据库连接
watch -n 1 'docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "SELECT count(*) as connections, state FROM pg_stat_activity GROUP BY state;"'

# 2. 监控查询性能
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  query,
  calls,
  total_exec_time,
  mean_exec_time,
  max_exec_time
FROM pg_stat_statements
ORDER BY mean_exec_time DESC
LIMIT 10;
"

# 3. 监控表大小变化
watch -n 60 'docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "SELECT pg_size_pretty(pg_total_relation_size('\''app_settings'\'')) as app_settings_size;"'
```

---

## 🔍 调试技巧

### 启用查询日志

```bash
# 1. 修改 PostgreSQL 配置
docker exec -it nextchat-postgres sh -c "echo \"log_min_duration_statement = 1000\" >> /var/lib/postgresql/data/postgresql.conf"

# 2. 重启容器
docker restart nextchat-postgres

# 3. 查看日志
docker logs nextchat-postgres | grep "duration:"

# 4. 关闭日志
docker exec -it nextchat-postgres sh -c "sed -i '/log_min_duration_statement/d' /var/lib/postgresql/data/postgresql.conf"
docker restart nextchat-postgres
```

### 分析慢查询

```bash
# 1. 安装 pg_stat_statements 扩展
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
"

# 2. 查看慢查询
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  query,
  calls,
  total_exec_time / 1000 as total_seconds,
  mean_exec_time / 1000 as mean_seconds,
  max_exec_time / 1000 as max_seconds
FROM pg_stat_statements
WHERE mean_exec_time > 1000
ORDER BY mean_exec_time DESC
LIMIT 20;
"
```

---

## 🚨 应急处理

### 应用无法启动

```bash
# 1. 检查容器状态
docker ps -a | grep nextchat

# 2. 查看错误日志
docker logs nextchat --tail 100

# 3. 进入容器检查
docker exec -it nextchat sh

# 4. 测试数据库连接
docker exec nextchat sh -c "nc -zv nextchat-postgres 5432"

# 5. 如果是数据库问题，重启数据库
docker restart nextchat-postgres
sleep 10
docker restart nextchat
```

### 数据库死锁

```bash
# 1. 查看锁等待
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  pid,
  usename,
  pg_blocking_pids(pid) as blocked_by,
  query as blocked_query
FROM pg_stat_activity
WHERE cardinality(pg_blocking_pids(pid)) > 0;
"

# 2. 终止长时间运行的查询
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT pg_terminate_backend(pid)
FROM pg_stat_activity
WHERE state = 'active'
AND query_start < NOW() - INTERVAL '5 minutes';
"
```

---

## 📞 获取帮助

如果问题仍然无法解决：

1. **收集诊断信息**
   ```bash
   # 收集日志
   docker logs nextchat > nextchat.log
   docker logs nextchat-postgres > postgres.log

   # 收集数据库状态
   docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
   SELECT version();
   \dt
   SELECT COUNT(*) FROM app_users;
   " > db_status.txt
   ```

2. **查看项目文档**
   - [README_BAOTA.md](../README_BAOTA.md)
   - [部署指南](./baota-deploy-guide-updated.md)

3. **提交问题**
   - GitHub Issues: https://github.com/ChatGPTNextWeb/NextChat/issues

---

**记住：定期备份数据库是防止数据丢失的最好方法！**
