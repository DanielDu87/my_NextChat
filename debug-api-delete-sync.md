[OPEN] api-delete-sync

# 背景

- 症状：API 配置在前端删除后，疑似同步异常，删除结果不能稳定保持
- 目标：定位删除动作在本地 store、远端 store、数据库镜像三层中的不一致点

# 假设

1. 前端删除后，本地 `Access` store 已删，但远端 `Access` 快照未及时覆盖，随后又被远端拉回
2. 删除动作只删了 `apiProfiles`，但某条自动对齐逻辑会用远端旧快照重新合并 profile
3. `provider_configs` 数据库镜像删除成功，但 `Access` 共享 store 仍保留旧 profile，下一次同步又把它写回
4. 删除后的 `lastUpdateTime` / 选择状态时间戳没有正确推进，导致合并策略误判“远端更新”
5. 某些默认/托管 profile 有额外补全逻辑，删除后会被初始化流程重新注入

# 已知线索

- `Access` 是共享 store
- `provider_configs` 由 `Access.apiProfiles` 镜像写入
- 聊天页存在一段远端 profile 对齐逻辑，之前已收紧，避免自动恢复远端独有 profile

# 下一步
ovider_configs` 由 `Access.apiProfiles` 镜像写入
- 聊天页存在一段远端 profile 对齐逻辑，之前已收紧，避免自动恢复远端独有 profile

# 下一步

- 采集删除前后的本地 `Access`、远端 `Access`、数据库 `provider_configs` 三份状态
- 对照时间戳与 profile id，确认是哪一层把已删 profile 恢复回来
