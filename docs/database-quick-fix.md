# NextChat 数据库问题快速排除指南
> 注意：本文是历史数据库排障记录。当前表结构以 `docs/db/data-storage-sync-matrix.md` 和 `docs/db/nextchat-postgres-schema.sql` 为准；旧列 `model_settings/ui_settings/sync_settings` 已合并到 `app_settings` 的 4 个 JSONB 列。


> ⚠️ **文档状态（已过时）**：本文写于 v4 存储优化（2026-06-11）之前，"手动修复"SQL 引用的 `model_settings` 列已废弃（`app-config` 现位于 `app_settings.extra_settings`），照搬会报错。当前 `app_settings` 只有 4 个 JSONB 列：`chat_settings / plugin_settings / security_settings / extra_settings`。排查请以最新文档为准：
> - [PostgreSQL schema](db/nextchat-postgres-schema.sql)
> - [数据存储同步总表](db/data-storage-sync-matrix.md)

本文档提供了 NextChat 在宝塔面板部署后常见数据库问题的快速解决方案。

## 🚨 常见错误速查表

| 错误信息 | 问题原因 | 快速解决方案 |
|---------|---------|-------------|
| `app-config 格式不正确` | `extra_settings` 缺少 `app-config` 键（历史版本） | 运行 `./scripts/fix-app-config.sh` 或按当前 schema 手动补齐 |
| `数据库下载失败` | app_settings 数据过大 | 运行 `./scripts/fix-app-settings.sh` |
| `ENOTFOUND nextchat-postgres` | 容器网络不通 | 连接到同一网络 |
| `password authentication failed` | 数据库密码错误 | 检查 PGPASSWORD 配置 |
| `EAI_AGAIN` | 数据库连接超时 | 检查容器状态和网络 |

---

## 🔧 问题 1：app-config 格式不正确

### 症状
```
[API Config] ❌ 数据库下载失败: Error: app-config 格式不正确
```

### 快速修复
```bash
cd /www/wwwroot/nextchat
./scripts/fix-app-config.sh
```

### 手动修复
```bash
# 添加 app-config 到 extra_settings
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
UPDATE app_settings
SET extra_settings = jsonb_set(
  coalesce(extra_settings, '{}'::jsonb),
  '{app-config}',
  jsonb_build_object(
    'customModels', ''::text,
    'lastUpdate', 0,
    'version', '1.0'
  ),
  true
);
"
```

### 验证
```bash
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT extra_settings -> 'app-config' FROM app_settings;
"
```

### 重要！
修复后**必须刷新浏览器**：`Ctrl+F5`

---

## 🔧 问题 2：数据库下载/导出报错

### 症状
- 下载数据库时报错
- 导出的 SQL 文件过大
- `plugin_settings` 字段包含大量数据

### 快速修复
```bash
cd /www/wwwroot/nextchat
./scripts/fix-app-settings.sh
```

### 手动修复
```bash
# 清理 app_settings
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
UPDATE app_settings SET
  chat_settings = '{}'::jsonb,
  plugin_settings = '{}'::jsonb,
  security_settings = '{}'::jsonb,
  extra_settings = '{}'::jsonb;
"
```

### 然后重新添加 app-config
```bash
./scripts/fix-app-config.sh
```

---

## 🔧 问题 3：数据库连接失败

### 症状
```
Error: getaddrinfo ENOTFOUND nextchat-postgres
```

### 检查步骤
```bash
# 1. 检查容器是否运行
docker ps | grep postgres

# 2. 检查网络连接
docker exec nextchat ping nextchat-postgres

# 3. 检查环境变量
docker exec nextchat env | grep PGHOST
```

### 解决方案

**方法 1：连接到同一网络**
```bash
docker network connect nextchat_nextchat-network nextchat
docker restart nextchat
```

**方法 2：修改环境变量**
```bash
# .env.baota.local
PGHOST=nextchat-postgres  # 或 host.docker.internal

# 重新构建
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local build
docker-compose -f docker-compose.baota.yml --env-file .env.baota.local up -d
```

---

## 🔧 问题 4：应用无法访问

### 症状
- 网站无法打开
- 502 Bad Gateway
- 连接被拒绝

### 检查步骤
```bash
# 1. 检查容器状态
docker ps | grep nextchat

# 2. 查看容器日志
docker logs nextchat

# 3. 测试本地访问
curl http://127.0.0.1:3000

# 4. 检查 Nginx 配置
nginx -t
```

### 解决方案

**容器未运行**
```bash
docker restart nextchat
```

**Nginx 配置错误**
```bash
nginx -t
nginx -s reload
```

**端口占用**
```bash
netstat -tlnp | grep 3000
# 修改端口或停止占用进程
```

---

## 📊 配置检查清单

### 必需的配置字段

```bash
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  jsonb_object_keys(chat_settings) as chat_keys,
  jsonb_object_keys(plugin_settings) as plugin_keys,
  jsonb_object_keys(security_settings) as security_keys,
  jsonb_object_keys(extra_settings) as extra_keys
FROM app_settings;
"
```

