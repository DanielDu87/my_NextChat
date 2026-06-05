# Debug Session: mobile-input-scroll [OPEN]

## Symptom

- 移动端有图片且多行文字时，键盘未展开状态下，输入框内部滚动条看起来滚不到底部。

## Expected

- 键盘未展开时，输入框内部仍能滚动到文本底部，底部文字可见。

## Hypotheses

1. 收起键盘后的保留高度分支把 `scrollTop` 重置到顶部，覆盖了之前的“滚到底”操作。
2. 有图片时，输入框可见高度变化了，但“滚到底”仍使用旧的 `clientHeight/scrollHeight` 时机，导致目标位置偏小。
3. CSS 在未展开态把输入框限制成单行或错误的固定高度，导致实际上没有足够的可滚动区域。
4. 图片条高度加入后，文字容器的滚动节点还是原来的 `contentEditable`，但其 `max-height` 没同步更新。
5. 光标移动到末尾和 `scrollIntoView` 在未展开态触发顺序不对，最后一次调用把视口拉回了非底部位置。

## Plan
度加入后，文字容器的滚动节点还是原来的 `contentEditable`，但其 `max-height` 没同步更新。
5. 光标移动到末尾和 `scrollIntoView` 在未展开态触发顺序不对，最后一次调用把视口拉回了非底部位置。

## Plan

- 加最小埋点，记录未展开态下输入框在以下节点的 `scrollTop/clientHeight/scrollHeight`：
  - 图片数量变化后
  - 键盘收起保留高度前后
  - 触发“滚到底”前后
- 根据日志判定哪条假设成立，再做最小修复。
