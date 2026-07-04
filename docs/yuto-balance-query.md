
# Yuto 余额查询集成说明

## 概述

本次重构将 Yuto 的余额查询功能集成到了现有的通用余额查询系统中，支持通过统一的界面查询 Yuto 账户余额。

## 功能特性

- 无缝集成到现有的余额查询系统
- 支持 Yuto 特殊的 `New-API-User` Header 认证
- 自动识别 Yuto 服务提供商的 Base URL
- 支持解析 `API_Key|User_ID` 格式的管理密钥
- 保持与其他服务提供商一致的用户体验

## 接口规范

### Yuto 官方接口

- **方法**: GET
- **路径**: `/api/user/self`
- **认证方式**:
  - Header: `Authorization: Bearer {API_Key}`
  - Header: `New-API-User: {User_ID}`
- **响应格式**:
  ```json
  {
    "data": {
      "quota": 1000000,
      "used_quota": 500000
    },
    "success": true
  }
  ```
  - 余额计算: `quota / 500000`

## 使用方法

### 1. 配置管理密钥

在「余额查询」页面，找到 Yuto 配置项，按以下格式输入管理密钥：

```
API_Key|User_ID
```

**示例**:
```
your_api_key|your_user_id
```

### 2. 查询余额

- 点击「更新」按钮查询单个配置的余额
- 点击「全部查询」按钮批量查询所有配置的余额

### 3. 查看结果

查询成功后会显示：
- 当前余额（美元）
- 最后更新时间
- 详细的查询尝试记录（用于调试）

## 技术实现

### 核心文件修改

1. **`app/utils/server/provider-balance.ts`**
   - 添加 Yuto Base URL 检测
   - 解析 `API_Key|User_ID` 格式的密钥
   - 自动添加 `New-API-User` Header

2. **`app/components/provider-balances.tsx`**
   - 添加 Yuto 配置提示
   - 动态显示配置格式说明

### 支持的 Yuto Base URL

- `https://cn.gptapi.asia`
- `https://api.yutoai.net`
- `https://yutoai.net`

### 余额解析逻辑

系统已内置支持从以下字段解析余额：
- `data.quota` (除以 500000)
- `data.remaining_quota`
- `data.balance`
- 以及其他常见的余额字段格式

## 错误处理

### 常见错误信息

- **余额查询配置不完整**: 请检查是否正确填写了 Base URL 和管理密钥
- **余额查询鉴权失败**: 请检查 API Key 和 User ID 是否正确
- **未找到可用的余额查询路径**: 确认该 Yuto 接口是否支持余额查询
- **余额查询触发上游限流**: 请稍后重试

## 注意事项

1. **密钥格式**: 必须严格使用 `API_Key|User_ID` 格式，使用竖线分隔
2. **密钥安全**: 管理密钥会加密存储在 PostgreSQL 数据库中
3. **系统令牌**: Yuto 余额查询需要使用「系统令牌」而非普通的 API 令牌
4. **余额单位**: 返回的余额会自动转换为美元显示

## 向后兼容

本次修改完全向后兼容：
- 现有配置不受影响
- 其他服务提供商的余额查询功能正常工作
- 数据库结构无需变更

## 测试

可使用项目内的测试脚本验证功能：

```bash
# 简单接口测试
node -r esbuild-register scripts/test-yuto-balance.ts

# 集成测试
node -r esbuild-register scripts/test-yuto-integration.ts
```