**应该包含：**
- `chat_keys`: `__chat-index-state__`
- `plugin_keys`: `chat-next-web-plugin`
- `security_keys`: `access-control`
- `extra_keys`: `app-config`, `model-cache-store`, `sync`, `mask-store`, `chat-update`, `prompt-store`（绘图记录已拆到 `user_draw_stores.payload_json`）

### 数据大小检查

```bash
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  length(chat_settings::text) as chat_size,
  length(plugin_settings::text) as plugin_size,
  length(security_settings::text) as security_size,
  length(extra_settings::text) as extra_size
FROM app_settings;
"
```

**正常范围：**
- `ui_size`: 2-10
- `chat_size`: 2-10000
- `plugin_size`: 2 （重要！如果 >1000 需要清理）
- `model_size`: 2-100

---

## 🛠️ 一键修复脚本

### 完整修复流程

```bash
cd /www/wwwroot/nextchat

# 1. 修复 app-config
./scripts/fix-app-config.sh

# 2. 如果 plugin_settings 过大，清理它
./scripts/fix-app-settings.sh

# 3. 验证修复
curl http://127.0.0.1:3000

# 4. 刷新浏览器
# Ctrl+F5
```

### 诊断脚本

```bash
#!/bin/bash
echo "=== NextChat 数据库诊断 ==="

echo "1. 容器状态："
docker ps | grep nextchat

echo -e "\n2. 数据库连接："
docker exec nextchat ping nextchat-postgres

echo -e "\n3. 配置检查："
docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
SELECT
  jsonb_object_keys(extra_settings) as extra_keys,
  length(plugin_settings::text) as plugin_size
FROM app_settings;
"

echo -e "\n4. 应用测试："
curl -I http://127.0.0.1:3000

echo -e "\n=== 诊断完成 ==="
```

---

## 🔄 问题修复后的操作

### 必须执行

1. **刷新浏览器**
   ```
   Ctrl+F5 或 Cmd+Shift+R
   ```

2. **清除浏览器缓存**（如果问题仍存在）
   ```
   F12 → Application → Clear storage → Clear site data
   ```

3. **重新登录**
   ```
   访问 https://your-domain.com
   输入访问密码
   ```

### 测试功能

- ✅ 能否正常登录
- ✅ 能否创建新会话
- ✅ 能否发送消息
- ✅ 能否访问设置页面
- ✅ 能否配置 API Key

---

## 📞 获取帮助

### 如果问题仍未解决

1. **收集诊断信息**
   ```bash
   # 收集日志
   docker logs nextchat > nextchat.log
   docker logs nextchat-postgres > postgres.log

   # 收集数据库状态
   docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "
   SELECT version();
   \dt
   SELECT * FROM app_settings;
   " > db_status.txt
   ```

2. **查看详细文档**
   - [宝塔详细 Runbook](./baota-chat-dyxcloud-runbook.md)
   - [数据库修复说明](./database-fix-summary.md)
   - [宝塔当前线上说明](../README_BAOTA.md)

3. **提交问题**
   - GitHub Issues: https://github.com/ChatGPTNextWeb/NextChat/issues
   - 附上诊断信息

---

## 💡 预防措施

### 定期维护

```bash
# 每月清理一次
0 2 1 * * /www/wwwroot/nextchat/scripts/fix-app-settings.sh

# 每周检查一次
0 3 * * 0 /www/wwwroot/nextchat/scripts/health-check.sh
```

### 监控脚本

```bash
#!/bin/bash
# 监控数据库健康

# 检查 plugin_settings 大小
PLUGIN_SIZE=$(docker exec nextchat-postgres psql -U nextchat_user -d nextchat -t -c "
SELECT length(plugin_settings::text) FROM app_settings;
")

if [ "$PLUGIN_SIZE" -gt 1000 ]; then
  echo "警告：plugin_settings 过大 ($PLUGIN_SIZE 字符)"
  echo "正在清理..."
  /www/wwwroot/nextchat/scripts/fix-app-settings.sh
fi

# 检查 app-config 存在
HAS_CONFIG=$(docker exec nextchat-postgres psql -U nextchat_user -d nextchat -t -c "
SELECT COUNT(*) FROM app_settings WHERE extra_settings ? 'app-config';
")

if [ "$HAS_CONFIG" -eq 0 ]; then
  echo "警告：app-config 缺失"
  echo "正在修复..."
  /www/wwwroot/nextchat/scripts/fix-app-config.sh
fi
```

---

## 🎯 总结

### 最常见的问题

1. **app-config 格式不正确** → 运行 `fix-app-config.sh`
2. **plugin_settings 过大** → 运行 `fix-app-settings.sh`
3. **数据库连接失败** → 检查网络和配置
4. **容器未运行** → 重启容器

### 快速解决流程

```bash
cd /www/wwwroot/nextchat
./scripts/fix-app-config.sh    # 修复配置
./scripts/fix-app-settings.sh  # 清理数据
# 刷新浏览器 (Ctrl+F5)
```

### 记住

- ✅ 修复后必须刷新浏览器
- ✅ 定期清理和备份
- ✅ 监控数据库大小
- ✅ 保持容器正常运行

---

**快速响应 = 清楚问题 → 找到对应脚本 → 运行修复 → 刷新浏览器** 🚀
