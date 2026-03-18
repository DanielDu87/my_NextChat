---
provider: codex
session_id: rollout-2026-03-15T13-46-28-019cf008-1970-7723-a132-fdc0d69160ff
project: /Users/dyx/Code/NextChat
started_at: 2026-03-15T05:46:48.394+00:00
updated_at: 2026-03-15T06:20:38.163+00:00
message_count: 32
---

# yuto和其他供应商的模型候选列表排序，都按照aihubmix的处理

## 👤 User (2026-03-15 05:46:48 UTC)

yuto和其他供应商的模型候选列表排序，都按照aihubmix的处理


## 🤖 Assistant (2026-03-15 05:46:51 UTC)

我理解你的需求是：把 `Yuto` 和其他供应商的模型候选列表排序逻辑，统一成和 `AIHubMix` 一样的处理方式。  
我先快速检索当前代码里各供应商的排序实现位置，确认最小改动点后直接修改。


## 🤖 Assistant (2026-03-15 05:46:57 UTC)

我已经定位到核心文件在 `app/components/api-config.tsx`，下一步会直接看“拉取模型后排序”的具体实现，找出 `AIHubMix` 与 `Yuto/其他` 的差异并统一。


## 🤖 Assistant (2026-03-15 05:47:01 UTC)

我看到 `api-config.tsx` 只是调用 `fetchFromProvider`，真正的排序应在 `useModelFetcher` 里。  
我现在去定位该 hook，并按 `AIHubMix` 逻辑抽出统一排序函数给所有供应商复用。


## 🤖 Assistant (2026-03-15 05:47:03 UTC)

已找到 hook 文件路径是 `app/utils/useModelFetcher.ts`（不是 `app/hooks`）。我现在打开这个文件并直接修改排序逻辑。


## 🤖 Assistant (2026-03-15 05:47:15 UTC)

我已经定位到模型列表排序实际发生在 `ui-lib.tsx` 的分组渲染逻辑里。  
接下来我会把“AIHubMix 的排序规则”抽成统一比较器，并在所有供应商（包含 Yuto）路径上复用。


## 🤖 Assistant (2026-03-15 05:47:24 UTC)

我确认排序器本身已经是“优先 `order`，其次发布时间/版本”的统一逻辑。  
现在我去找 `order` 在候选项生成时是怎么赋值的，问题很可能在 `Yuto/其他供应商` 没有把上游顺序写入 `order`。


## 🤖 Assistant (2026-03-15 05:47:54 UTC)

我确认到一个关键差异：`Yuto` 在多分组合并后，`sorted` 序号会重复/不连续，而 `AIHubMix` 是单次映射，排序序号天然连续。  
我准备在 `app/utils/models.ts` 增加一个统一的“AIHubMix 风格排序后处理”，让 Yuto 和其他供应商都走同一套候选顺序归一化。


## 🤖 Assistant (2026-03-15 05:48:08 UTC)

已完成代码修改，`Yuto/AIHubMix/其他供应商` 现在都走同一套排序后处理。  
我接着跑一个快速校验（diff + 相关测试）确认没有引入回归。


## 🤖 Assistant (2026-03-15 05:48:12 UTC)

本地没有 `yarn`，我改用仓库现有包管理器继续做测试校验。


## 🤖 Assistant (2026-03-15 05:48:24 UTC)

我已完成代码变更；测试这边因为本机缺 `yarn` 导致默认脚本无法直接跑。  
我会用仓库脚本等价的 Node 命令再跑一次，尽量给你可复核结果。


## 🤖 Assistant (2026-03-15 05:48:39 UTC)

已按你的要求把 `Yuto` 和其他供应商的候选模型排序统一为与 `AIHubMix` 一致的处理方式。

主要改动：
- 在 [app/utils/models.ts](/Users/dyx/Code/NextChat/app/utils/models.ts) 新增 `normalizeModelOrderLikeAiHubMix`：
  - 优先用上游 `order`（如果有）
  - 没有 `order` 就保持当前数组顺序
  - 最后统一重建连续 `sorted`（`1000 + index`），保证选择器排序稳定
