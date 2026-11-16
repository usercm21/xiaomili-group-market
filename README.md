# 小米粒群友市场

一个支持聊天机器人接入的群聊文字市场游戏。玩家通过 `@小米粒 #命令` 打工、训练、招募、夺取、决斗和排位；资产、关系、任务与月榜保存在每个群聊独立的 SQLite 账本中。

当前公开版本为 **1.4.2**。默认按北京时间自然月结算，**资产不清零**：虚拟币、身价、银行本金和群友关系持续保留，月积分重新开始。打工每日最多 3 次；已完成的旧规则打工与收益保留。1.4.1 的旧操作流水清理不会在本次升级时重复执行。虚拟币仅用于游戏，没有现金价值。

这个仓库只包含**市场游戏模块**，不包含生产机器人网关、聊天记录、账号配置、凭据或运行数据。它提供命令解析、规则引擎、成员快照适配、SQLite 存储和可独立运行的测试。接入者需要自行提供可信的入站消息、群成员来源及发送回执的通道。

**给 Agent 开发者：`@小米粒` 是本项目的示例机器人名称。**接入时把它替换成你的机器人名称，并将完全相同的名称传给 `agentName`。在聊天消息进入 LLM 前，把直接提及机器人的 `#市场指令` 交给 `market.handle()`；它返回待发送的 `reply`，由你的聊天工具发送。完整字段映射和接线模板见下方“[Agent 如何接入](#agent-如何接入)”及[接入契约](docs/integration.md)。

## Agent 如何接入

接入只需要四步：从聊天工具取得可信群 ID、发送者 ID、消息 ID 和时间戳；提供当前群成员快照；在普通 LLM 对话处理**之前**调用市场模块；把回执交还给原聊天工具发送。`result.consumed=false` 时继续原有对话流程。市场模块本身不连接聊天平台，也不负责发送消息。

下面是消息处理器的接线模板。把 `getMembers` 和 `sendText` 换成你所用聊天工具的接口，把 `botName` 设置为你的机器人名称。平台群 ID 会稳定映射到模块当前要求的 `…@chatroom` 内部格式。

```js
const crypto = require('node:crypto');
const { createGameMarket } = require('./lib/game-market');

function createMarketAdapter({ dataRoot, sqliteBin = '/usr/bin/sqlite3', platformKey, botAccountId, botName, allowedGroupIds, getMembers, sendText }) {
  if (!dataRoot || !platformKey || !botAccountId || !botName || !Array.isArray(allowedGroupIds)
    || typeof getMembers !== 'function' || typeof sendText !== 'function') {
    throw new Error('market_adapter_config_missing');
  }
  const toMarketGroupId = (groupId) =>
    `${crypto.createHash('sha256').update(JSON.stringify([platformKey, botAccountId, groupId])).digest('hex').slice(0, 32)}@chatroom`;
  const platformGroupIds = new Map(allowedGroupIds.map((id) => [toMarketGroupId(id), id]));
  const market = createGameMarket({
    rootDir: dataRoot,
    sqliteBin,
    memberProvider: {
      async getSnapshot(groupId) {
        const platformGroupId = platformGroupIds.get(groupId);
        if (!platformGroupId) return { ok: false, members: [] };
        try {
          const members = await getMembers(platformGroupId);
          if (!Array.isArray(members)) return { ok: false, members: [] };
          return {
            ok: true,
            snapshotId: crypto.randomUUID(),
            members: members.map(({ id, name }) => ({ username: id, nickname: name })),
          };
        } catch {
          return { ok: false, members: [] }; // 成员接口失败时不猜测目标
        }
      },
    },
  });

  return {
    async onMessage(message) {
      // 由平台元数据确认“群聊”和“直接提及”，不要解析引用/转发文本猜测。
      if (!message.isGroup || !message.directMention || !allowedGroupIds.includes(message.groupId)) return false;
      const groupId = toMarketGroupId(message.groupId);
      const result = await market.handle({
        text: message.text,
        agentName: botName,
        accountNamespace: `${platformKey}:${botAccountId}`,
        chatWxid: groupId, // 模块沿用的内部字段名；可接入其他聊天工具。
        senderUsername: message.senderId,
        senderName: message.senderName,
        localId: message.messageId,
        timestampSec: message.timestampSec,
        receivedAtMs: Date.now(),
        config: {
          enabled: true,
          groups: allowedGroupIds.map(toMarketGroupId),
          rankingPeriod: 'month',
          noReset: true,
        },
      });
      if (!result.consumed) return false; // 交还给原 Agent/LLM 对话流程
      if (result.reply) {
        // 只替换指令中展示的机器人提及，保留“小米粒群友市场”品牌。
        const reply = result.reply.replaceAll('@小米粒', `@${botName}`);
        await sendText(message.groupId, reply);
      }
      return true;
    },
    close: () => market.close(),
  };
}
```

入站 `message.text` 应是以 `@你的机器人名 #命令` 开头的文本，名称须与 `botName` 一致。如果平台使用特殊提及标记，先验证它是对本机器人的**直接提及**，再由适配层规范化文本；不要把引用或转发里的提及当成直接命令。成员接口应返回包含发送者的完整当前群名单，成员 ID 与 `message.senderId` 要一致。写操作必须有平台提供的稳定 `messageId`，重投时保持原值；时间戳必须是平台消息发生时间。`status=unknown` 表示写入结果不确定，不要换新消息 ID 重试。`sendText` 失败也不代表游戏操作失败，聊天工具需独立做投递对账。服务退出时调用 `close()`。

`agentName` 负责识别指令中的机器人提及；接线模板在发送前仅替换回执里的 `@小米粒` 示例提及。**“小米粒群友市场”始终是游戏品牌名，不需要更改。**

### 哪些需要自己配置

| 项目 | 接入方要做什么 |
| --- | --- |
| 机器人名称 `botName` / `agentName` | 填实际机器人名称；平台提及文本需规范化为 `@该名称 #命令`。 |
| 群聊白名单 `allowedGroupIds` | 填允许使用市场的群；模板将平台群 ID 稳定映射为内部 `…@chatroom`。模块也支持显式 `allGroups=true`，用于宿主已验证全部入站群来源且需要新群自动开启的场景。 |
| 入站身份与时间 | 从平台提供稳定的 `groupId`、`senderId`、写操作的 `messageId`、`timestampSec`；不能用昵称、当前时间或 LLM 猜测消息 ID。 |
| 群成员与发送接口 | 实现 `getMembers` 和 `sendText`；成员 ID 必须与入站 `senderId` 同一命名空间。 |
| 账本位置 `dataRoot` | 指向私有、可写、可备份的持久目录，不使用公开仓库目录保存生产数据。 |
| 平台与机器人账号命名空间 | `platformKey`、`botAccountId` 应稳定且相互区分，避免群账本或消息 ID 跨平台、跨账号冲突。 |
| SQLite 程序 | macOS 默认 `/usr/bin/sqlite3`；其他系统通过 `sqliteBin` 指向安装位置。 |

**可用默认值：**仅在列出的群启用 `allGroups=false`、月榜 `rankingPeriod='month'`、资产不清零 `noReset=true`、最多 500 名活跃玩家、每群 10 分钟最多 3000 条已接受写操作。`adminUsers` 和 `protectedUsers` 默认为空；需要管理员重置或保护对象时再填写。默认存储队列 256、额外保留退出槽 8、超时 5 秒。若使用内置成员服务，其并发上限 4、等待队列 64、超时 3 秒、缓存 10 秒；注入自己的 `getMembers` 时需自行保证超时与限流。发送限速与投递对账由聊天工具负责，模块配置中的回复预算不会代替发送层限流。完整默认值见[接入与数据契约](docs/integration.md)。

## 快速开始

要求 Node.js 18+、`sqlite3` 命令行工具；现有测试默认使用 macOS 的 `/usr/bin/sqlite3`。在其他系统上可向 `createGameMarket` 注入 `sqliteBin`。

```bash
npm test
```

模块不依赖第三方 npm 包。运行时默认把每个群聊的账本写到 `rootDir/data/game-market/`。这个目录应仅对服务账号开放，并且不应提交到 Git。生产接入建议见[接入与数据契约](docs/integration.md)：真实操作必须使用聊天平台提供的可信身份和消息字段。

## 玩家怎么使用

所有市场指令需要直接提及机器人，并在命令前加 `#`。例如：

```text
@小米粒 #帮助
@小米粒 #市场状态
@小米粒 #打工
@小米粒 #银行 存 50
@小米粒 #招募 群友昵称
@小米粒 #市场任务
@小米粒 #市场版本
```

以上示例中的 `@小米粒` 请换成实际机器人名称；游戏品牌仍为“小米粒群友市场”。群友默认参与，也可发送 `@机器人名称 #退出市场`；重入使用 `#加入市场`。无目标或重名时，机器人会给出临时编号；裸 `#夺取` 会在可操作对象中随机选择。完整指令见 [玩法与指令](docs/commands.md)。

## 规则与可靠性

- 打工冷却 1 小时，每日最多 3 次；决斗冷却 3 分钟，每日最多 10 次。
- 月榜把累计资产和当月积分分开显示；默认月结不清零资产。
- 每日任务、永久成就和每周群体事件与经济操作在同一账本事务内更新。
- 入站写操作由可信消息 ID 幂等去重；并发写入采用提交序号校验，冲突后重读重算。
- 对退出、失效成员、目标保护、每日次数、余额与管理员权限执行失败关闭检查。
- 个人操作流水只显示本人最近 10 条。1.4.1 升级会清空升级前流水，保留防重复消息的内部幂等记录。

技术结构、异常处理及数据边界见 [架构说明](docs/architecture.md)。测试覆盖规则、版本迁移、历史清理、并发、成员快照和命令解析。

## 贡献与后续更新

欢迎通过 Issue 或 Pull Request 提交可复现的问题与改进。请阅读 [贡献指南](CONTRIBUTING.md) 与 [agent 指引](AGENTS.md)。公开仓库与生产私有仓库采用**不同 Git 历史**；后续更新先在私有项目验证，再通过白名单同步脚本生成可审计的公开变更，完成检查后用普通 Git 推送。此流程不需要将 GitHub 账号连接到 ChatGPT。

本项目采用 [MIT 许可证](LICENSE)。聊天工具客户端、第三方数据服务及其使用条款不属于本仓库；请自行确认所处环境的合规要求。
