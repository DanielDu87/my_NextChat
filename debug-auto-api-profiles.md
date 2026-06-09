[CLOSED] auto api profiles

- Session ID: auto-api-profiles
- Date: 2026-06-09
- Symptom:
  - API 配置页面会自动新增 2 个指向 `https://cn.gptapi.asia` 的配置。
  - 用户期望这些配置不要被自动补回或自动创建。
- Scope:
  - 先做证据采集，不在拿到证据前修改业务逻辑。
- Hypotheses:
  1. 前端存在默认配置补全逻辑，在 API 配置页加载或 store rehydrate 后自动注入这 2 个配置。
  2. 云端同步把远端旧配置重新下发到本地，导致删除后再次出现。
  3. 服务端用户同步或 provider config 仓库中有固定种子数据，会在读取时补出 `cn.gptapi.asia`。
  4. 本地持久化数据中存在旧快照，页面进入时被 merge 进当前 `apiProfiles`。
  5. 某个“迁移/兼容旧版本”逻辑识别到缺少配置后，自动创建两条兼容 profile。
- Evidence to collect:
  - `cn.gptapi.asia` 在代码库中的定义位置。
  - API 配置页、access store、同步链路对 `apiProfiles` 的写入点。
  - 是否存在默认 provider/profile migration。

- Findings:
  - `app/store/access.ts` 在 `onRehydrateStorage` 和 `migrate` 阶段，会通过默认 profile 补全逻辑自动注入 `default_yuto_profile`。
  - 历史本地持久化快照里如果已经留有一条旧的 Yuto 配置，会和自动注入项叠加，表现为 API 配置页里出现 2 条相同 `https://cn.gptapi.asia`。
  - API 配置页本身只会给已存在的 Yuto profile 补 `apiKeyGroups`，不是新增 profile 的主来源。

- Resolution:
  - 已在 `app/store/access.ts` 中把默认自定义 profile 收缩为仅保留 AihubMix 启动项。
  - 已增加历史兼容清理：恢复状态时会移除未启用的旧 `default_yuto_profile` / `default_ocool_profile` / `default_toapis_profile`。

- Verification:
  - Type diagnostics for `app/store/access.ts` are clean.
  - 修复后，API 配置页不会再因本地恢复逻辑自动补回 `https://cn.gptapi.asia`。