- 在 `fetchModelsFromProvider` 的各分支（`Yuto` / `AIHubMix` / `Ocoolai` / 默认分支）返回前统一调用该函数。

验证：
- 运行：`node --no-warnings --experimental-vm-modules ./node_modules/jest/bin/jest.js test/model-provider.test.ts --runInBand`
- 结果：`PASS`（4/4）
- 备注：本机无 `yarn` 命令，所以用等价的 Node + Jest 命令完成测试。

<oai-mem-citation>
<citation_entries>
MEMORY.md:17-18|note=[used prior guidance on model selector ordering and relevant code touchpoints]
MEMORY.md:28-28|note=[used keyword context linking AIHubMix and YutoAPI in useModelFetcher/api-config flow]
</citation_entries>
<rollout_ids>
019ce120-416b-7d41-b31b-468600525998
019ce21b-241f-7180-b7e0-a0e478f59d05
</rollout_ids>
</oai-mem-citation>


## 👤 User (2026-03-15 05:49:10 UTC)

继续


## 🤖 Assistant (2026-03-15 05:49:14 UTC)

- 统一了 `fetchModelsFromProvider` 各路径的候选排序：新增 `normalizeModelOrderLikeAiHubMix` 强制先用上游 `order`、再基于原顺序排序、最后重写连续 `sorted`，确保 `AIHubMix`、`Yuto` 和其他供应商都与选择器排序一致。  
- plist：`app/utils/models.ts`#L288，`mapModels` 后处理返回前都调用上面函数，所以所有候选都走同一条标准化排序路径。  
- 验证：`node --no-warnings --experimental-vm-modules ./node_modules/jest/bin/jest.js test/model-provider.test.ts --runInBand`（通过，4 个测试），原本 `yarn` 不可用所以直接调用 `node` 执行 `jest`。

建议的下一步：1. 如果有 UI 层联调，确认模型列表在选择器/配置页的顺序是否如预期；2. 若自动化覆盖更多用例，可在 `Selector` 相关组件上加排序行为测试。


## 👤 User (2026-03-15 05:49:37 UTC)

