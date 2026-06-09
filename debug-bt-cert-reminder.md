# Debug Session: bt-cert-reminder
- **Status**: [CLOSED]
- **Issue**: 宝塔“证书到期提醒”入口打不开，但站点证书已能手动部署成功。
- **Debug Server**: N/A
- **Log File**: N/A

## Reproduction Steps
1. 登录宝塔面板。
2. 打开证书相关页面或“证书到期提醒”入口。
3. 页面打不开，但 `ngpt.chat` 证书可以手动部署。

## Hypotheses & Verification
| ID | Hypothesis | Likelihood | Effort | Evidence |
|----|------------|------------|--------|----------|
| A | 宝塔前端入口依赖的接口返回正常，但前端页面缓存或路由状态异常 | High | Low | Rejected：请求日志中 `/ssl?action=get_order_list`、`/site?action=GetSSL` 均返回 200 |
| B | 到期提醒页面依赖的证书列表数据结构不完整，前端渲染时报错 | High | Med | Rejected：删除 `ssl_info` 中 `ngpt.chat` 记录后，报错转为“未查询到站点【ngpt.chat】”，不是前端渲染异常 |
| C | 之前清理免费证书记录后，提醒页面关联的订单列表与站点证书列表不一致 | Med | Med | Confirmed：`ngpt.chat` 在 `site.db` 无站点级记录，但此前在 `ssl_info` 中有本地证书记录 |
| D | 宝塔插件或模块资源加载异常，导致“到期提醒”页面脚本初始化失败 | Med | Med | Rejected：相关接口均 200，且错误文本来自后端 `mod/base/push_mod/manager.py` |
| E | 宝塔“证书到期提醒”模块只认普通站点表，不认 Docker 网站表 | High | Med | Confirmed：`ngpt.chat` 仅存在于 `docker.db` 的 `docker_sites/docker_domain`，不在 `site.db.sites/domain` 中 |

## Log Evidence
- `ssl_data.db.ssl_info` 删除前存在 1 条 `ngpt.chat` 记录：`(43, adf014..., ngpt.chat, 2026-09-07)`
- `autodeploy_task / deploy_targets / deploy_auths` 中均无 `ngpt.chat` 记录
- 已删除 `ssl_info` 中 `ngpt.chat` 记录，删除后查询结果为 `[]`
- 备份文件：`/root/bt-sslinfo-backup-20260609-113850/ssl_data.db`
- `ngpt.chat` 仅存在于 `docker.db.docker_sites/docker_domain`，不存在于 `site.db.sites/domain`
- 报错来源：`/www/server/panel/mod/base/push_mod/manager.py` 返回 `未查询到站点【ngpt.chat】`

## Verification Conclusion
- 已按“删除自动提醒相关数据库数据”的方向处理：仅删除 `ssl_data.db.ssl_info` 中 `ngpt.chat` 的本地证书元数据。
- 未修改 nginx 证书文件、站点配置和实际 HTTPS 部署状态。
- 新证据表明根因不是残留提醒数据，而是宝塔“证书到期提醒”模块按普通站点表查站点，查不到 Docker 网站 `ngpt.chat`。
- 已将最终操作路径、数据库位置、兼容修复脚本和注意事项同步进 `docs/baota-docker-guide.md`，后续以文档为准执行。
