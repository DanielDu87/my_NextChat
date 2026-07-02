# NextChat 同步功能完整使用指南

## 🚨 重要说明

### "保存并同步"功能的正确使用方法

**错误理解：** 以为可以"保存并同步"空白配置

**正确理解：** 需要**先在界面上添加配置**，然后才能"保存并同步"到数据库

**正确的流程：**

```
1. 在"我的配置"中添加 API Key
2. 配置保存到本地存储
3. 点击"保存并同步"
4. 配置上传到数据库
```

---

## 🎯 立即可用的解决方案

### 方案 1：直接在服务器网页配置（最简单）

#### 步骤 1：访问页面

```
https://chat.dyxcloud.com/api-config
```

#### 步骤 2：添加 API Key

在"我的配置"部分：

1. **点击"添加新密钥"按钮**

2. **填写信息**（示例）

   ```
   提供商：OpenAI
   API Key：sk-proj-xxxx...（您的密钥）
   API 地址：（可选）留空
   ```

3. **点击"保存"**

4. **配置立即可用**
   - 不需要"保存并同步"
   - 配置已保存在本地
   - 可以直接使用

#### 步骤 3：（可选）启用跨设备同步

如果您想在多台设备使用相同配置：

1. **在第一台设备**

   - 添加配置后点击"保存并同步"
   - 配置保存到数据库

2. **在其他设备**
   - 访问 <https://chat.dyxcloud.com>
   - 进入 API 配置
   - 点击"从数据库下载"
   - 配置自动同步

---

### 方案 2：从本地项目导入配置

#### 步骤 1：准备本地配置

在您的**本地 NextChat 项目**中：

1. **导出配置**

   > 说明：新版业务数据主要持久化在浏览器 `IndexedDB`（非 `localStorage`），最稳妥的方式是在界面点击"保存并同步"上传到数据库。如需在控制台查看本地副本，请检查 IndexedDB（库名 `nextchat-local-cache`），而不是 `localStorage`。

   ```javascript
   // 仅供参考：从 IndexedDB 读取本地副本需异步访问，建议直接用界面"保存并同步"
   ```

2. **保存配置文件**

   ```bash
   # 保存输出的 JSON
   cat > my-config.json << 'EOF'
   {
     "provider": "openai",
     "apiKey": "sk-xxxx...",
     "customModels": ""
   }
   EOF
   ```

#### 步骤 2：导入到服务器数据库

**使用导入脚本：**

```bash
cd <DEPLOY_DIR>

# 导入配置
./scripts/import-config.sh my-config.json
```

**手动导入：**

```bash
# 获取用户 ID
USER_ID="<USER_ID>"

# 更新配置
docker exec <postgres_container> psql -U <db_user> -d <db_name> -c "
UPDATE provider_configs
SET request_config = jsonb_build_object(
  'apiKey', 'sk-xxxx...',
  'baseUrl', '',
  'endpoint', ''
)
WHERE user_id = '$USER_ID' AND provider_code = 'openai';
"
```

#### 步骤 3：在服务器页面验证

1. **访问页面**

   ```
   https://chat.dyxcloud.com/api-config
   ```

2. **刷新页面** (Ctrl+F5)

3. **配置已自动加载**

---

## 🔧 导入工具使用

### import-config.sh 脚本

**功能：** 从 JSON 文件导入配置到数据库

**使用方法：**

```bash
cd <DEPLOY_DIR>

# 准备配置文件
cat > config.json << 'EOF'
{
  "provider": "openai",
  "apiKey": "sk-proj-xxxx...",
  "baseUrl": ""
}
EOF

# 导入配置
./scripts/import-config.sh config.json
```

**支持的配置格式：**

```json
{
  "provider": "openai",
  "apiKey": "sk-xxxx...",
  "baseUrl": "https://api.openai.com/v1",
  "models": ["gpt-4", "gpt-3.5-turbo"]
}
```

---

## 💡 数据同步机制说明

### NextChat 的数据存储

NextChat 使用三层存储：

1. **IndexedDB 本地工作副本**

   - Zustand store 的主要持久化位置，库名 `nextchat-local-cache`。
   - 聊天数据按用户拆分为索引和单会话正文，首屏只加载必要会话。
   - API 配置、模型缓存、绘图记录、Prompt/Mask 等也会先落本地。

