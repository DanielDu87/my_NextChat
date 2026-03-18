---
provider: codex
session_id: rollout-2026-03-15T12-13-51-019cefb3-4dbb-7203-a9a4-4a58778cf035
project: /Users/dyx/Code/NextChat
started_at: 2026-03-15T04:14:04.742+00:00
updated_at: 2026-03-15T04:18:58.596+00:00
message_count: 14
---

# yutoapi的veo2-fast模型。提示

## 👤 User (2026-03-15 04:14:04 UTC)

yutoapi的veo2-fast模型。提示

> 视频生成任务已创建
> 任务ID: `veo2-fast:601f9d6d-3943-4e8e-bfe2-8dab7e69e821`
> 为了防止任务中断，可以从以下链接持续获取任务进度:
> [数据预览](https://pro.asyncdata.net/web/veo2-fast:601f9d6d-3943-4e8e-bfe2-8dab7e69e821) | [原始数据](https://pro.asyncdata.net/source/veo2-fast:601f9d6d-3943-4e8e-bfe2-8dab7e69e821)
> 等待处理中

> 类型: 文字生成
> 🎬 开始生成视频.....

> ❌ 任务失败
> 错误: [400] Request failed with status code 400 | Message: Request contains an invalid argument. | Code: 400 | Status: INVALID_ARGUMENT | URL: /v1/video:batchAsyncGenerateVideoText
> 建议: 请尝试修改提示词后重试


## 🤖 Assistant (2026-03-15 04:14:10 UTC)

我先核对 NextChat 里 `yutoapi` 的 `veo2-fast` 请求链路和错误处理，确认这是上游参数限制还是我们组包有问题，再决定是改代码还是改提示文案。


## 🤖 Assistant (2026-03-15 04:14:16 UTC)

已经定位到媒体请求适配层，下一步看 `veo2-fast` 的参数组装和 YutoAPI 的重试分支，确认 400 是不是由我们发了不兼容字段。


## 🤖 Assistant (2026-03-15 04:14:50 UTC)

我看到当前实现把所有 AiHubMix/YutoAPI 视频模型基本都走同一套 `v1/videos` 组包，`veo2-fast` 只有一个很粗的特判。现在继续查模型参数规则和界面配置，确认有没有把 `size`/`duration` 之类不该传的字段混进这个模型。


## 🤖 Assistant (2026-03-15 04:15:25 UTC)

我准备把 `veo` 系列的文本生视频请求改成最小参数集：只发 `model`、`prompt` 和可选图片，不再透传当前的 `duration=4/8/12`。从现有实现看，`veo2-fast` 最可能就是被这个字段打成 `INVALID_ARGUMENT`。


## 🤖 Assistant (2026-03-15 04:15:44 UTC)

代码已改完，正在补验证。`pnpm` 在当前环境不存在，我先看仓库实际用的是哪套包管理器，再跑对应测试。


## 🤖 Assistant (2026-03-15 04:16:03 UTC)

仓库里还有用户之前已经改过但未提交的 `openai.ts` 其他差异，我没有回退它们。测试工具链缺少 `yarn`，我改用本地 `node_modules` 里的 Jest 直接跑单测。


## 🤖 Assistant (2026-03-15 04:16:14 UTC)

单测里还有一个旧断言和当前实现不一致：非 `veo` 的视频请求现在会带 `size`/`seconds`。我把这个断言同步到现状，再重跑，避免把已有行为误判成回归。


## 🤖 Assistant (2026-03-15 04:16:39 UTC)

已把 `yutoapi` 的 `veo` 文生视频请求改成最小参数集，`veo2-fast` 现在不再额外发送 `duration=4/8/12`。按当前代码路径看，这个字段是最可能触发 `INVALID_ARGUMENT` 的原因；你的报错发生在文字生视频接口 `/v1/video:batchAsyncGenerateVideoText`，而我们之前正好会在纯文本场景塞进 `duration: 4`。修改在 [openai.ts](/Users/dyx/Code/NextChat/app/client/platforms/openai.ts) 和 [openai-media-routing.test.ts](/Users/dyx/Code/NextChat/test/openai-media-routing.test.ts)。

我补了一个回归测试，确认 `veo2-fast` 文本生成只发 `model + prompt`；并同步修正了一个旧测试断言以匹配当前非 `veo` 视频模型的既有行为。验证命令是：
```bash
node --no-warnings --experimental-vm-modules ./node_modules/jest/bin/jest.js --ci test/openai-media-routing.test.ts
```
结果 `14 passed`。测试里有一组 `indexedDB is not defined` 的 `console.warn`，但不影响这次用例通过。

你现在可以直接重试同一类提示词；如果还报 400，下一步就该抓实际请求体和上游返回体，看是不是 `prompt` 内容本身触发了 YutoAPI/Google VEO 的参数校验。

<oai-mem-citation>
<citation_entries>
MEMORY.md:28-33|note=[used YutoAPI and AIHubMix related memory keyword to narrow code search]
</citation_entries>
<rollout_ids>
019ce21b-241f-7180-b7e0-a0e478f59d05
</rollout_ids>
</oai-mem-citation>


## 👤 User (2026-03-15 04:17:46 UTC)

还是提示


> 视频生成任务已创建
> 任务ID: `veo2-fast:25308d81-2c50-4ee5-b33d-d8e641c4bc6a`
> 为了防止任务中断，可以从以下链接持续获取任务进度:
> [数据预览](https://pro.asyncdata.net/web/veo2-fast:25308d81-2c50-4ee5-b33d-d8e641c4bc6a) | [原始数据](https://pro.asyncdata.net/source/veo2-fast:25308d81-2c50-4ee5-b33d-d8e641c4bc6a)
> 等待处理中

> 类型: 文字生成
> 🎬 开始生成视频.....

> ❌ 任务失败
> 错误: [400] Request failed with status code 400 | Message: Request contains an invalid argument. | Code: 400 | Status: INVALID_ARGUMENT | URL: /v1/video:batchAsyncGenerateVideoText
> 建议: 请尝试修改提示词后重试


## 🤖 Assistant (2026-03-15 04:17:50 UTC)

我继续往下查两个方向：一是确认 `veo2-fast` 当前上游接口到底接受哪些字段，二是检查 NextChat 里是否还会附带其他不兼容参数或走错路由。然后我会把可观测性补上，避免只能看到一条泛化 400。


## 🤖 Assistant (2026-03-15 04:18:13 UTC)

上游资料和公开对接文档显示，`veo` 这类接口常见必填并不只有 `model/prompt`，还有一类供应商要求显式传 `action: text2video`，而我们当前没带这个字段。你这次报错依旧是上游真正开始执行后才在 Google/VEO 侧被判 `INVALID_ARGUMENT`，所以我现在直接核对任务原始数据格式，并准备把请求日志打到能复现的粒度。


## 🤖 Assistant (2026-03-15 04:18:55 UTC)

已经拿到这条失败任务的原始数据。关键信息是它实际提交给异步任务层的 `req.prompt` 仍然是中文，而不是上面显示的英文 `enhanced_prompt`；同时 Google Veo 2 官方文档明确写了 `Prompt languages: English`。这说明不是我们还在多传别的字段，而是这条链路里“提示词增强”并没有把中文改成真正送审的英文 prompt。


## 👤 User (2026-03-15 04:18:58 UTC)

<turn_aborted>
The user interrupted the previous turn on purpose. Any running unified exec processes were terminated. If any tools/commands were aborted, they may have partially executed; verify current state before retrying.
</turn_aborted>


