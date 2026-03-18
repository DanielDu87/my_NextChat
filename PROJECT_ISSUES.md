# NextChat 项目问题记录

> 最后更新：2026-03-18
> 分析范围：对话、配置、备份、同步相关代码

## 📋 问题列表

### 🔴 高优先级

#### 1. 防抖同步在页面刷新后会丢失

**位置**: `app/store/sync.ts:207-237`

**问题描述**:
```typescript
triggerDebounceSync(storeKeys?: SyncStoreKey[]) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(async () => {...}, DEBOUNCE_DELAY);
  localStorage.setItem(SYNC_DEBOUNCE_KEY, Date.now().toString()); // 只保存时间戳
}
```

**影响**: 用户修改数据后，如果在 3 秒防抖期间刷新页面，同步任务会丢失，导致云端数据未更新。

**建议修复**:
- 保存完整的同步任务信息到 localStorage
- 页面加载时检查并恢复未完成的同步任务

---

#### 2. DatabaseStateStorage 的 pendingWrites 处理风险

**位置**: `app/utils/database-state-storage.ts:99-104`

**问题描述**:
```typescript
if (!this.hydrated.has(name) || this.hydrating.has(name)) {
  this.pendingWrites.set(name, value); // 多次调用只保留最后一次
  this.cache.set(name, value);
  localStorage.removeItem(name);
  return;
}
```

**影响**: 在 hydration 过程中多次调用 setItem() 时，中间的写入可能丢失。

**建议修复**:
- 使用队列保存所有写入操作
- hydration 完成后按顺序执行所有写入

---

### 🟡 中优先级

#### 3. 双层存储系统的一致性问题

**位置**: `app/utils/indexeddb-state-storage.ts` + `app/utils/database-state-storage.ts`

**问题描述**:
- `IndexedDBStateStorage` 通过 `seedFromRemote()` 从远程拉取数据
- `DatabaseStateStorage` 也通过 `/api/db/sync/` API 存取数据
- 两个系统可能同时操作同一数据，产生竞态条件

**建议修复**:
- 明确两个存储层的职责边界
- IndexedDB 仅作为缓存层，所有写操作必须同步到数据库
- 添加读写锁机制防止并发冲突

---

### 🟢 低优先级

#### 4. 空会话过多问题

**位置**: `app/utils/sync.ts:255-286`

**问题描述**:
会话合并时会保留所有空会话（messages.length === 0），可能污染会话列表。

**建议修复**:
- 添加配置选项控制是否保留空会话
- 或在合并后自动清理空会话

---

#### 5. 同步触发不一致

**位置**: `app/store/*.ts`

**问题描述**:
| 操作 | 同步方式 |
|------|----------|
| `newSession()` | `triggerDebounceSync([StoreKey.Chat])` |
| 配置修改 | 部分调用 `markUpdate()`，部分调用 `triggerDebounceSync()` |

`markUpdate()` 只更新 `lastUpdateTime`，不会触发同步。

**建议修复**:
- 统一同步触发机制
- 或明确哪些场景只需要更新时间戳

---

#### 6. 本地偏好设置同步逻辑混乱

**位置**: `app/utils/sync.ts:81-86` 和 `sync.ts:275-276`

**问题描述**:
- 获取状态时排除了 `sidebarWidth` 和 `tightBorder`
- 但同步后又重新从 localStorage 恢复
- 逻辑不清晰，可能在某些场景下覆盖本地偏好

**建议修复**:
- 将本地偏好设置完全隔离到独立的 localStorage
- 不要让它们参与任何同步流程

---

#### 7. 版本号不一致

**位置**: `app/utils/sync-store-keys.ts:68` vs `app/store/sync.ts:429`

**问题描述**:
```typescript
// sync-store-keys.ts
[StoreKey.Sync]: 1.3,

// sync.ts
version: 1.4,
```

**建议修复**:
- 统一版本号来源
- 或建立版本号映射关系

---

## 📁 相关文件

```
app/
├── store/
│   ├── chat.ts       # 会话状态管理
│   ├── sync.ts       # 同步逻辑
│   ├── config.ts     # 配置状态
│   └── access.ts     # API 访问配置
├── utils/
│   ├── store.ts                 # Zustand 持久化工厂
│   ├── sync.ts                  # 状态合并逻辑
│   ├── sync-store-keys.ts       # 存储键定义
│   ├── indexeddb-state-storage.ts   # IndexedDB 存储
│   └── database-state-storage.ts    # 数据库存储
└── components/
    ├── auto-sync.tsx  # 自动同步组件
    └── exporter.tsx   # 数据导出
```

---

## 🔍 待进一步调查

1. **数据库同步 API 端点**: `/api/db/sync/` 的服务端实现
2. **并发场景**: 多标签页同时操作的同步行为
3. **错误恢复**: 同步失败后的重试和恢复机制
4. **数据迁移**: 版本升级时的数据迁移逻辑是否完整

---

## 📝 修复建议优先级

| 优先级 | 问题 | 影响 |
|--------|------|------|
| 🔴 高 | 防抖同步丢失 | 数据丢失风险 |
| 🔴 高 | pendingWrites 丢失 | 数据写入失败 |
| 🟡 中 | 双层存储竞态 | 一致性问题 |
| 🟢 低 | 空会话过多 | 用户体验 |
| 🟢 低 | 同步触发不一致 | 潜在数据不同步 |
