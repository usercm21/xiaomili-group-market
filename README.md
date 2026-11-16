# 小米粒群友市场

一个适合接入微信群机器人的轻量级文字市场游戏。群友通过 `@小米粒 #命令` 打工、训练、招募、夺取、决斗和排位；资产、关系、任务与月榜保存在每群独立的 SQLite 账本中。

当前公开版本为 **1.4.1**。默认按北京时间自然月结算，**资产不清零**：虚拟币、身价、银行本金和群友关系持续保留，月积分重新开始。1.4.1 在升级时一次性清空旧操作流水，新操作继续记录。虚拟币仅用于游戏，没有现金价值。

这个仓库只包含**市场游戏模块**，不包含生产微信网关、聊天记录、账号配置、凭据或运行数据。它提供命令解析、规则引擎、成员快照适配、SQLite 存储和可独立运行的测试。接入者需要自行提供可信的入站消息、群成员来源及发送回执的通道。

## 快速开始

要求 Node.js 18+、`sqlite3` 命令行工具；现有测试默认使用 macOS 的 `/usr/bin/sqlite3`。在其他系统上可向 `createGameMarketStore` 注入 `sqliteBin`。

```bash
npm test
```

模块不依赖第三方 npm 包。运行时默认把每个群的账本写到 `rootDir/data/game-market/`。这个目录应仅对服务账号开放，并且不应提交到 Git。

```js
const { createGameMarket } = require('./lib/game-market');

async function main() {
const market = createGameMarket({
  rootDir: '/private/runtime/root',
  memberProvider: {
    async getSnapshot(groupId) {
      // 从可信的微信成员接口读取当前群成员；不要从模型推断。
      return {
        ok: true,
        groupId,
        snapshotId: 'unique-snapshot-id',
        members: [{ username: 'wxid_member', nickname: '群友' }],
      };
    },
  },
});

const result = await market.handle({
  text: '@小米粒 #市场状态',
  agentName: '小米粒',
  chatWxid: 'example@chatroom',
  senderUsername: 'wxid_member',
  senderName: '群友',
  localId: 'trusted-inbound-message-id',
  timestampSec: Math.floor(Date.now() / 1000),
  receivedAtMs: Date.now(),
  config: {
    enabled: true,
    groups: ['example@chatroom'],
    rankingPeriod: 'month',
    noReset: true,
  },
});

if (result.consumed && result.reply) {
  // 由接入方完成发送、限速和失败对账。
  console.log(result.reply);
}
await market.close();
}

main().catch(console.error);
```

生产接入建议见 [接入与数据契约](docs/integration.md)。不要把示例中的成员快照用于真实群；真实操作需要由可信平台接口给出群 ID、发送者微信 ID、消息 ID 和时间戳。

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

群友默认参与，也可发送 `@小米粒 #退出市场`；重入使用 `#加入市场`。无目标或重名时，机器人会给出临时编号；裸 `#夺取` 会在可操作对象中随机选择。完整指令见 [玩法与指令](docs/commands.md)。

## 规则与可靠性

- 打工冷却 1 小时，每日最多 5 次；决斗冷却 3 分钟，每日最多 10 次。
- 月榜把累计资产和当月积分分开显示；默认月结不清零资产。
- 每日任务、永久成就和每周群体事件与经济操作在同一账本事务内更新。
- 入站写操作由可信消息 ID 幂等去重；并发写入采用提交序号校验，冲突后重读重算。
- 对退出、失效成员、目标保护、每日次数、余额与管理员权限执行失败关闭检查。
- 个人操作流水只显示本人最近 10 条。1.4.1 升级会清空升级前流水，保留防重复消息的内部幂等记录。

技术结构、异常处理及数据边界见 [架构说明](docs/architecture.md)。测试覆盖规则、版本迁移、历史清理、并发、成员快照和命令解析。

## 贡献与后续更新

欢迎通过 Issue 或 Pull Request 提交可复现的问题与改进。请阅读 [贡献指南](CONTRIBUTING.md) 与 [agent 指引](AGENTS.md)。公开仓库与生产私有仓库采用**不同 Git 历史**；后续更新先在私有项目验证，再通过白名单同步脚本生成可审计的公开变更，完成检查后用普通 Git 推送。此流程不需要将 GitHub 账号连接到 ChatGPT。

本项目采用 [MIT 许可证](LICENSE)。微信客户端、第三方数据服务及其使用条款不属于本仓库；请自行确认所处环境的合规要求。
