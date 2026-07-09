# HANDOFF

## 当前任务

修复聊天页顶部导出/分享按钮在移动端非禁用态下图标看不见的问题，只收口到该按钮本身，不影响其他窗口操作按钮。

## 已完成

- 定位真实 owner：目标按钮在 `app/components/chat.tsx` 的聊天页 `window-actions` 里，第 5 个按钮是带 `ExportIcon` 的 `chat-export-action`。
- 定位真实样式来源：按钮外层尺寸在 `app/components/chat.module.scss`，共享图标偏移来自 `app/components/button.module.scss` 移动端对 `svg > g` 的统一 `translate(2px, 2px)`。
- 已在 `app/components/chat.module.scss` 的移动端 `chat-export-action` 分支里，把按钮、icon wrapper、svg 都锁成正方居中，并单独取消导出图标的 `g` 平移，避免图标往右下偏。
- 已补 `chat-export-action` 非禁用态的图标可见性兜底：显式锁定 icon wrapper / svg / g / path 的 `opacity: 1` 与 `filter: none`，避免移动端被暗色滤镜或透明度链路吃掉后“按钮还在但图标像消失”。
- 定位真实 owner：附件预览弹窗在 `app/components/chat.tsx` 的 `openMessageAttachedFilePreview`，样式在 `app/components/chat.module.scss` 的 `file-preview-modal` / `docx-preview-root`。
- DOCX / Excel 预览弹窗现在会额外带 `file-preview-modal-office` class，统一使用固定可用高度和内部滚动策略。
- `docx-preview` 渲染参数改为 `ignoreHeight: true`，避免短 Word 文档保留整张固定页面高度造成底部大空白。
- DOCX 和 Excel 预览容器统一填满弹窗内容区并内部滚动，避免一个窗口太窄、一个窗口底部大块空白。
- `section.docx` 样式强制取消固定高度，作为对 docx-preview 内联高度的兜底。
- 上传中的文件和图片卡片现在可点击 / 键盘触发，会提示“文件正在上传，上传完成后再预览”，不会打开失败预览。
- 输入区图片和文件混排时，图片缩略图与文件图标视觉高度一致：桌面 60px、移动端 54px。
- 已发送消息里如果同时有文件和图片，图片会并入同一个附件横排容器，不再单独显示在正文下方。
- 已发送消息里的单图/多图也统一为文件图标大小：桌面 60px、移动端 54px，点击仍打开原图。

## 验证

- 已运行 `yarn -s eslint app/components/chat.tsx app/components/button.tsx --no-error-on-unmatched-pattern`，通过。
- 已运行 `yarn lint`，通过。
- 已运行 `git diff --check`，通过。

## 当前状态

- 未提交、未推送。
- 工作区在本轮开始前已有多处未提交修改，包含 `app/components/chat.tsx`、`app/components/chat.module.scss` 及若干环境、文档、服务端文件。本轮只围绕附件预览相关文件继续修改。

## 下一步

- 如需继续确认视觉效果，可在本地 dev 环境用 `ccc` 用户打开任一聊天页，在移动端宽度下检查顶部第 5 个导出按钮；非禁用态下图标应稳定可见，并在 36x36 按钮内保持正中，不再往右下偏。
- 如需进一步确认视觉效果，可在本地 dev 环境用 `ccc` 用户分别打开带 DOCX / XLSX 附件的聊天，点击预览，检查两类 Office 预览窗口高度是否一致、内容是否在弹窗内部滚动；上传大文件时，上传完成前点击附件卡片应只显示提示；图片和文件混排、已发送带文件的图片都应在同一附件行内并显示为文件图标大小。

## 不要再踩的坑

- 不要直接改 `share.svg` 当第一选择，真实偏移先来自共享 `IconButton` 在移动端对所有 `svg > g` 的统一平移；这个导出图标只需要局部覆盖即可。
- 不要只改共享 `ui-lib` modal，高度问题的真实来源同时包含 DOCX 渲染出的固定页面高度和 Office 预览自己的 flex 分配。
- 不要用 `:has(.docx-preview-root)` 作为最终方案，直接在打开 DOCX / Excel 预览时加 modifier class 更明确。
- 不要把 `NEXTCHAT_DISABLE_AUTH=true` 写入生产或宝塔环境配置。
- 未经用户明确要求，不要提交、推送或部署。