2. **localStorage 设备级偏好**

   - 只保存语言、侧边栏宽度、输入草稿、启动标记等临时态。
   - 不作为跨设备同步来源。

3. **PostgreSQL 云端共享副本**

   - 保存用户、登录 session、store 快照、聊天会话、供应商配置、API Key 密文、绘图图片、上传文件缓存和 API 配置备份。
   - 负责跨设备同步、恢复和服务端维护脚本。

### 同步功能说明

**"保存并同步"按钮：**

- 作用：将当前 IndexedDB 本地工作副本合并/上传到 PostgreSQL
- 需要：先在本地有有效配置或数据
- 用于：备份配置、多设备同步；Access store 保存还会按设置触发 API 配置自动备份

**"从数据库下载"按钮：**

- 作用：从 PostgreSQL 下载快照覆盖/合并到本地 IndexedDB
- 需要：数据库中已保存配置
- 用于：恢复配置、跨设备同步

### 为什么"保存并同步"提示错误？

**原因：** 前端检查到本地没有有效的配置条目

**解决方案：**

1. 先在"我的配置"中添加 API Key
2. 保存后配置存在本地
3. 然后才能"保存并同步"到数据库

---

## 📊 当前数据库状态

> 以下为示例状态，实际以你环境为准。核心表结构见 [PostgreSQL schema](db/nextchat-postgres-schema.sql)。

### 关键表（配置同步相关）

- `provider_configs` — 供应商配置（每个 profile 一行）
- `provider_api_keys` — 供应商 API 密钥
- `app_settings` — 用户设置（`security_settings`/`extra_settings` 等 JSONB 列）
- `api_config_backup_settings` / `api_config_backups` — API 配置备份设置和快照
- `conversations` / `messages` — 聊天会话和消息正文
- `user_draw_stores` / `user_draw_images` — 绘图历史和图片二进制
- `cache_file_blobs` / `user_cache_files` — 上传文件缓存

### 可以执行的操作

1. **在网页上直接添加配置** ✅
2. **导入配置文件** ✅
3. **跨设备同步** ✅
4. **从数据库下载配置** ✅

---

## 🔄 完整工作流程

### 流程 1：单设备使用

```
访问 chat.dyxcloud.com
    ↓
添加 API Key
    ↓
点击"保存"
    ↓
直接使用
```

### 流程 2：跨设备同步

```
设备A：添加配置 → 保存并同步
    ↓
数据库存储
    ↓
设备B：访问 chat.dyxcloud.com → 从数据库下载
    ↓
配置同步
```

### 流程 3：从本地导入

```
本地项目：通过界面保存并同步，或导出配置
    ↓
准备配置文件
    ↓
使用 import-config.sh 导入
    ↓
服务器：访问 chat.dyxcloud.com → 从数据库下载
```

---

## ⚠️ 重要提示

### 关于"保存并同步"错误

**错误信息：** "没有可同步的配置条目"

**原因：** 本地浏览器没有配置

**解决：**

1. 不要点击"保存并同步"
2. 先在"我的配置"中添加 API Key
3. 点击"保存"
4. 配置会保存到本地，立即可用

### 什么时候需要"保存并同步"？

- ✅ 想备份配置到数据库时
- ✅ 想在多台设备同步配置时
- ❌ 不是添加配置的第一步

### 什么时候使用"从数据库下载"？

- ✅ 换设备后恢复配置时
- ✅ 多台设备同步配置时
- ❌ 数据库中没有配置时（下载不到东西）

---

## 🎉 总结

### 简单直接的方案

**推荐做法：**

1. **直接在服务器网页配置**

   ```
   https://chat.dyxcloud.com/api-config
   ```

2. **添加您的 API Key**

   - 点击"添加新密钥"
   - 填写 API Key
   - 点击"保存"

3. **开始使用**
   - 配置立即可用
   - 无需其他操作

### 高级用法

**多设备同步：**

1. 主设备：配置 → 保存并同步
2. 其他设备：从数据库下载

**从本地导入：**

1. 本地通过界面保存并同步，或准备导出的配置文件
2. 使用 import-config.sh 导入
3. 网页刷新后从数据库下载或直接验证

---

**记住：先在界面上添加配置，不要直接点击"保存并同步"！** 🚀
