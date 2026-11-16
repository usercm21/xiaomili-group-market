# 接入与数据契约

`lib/game-market/index.js` 导出 `createGameMarket`、`createMemberProvider`、`parseCandidate` 与 `validateConfig`。接入层应只把原始、直接提及机器人的群文本传给 `handle`，并在发送前自行处理账号级节流、投递结果与重试。

`handle` 所需的可信字段是 `chatWxid`、`senderUsername`、写操作的 `localId`、`timestampSec` 与 `receivedAtMs`。群 ID 形如 `...@chatroom`；发送者 ID 和消息 ID 必须来自入站平台，不得用昵称、时间戳或 LLM 猜测。成员快照返回 `{ok, snapshotId, members:[{username,nickname}]}`，其中 `snapshotId` 应能区分两次独立成功读取。

涉及他人的指令和排行需要完整成员快照。帮助、版本及本人状态等查询不应因成员接口短暂失败而阻塞。内置 `createMemberProvider` 通过 `datasvc members <groupId> --json` 获取快照；可设置 `DATASVC_BIN`、`DATASVC_HOME`，也可注入自己的 `memberProvider`。生产服务应校验数据服务的身份和可用性。

`result.consumed=false` 表示文本不是市场指令。其余结果包含 `status`、`code`、`reply`；`status=unknown` 表示存储结果不确定，接入方不得换新消息 ID 盲目重试。`reply` 是待发送文本，不代表已投递。关闭服务时调用 `market.close()`。

账本按群拆分到 `data/game-market/*.sqlite`，含个人 ID、资产、关系、流水和幂等键。运行根、数据库与备份应使用私有权限，不进入公开仓库。升级前应使用 SQLite 一致性备份；未知 schema 或不匹配的规则指纹会拒绝加载。1.4.1 清理旧流水时保留 `processed_requests`，避免旧消息再次记账。
