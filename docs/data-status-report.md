# NextChat 数据恢复和同步 - 完整执行指南

## ✅ 数据库当前状态

```
生成时间: 2026-03-29 15:22:20

=== 用户信息 ===
用户ID: b6e1e0c1-96fe-429c-8e51-0af1ff832c55
外部ID: 3c95d9ae-0f02-4238-b93c-313168b84a76
创建时间: 2026-03-29 14:52:40

=== 配置状态 ===
✅ model_settings: 包含 app-config
✅ extra_settings: 包含 4 个配置键
✅ sync_settings: 已配置

=== 提供商配置 ===
✅ provider_configs: 1 条 OpenAI 配置
✅ provider_api_keys: 1 条 API 密钥记录
✅ is_enabled: true
✅ is_default: true

=== 数据统计 ===
✅ 用户数: 1
✅ 配置数: 1
✅ 提供商数: 1
✅ API密钥数: 1
✅ 对话数: 1
✅ 消息数: 0
```

---

## 🎯 现在可以执行的操作

### 方案 1：在网页上直接添加配置（推荐）

#### 步骤 1：访问 API 配置页面

```
https://chat.dyxcloud.com/api-config
```

#### 步骤 2：添加您的 API Key

**在"我的配置"部分：**

1. **点击"添加新密钥"按钮**

2. **填写配置**
   ```
   提供商：OpenAI
   API Key：sk-proj-xxxx...（您的实际密钥）
   API 地址：（可选）留空或填写代理
   模型列表：（可选）留空
   ```

3. **点击"保存"**

4. **立即可用**
   - 配置已保存
   - 可以开始对话
   - 无需其他操作

#### 步骤 3：验证配置

- 创建新会话
- 选择模型
- 测试对话功能

---

### 方案 2：从本地项目导入配置

如果您在**本地 NextChat** 中已有配置：

#### 步骤 1：在本地导出配置

在本地项目的浏览器中执行：

```javascript
// 1. 打开开发者工具
F12 → Application → Local Storage

// 2. 找到并复制配置
// 键名: chat-next-web-access-control
// 复制整个值（JSON 格式）

// 3. 在控制台执行
const config = JSON.parse(localStorage.getItem('chat-next-web-access-control'));
console.log(JSON.stringify(config, null, 2));
```

#### 步骤 2：准备配置文件

根据输出的配置，创建简化版本：

```bash
cat > config.json << 'EOF
{
  "provider": "openai",
  "apiKey": "sk-proj-xxxx...",
  "baseUrl": "",
  "models": ["gpt-4", "gpt-3.5-turbo"]
}
EOF
```

#### 步骤 3：导入到服务器数据库

```bash
cd /www/wwwroot/nextchat

# 导入配置
./scripts/import-config.sh config.json
```

#### 步骤 4：在服务器页面验证

```
1. 访问: https://chat.dyxcloud.com
2. 刷新页面 (Ctrl+F5)
3. 进入 API 配置
4. 点击"从数据库下载"
```

---

## 🔧 同步功能正确使用方法

### ❌ 错误用法

**不要这样做：**
```
1. 不添加配置直接点击"保存并同步" → 会报错
2. 数据库为空时点击"从数据库下载" → 下载不到东西
```

### ✅ 正确用法

**正确的流程：**

```
【添加配置】
1. 访问 https://chat.dyxcloud.com/api-config
2. 在"我的配置"中添加 API Key
3. 点击"保存"
→ 配置已保存，立即可用

【多设备同步】
1. 主设备：添加配置后点击"保存并同步"
   → 配置上传到数据库

2. 其他设备：点击"从数据库下载"
   → 从数据库下载配置
```

---

## 🛠️ 可用工具脚本

### 1. 导入配置脚本

```bash
cd /www/wwwroot/nextchat
./scripts/import-config.sh config.json
```

**配置文件格式：**
```json
{
  "provider": "openai",
  "apiKey": "sk-xxxx...",
  "baseUrl": ""
}
```

### 2. 初始化脚本

```bash
# 初始化提供商配置
./scripts/init-provider-configs.sh

# 修复 app-config
./scripts/fix-app-config.sh

# 清理数据
./scripts/fix-app-settings.sh
```

---

## 📊 当前数据库状态详细说明

### 已初始化的配置

**provider_configs 表：**
- 1 条 OpenAI 配置
- 状态：已启用
- 默认：是

**provider_api_keys 表：**
- 1 条默认密钥记录
- 状态：已启用

**app_settings 表：**
- model_settings: 包含 app-config
- extra_settings: 包含 4 个配置键
- sync_settings: 已配置

### 数据结构

```
app_users (1 用户)
  ↓
app_settings (1 配置)
  ↓
provider_configs (1 提供商)
  ↓
provider_api_keys (1 密钥)
  ↓
conversations (1 对话)
  ↓
messages (0 消息)
```

---

## 💡 关于数据恢复

### 当前状态

数据库现在是**初始状态**：
- ✅ 配置结构完整
- ✅ 同步功能已启用
- ⚠️ 没有实际的 API Key（需要您添加）

### 从本地恢复数据

如果您在本地有完整的配置数据：

**方式 1：使用 WebDAV 同步**
```bash
# 本地项目配置 WebDAV
# 然后在服务器网页导入
```

**方式 2：直接导入数据库**
```bash
# 使用 import-config.sh 脚本
# 导入本地配置到数据库
```

**方式 3：在界面手动添加**
```bash
# 最简单的方式
# 在网页上直接添加配置
```

---

## 🎯 推荐的下一步操作

### 最简单直接的方式

**立即执行：**

1. **访问 API 配置页面**
   ```
   https://chat.dyxcloud.com/api-config
   ```

2. **添加您的 API Key**
   - 点击"添加新密钥"
   - 填写信息
   - 点击"保存"

3. **开始使用**
   - 创建新会话
   - 选择模型
   - 开始对话

### 如果需要从本地恢复数据

**提供您的信息：**
- 本地配置的导出数据
- 或者您的 API Key 信息

我可以帮您：
1. 创建配置文件
2. 导入到数据库
3. 验证配置正确

---

## 📞 需要帮助？

如果遇到问题：

1. **查看文档**
   - [同步功能使用指南](./sync-usage-guide.md)
   - [数据库问题快速排除](./database-quick-fix.md)

2. **检查状态**
   ```bash
   # 检查容器
   docker ps | grep nextchat

   # 检查数据库
   docker exec nextchat-postgres psql -U nextchat_user -d nextchat -c "SELECT 1;"
   ```

3. **重新初始化**
   ```bash
   cd /www/wwwroot/nextchat
   ./scripts/init-provider-configs.sh
   ```

---

## 🎉 总结

**数据库已正确配置，同步功能已启用！**

**现在可以：**
1. ✅ 在网页上直接添加 API Key（推荐）
2. ✅ 从本地导入配置（如果有配置文件）
3. ✅ 使用同步功能（需要先有配置）

**下一步：**
- 刷新浏览器 (Ctrl+F5)
- 访问 https://chat.dyxcloud.com/api-config
- 添加您的 API Key
- 开始使用！

---

**记住：先添加配置，然后再同步！不要直接点击"保存并同步"！** 🚀
