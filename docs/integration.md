# 接入与数据契约

`lib/game-market/index.js` 导出 `createGameMarket`、`createMemberProvider`、`parseCandidate` 与 `validateConfig`。接入层应只把直接提及机器人的群文本传给 `handle`，并在发送前自行处理账号级节流、投递结果与重试。`@小米粒` 只是示例名称；接入者应改成自己的机器人名称，并把同一名称作为 `agentName` 传入。若平台的原始提及格式不是 `@名称`，适配层须先验证直接提及，再规范化命令文本。

**“小米粒群友市场”是固定的游戏品牌名。**机器人名称仅用于指令提及和回执中的示例提及。接入模板只在发送前替换 `@小米粒`；不要替换品牌名、版本名或命令中的“小米粒群友市场”。

## 接入方必须提供

| 项目 | 要求 |
| --- | --- |
| 机器人名称 | `agentName` 与规范化后的 `@机器人名称 #命令` 完全一致；通过平台元数据确认直接提及。 |
| 群范围 | `config.enabled=true`。默认 `allGroups=false`，此时 `config.groups` 必须包含当前群；要让现有及新加入的所有可信群默认开启，可显式设 `allGroups=true`。模块现要求群 ID 符合 `[A-Za-z0-9_-]{1,96}@chatroom`；其他平台可按 README 模板做稳定映射。群 ID 的映射需跨重启保持不变。 |
| 入站身份 | `senderUsername` 使用平台稳定用户 ID，不用昵称；成员快照里的 `username` 必须使用相同 ID。ID 长度不超过 128，不能含控制字符。 |
| 写操作消息 ID | `localId` 使用平台提供的稳定消息 ID，长度不超过 160；不能用时间戳、随机值或重试时新生成的 ID。相同入站消息重投必须保持原 ID。 |
| 消息时间 | `timestampSec` 是平台消息发生时间，单位秒；写操作只接受相对接收时间过去 5 分钟至未来 1 分钟内的消息。`receivedAtMs` 传服务接收时间，单位毫秒。 |
| 成员来源 | 其他聊天工具应注入 `memberProvider.getSnapshot(groupId)`；返回 `{ok,snapshotId,members:[{username,nickname}]}`。成功快照包含发送者和当前完整群名单；读取失败返回 `ok:false`，不要伪造成功空名单。应给接口设置超时与并发限制。 |
| 回执发送 | 由聊天工具发送 `reply`，处理发送失败、投递对账和发送层限流。游戏写入已成功后，发送失败不能直接用新消息 ID 重做操作。 |
| 账本目录 | `rootDir` 指向私有、可写、持久的目录，并安排 SQLite 一致性备份；不要把生产数据写进公开仓库。 |
| 账号命名空间 | 显式传稳定且彼此不同的 `accountNamespace`，例如平台标识加机器人账号 ID。模块兼容旧接入的默认值 `wechat:default`，跨平台接入不应沿用。 |

README 的[接线模板](../README.md#agent-如何接入)同时提供群 ID 映射、成员接口异常处理和机器人提及替换。

## 可以沿用的默认值

| 参数 | 默认值 | 何时需要改 |
| --- | --- | --- |
| `config.rankingPeriod` | `month`，按北京时间自然月结算 | 需要周榜时设为 `week`。 |
| `config.allGroups` | `false`，只处理 `config.groups` 中的群 | 宿主确认可信群来源并希望新群自动开启时设为 `true`；不要把未经验证的伪造群消息交给市场。 |
| `config.noReset` | `true`，结算后保留累计资产与关系 | 需要结算清零时设为 `false`。 |
| `config.adminUsers`、`config.protectedUsers` | 空数组 | 需要管理员重置权限或保护特定用户时填写稳定用户 ID。 |
| `config.maxPlayersPerGroup` | 500 | 群规模超出默认容量时调整。 |
| `config.maxAcceptedWritesPer10Min` | 每群每 10 分钟 3000 次已接受写操作 | 业务量超过默认阈值时调整。 |
| `config.spamCooldownSec` | 10 秒 | 当前模块只校验此配置，**不会自动执行发送节流**；接入层按需要实现。 |
| `config.groupReplyBudgetPerMinute`、`config.globalReplyBudgetPerMinute` | 每群每分钟 20 条、全局每分钟 100 条 | 当前模块只校验这两个配置，**不会自动执行回复预算**；接入层负责限流。 |
| 存储队列 `maxPending`、`reservedExitSlots`、`timeoutMs` | 256、8、5 秒 | 经过负载验证后再调整。 |
| SQLite CLI `sqliteBin` | `/usr/bin/sqlite3` | macOS 可沿用；Linux 等系统须传实际安装路径。 |
| 内置成员服务 | `DATASVC_BIN=datasvc`、`DATASVC_HOME=./data/db-service`；并发 4、等待 64、超时 3 秒、缓存 10 秒 | 仅使用随宿主提供的 `datasvc` 时沿用。其他聊天工具注入自己的成员服务，并自行设定超时、缓存与限流。 |

`createGameMarket` 还支持注入 `store`、`now` 和 `random`，主要用于集成或测试；一般接入不需要修改。没有可用的 `sqlite3` CLI、可信成员来源或回执发送通道时，不能只靠默认值完成接入。

`handle` 所需的可信字段是 `chatWxid`、`senderUsername`、写操作的 `localId`、`timestampSec` 与 `receivedAtMs`。这些是现有模块的内部字段名，不限定聊天工具；群 ID 需要稳定映射为 `...@chatroom`，发送者 ID 和消息 ID 必须来自入站平台，不得用昵称、时间戳或 LLM 猜测。成员快照返回 `{ok, snapshotId, members:[{username,nickname}]}`，其中 `snapshotId` 应能区分两次独立成功读取。README 的接线模板给出了群 ID 的哈希映射方法。

涉及他人的指令和排行需要完整成员快照。帮助、版本及本人状态等查询不应因成员接口短暂失败而阻塞。内置 `createMemberProvider` 通过 `datasvc members <groupId> --json` 获取快照；可设置 `DATASVC_BIN`、`DATASVC_HOME`。其他聊天工具通常应注入自己的 `memberProvider`，由其可信成员接口获取快照。生产服务应校验成员来源的身份和可用性。

`result.consumed=false` 表示文本不是市场指令。其余结果包含 `status`、`code`、`reply`；`status=unknown` 表示存储结果不确定，接入方不得换新消息 ID 盲目重试。`reply` 是待发送文本，不代表已投递。关闭服务时调用 `market.close()`。

账本按群拆分到 `data/game-market/*.sqlite`，含个人 ID、资产、关系、流水和幂等键。运行根、数据库与备份应使用私有权限，不进入公开仓库。升级前应使用 SQLite 一致性备份；未知 schema 或不匹配的规则指纹会拒绝加载。1.4.1 清理旧流水时保留 `processed_requests`，避免旧消息再次记账。