<image name=[Image #1]>


## 🤖 Assistant (2026-03-15 05:50:38 UTC)

- `app/utils/models.ts#L291-L317` 里新增 `normalizeModelOrderLikeAiHubMix`，统一走与 AIHubMix 相同的排序策略：优先用上游 `order`，其次保留原数组顺序，最后重写连续的 `sorted` 保证选择器行为一致。
- `app/utils/models.ts#L783-L806` 的 Yuto 分支现在先按 `getYutoApiKeyGroupPriority` 对所有模型排序（优先级高的分组排在前面、同组按 `sorted` 保持 API 顺序），再调用上述归一化函数，确保 Yuto 与其它供应商都遵循同一套候选顺序逻辑。
- 验证：`node --no-warnings --experimental-vm-modules ./node_modules/jest/bin/jest.js test/model-provider.test.ts --runInBand`（4 个测试全部通过）。

建议的下一步：
1. 在 UI 上（模型选择器/配置页）确认 Yuto 下拉列表真的按照新排序显示，尤其留意多分组下的高优先级模型是否被排到最靠前的位置。
2. 若需要更强的自动化保障，可考虑在 `Selector` 相关测试里加入基于 `sorted`／`order` 的行为断言，确保未来改动不会破坏排序。


## 👤 User (2026-03-15 05:53:26 UTC)

<image name=[Image #1]>


## 🤖 Assistant (2026-03-15 05:53:30 UTC)

- 目前图片里的排序依然按 `gpt-4` 系列、`sora`、`gpt-5-mini-flex` 等上游 `order` + 名称组合排序输出，说明最新改动已经生效：`Yuto` 多分组模型会先按 `getYutoApiKeyGroupPriority` 按分组权重降序，再按原始 `sorted` 补顺序，最后统一 `normalizedModelOrderLikeAiHubMix` 重新赋连续 `sorted`。
- 如果你仍然看到异常，下一步建议确认实际返回的模型里是否带 `order`、`apiKeyGroup` 字段，或看看 UI 里是否用了缓存旧数据（清空 WebStorage 然后重新加载）。
- 需要我进一步追查某个具体模型的 `sorted` 值或对应 API 响应吗？


## 👤 User (2026-03-15 05:53:46 UTC)

我不要，我要完全按照aihubmix的排序，不管分组


## 🤖 Assistant (2026-03-15 05:54:16 UTC)

- 调整 `app/utils/models.ts#L700` 所在的 Yuto 分支：合并后直接按 `Map` 的插入顺序取出模型，不再额外按分组优先级重排，而是把结果交给 `normalizeModelOrderLikeAiHubMix`，因此输出顺序完全由上游返回的序列决定，和 AIHubMix 一致。
- 这个流程仍保留在合并阶段用 `getYutoApiKeyGroupPriority` 选择更高优先级的分组数据，但不会影响最终的 list 排序，保证去除分组干预后得到的候选顺序只受 API 原始顺序+AIHubMix 那套归一化规则驱动。
- 测试：`node --no-warnings --experimental-vm-modules ./node_modules/jest/bin/jest.js test/model-provider.test.ts --runInBand`（通过）。
- 后续建议：1. 本地在 UI 中重新加载 Yuto 模型列表，确认选择器顺序完全与 AIHubMix 一致；2. 若需更高信心，可在模型列表相关组件上增加顺序断言测试。


## 👤 User (2026-03-15 05:55:00 UTC)

<image name=[Image #1]>


## 🤖 Assistant (2026-03-15 05:55:46 UTC)

- 保留 Yuto 多分组合并时的插入顺序，不再在合并后按分组优先级重排，直接把 `Map` 里的值交给 `normalizeModelOrderLikeAiHubMix` 统一归一，因此最终的 `sorted` 顺序完全跟随 AIHubMix 里那套原始序列；具体改动在 `app/utils/models.ts#L703-L820`。
- 测试：`node --no-warnings --experimental-vm-modules ./node_modules/jest/bin/jest.js test/model-provider.test.ts --runInBand`（通过）。
- 建议： UI 上刷新 Yuto 模型列表确认顺序与 AIHub mix 一致；如果需要更高信心可在模型选择器相关组件加个顺序断言测试。


## 👤 User (2026-03-15 06:17:00 UTC)

还是不行，把模型顺序设置为一个文件，公共维护和更新，从文件统一读取，不同供应商的全部合并，每次同步都执行


## 🤖 Assistant (2026-03-15 06:17:10 UTC)

你的目标我理解为：不要再依赖各供应商返回顺序或分支逻辑，而是把模型排序收口成一个公共文件，所有供应商合并后都按这份文件统一排序，并且每次同步都执行。  
我先定位当前“同步入口 + 排序入口 + 模型元数据结构”，然后直接改成集中式排序源。


## 🤖 Assistant (2026-03-15 06:17:15 UTC)

我已经确认改动点主要在 `app/utils/models.ts` 和 `app/store/config.ts` 这条同步链路，适合把排序抽成一个独立清单文件，在合并入库前统一重排。  
下一步我会先读这两个文件的具体合并逻辑，再落一个公共排序表和统一排序函数。


## 🤖 Assistant (2026-03-15 06:17:29 UTC)

我已经确认，仅在供应商分支里改顺序不够，因为真正稳定的入口应该是“合并入库”这一层。  
我准备把排序提升成公共注册表文件，并在 `mergeModels` / `updateModelsInStore` 之前统一执行，这样不管是单供应商刷新还是全量同步，都会走同一套顺序。


## 🤖 Assistant (2026-03-15 06:17:40 UTC)

我准备把 `ui-lib.tsx` 里那套零散的发布时间/版本规则抽走，落成单独文件，然后让 `models.ts` 和 `config.ts` 共用它。  
这样排序规则只有一个真值源，后续你只需要维护一个文件。


## 🤖 Assistant (2026-03-15 06:18:10 UTC)

现在开始落文件级改造：新增公共排序注册表文件，并把 `models.ts`、`config.ts`、`ui-lib.tsx` 接到这一个排序源上。  
改完我会补一个针对排序函数的测试，避免后面再回退成分支各管各的。


## 🤖 Assistant (2026-03-15 06:19:48 UTC)

公共排序文件和接线已经落下去了。现在我在跑针对新排序入口的测试，确认“同步入库”和“UI 读取”都用的是同一套规则。


## 🤖 Assistant (2026-03-15 06:19:59 UTC)

测试暴露出一个真实问题：我刚才的公共排序函数还把原始 `sorted/order` 放在最前面了，这会继续压过文件里的规则。  
我现在把它改成“文件规则优先，原始顺序只做最后兜底”，这才符合你说的“完全统一读取文件”。


## 🤖 Assistant (2026-03-15 06:20:12 UTC)

还差一个具体缺口：公共文件里没有覆盖 `gpt-4-turbo` 这一档，所以它落回了通用规则，被 `gpt-3.5` 挤到后面。  
我补上这条显式规则后再回归测试，确保你截图里的这类模型也按文件顺序走。


## 🤖 Assistant (2026-03-15 06:20:38 UTC)

已经改成“文件统一排序源 + 每次同步必走”的结构，不再靠各供应商分支各自处理。

核心变化：
- 新增公共排序文件 [model-order.ts](/Users/dyx/Code/NextChat/app/utils/model-order.ts#L1)，把模型顺序规则集中维护在 `MODEL_ORDER_REGISTRY`，并提供 `applyUnifiedModelOrder` / `compareTitlesByModelOrder`。
- 同步入库统一执行排序：
  - [models.ts](/Users/dyx/Code/NextChat/app/utils/models.ts#L4) 在各供应商拉取结果返回前统一走 `applyUnifiedModelOrder`。
  - [models.ts](/Users/dyx/Code/NextChat/app/utils/models.ts#L835) 在 `updateModelsInStore` 里先排序，再写 `customModels` 和合并结果。
  - [config.ts](/Users/dyx/Code/NextChat/app/store/config.ts#L18) 在 `mergeModels` 里对“新旧模型合并后的全集”再次统一排序，保证每次同步都执行，不管来源是单供应商刷新还是全量同步。
- UI 也改成读同一套规则：
  - [ui-lib.tsx](/Users/dyx/Code/NextChat/app/components/ui-lib.tsx#L29)
  - [ui-lib.tsx](/Users/dyx/Code/NextChat/app/components/ui-lib.tsx#L761)
  选择器不再维护自己的一套发布时间表，直接复用公共排序函数。
- 补了回归测试 [model-order.test.ts](/Users/dyx/Code/NextChat/test/model-order.test.ts#L1)，并把 `gpt-4-turbo` 补进公共规则，解决你截图里这类模型仍然排错的问题。

验证我已经跑过：
- `test/model-order.test.ts` 通过
- `test/model-provider.test.ts` 通过

现在这套逻辑满足你的要求：排序规则只维护一个文件，不区分 Yuto、AIHubMix 或其他供应商；不同供应商模型合并后，统一按这个文件排序；每次同步和合并都会重新执行。

如果你现在刷新后还有不对，下一步就不是代码路径问题了，而是注册表里缺少某些具体模型规则。我可以继续把你常用供应商的一批模型补进 [model-order.ts](/Users/dyx/Code/NextChat/app/utils/model-order.ts#L11)，把顺序调到你要的精度。

<oai-mem-citation>
<citation_entries>
MEMORY.md:17-19|note=[used prior guidance that model ordering should be centralized and verified through shared entry points]
MEMORY.md:55-55|note=[used prior debugging guidance to fix sorting at accessStore and UI entry points instead of styling layer]
</citation_entries>
<rollout_ids>
019ce120-416b-7d41-b31b-468600525998
</rollout_ids>
</oai-mem-citation>


