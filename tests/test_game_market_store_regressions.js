'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createGameMarket } = require('../lib/game-market');

const start = Date.parse('2026-11-12T04:00:00.000Z');
const baseConfig = {
  enabled: true,
  groups: ['room_1@chatroom'],
  adminUsers: [],
  protectedUsers: [],
  maxPlayersPerGroup: 500,
  maxAcceptedWritesPer10Min: 10,
  spamCooldownSec: 10,
  groupReplyBudgetPerMinute: 100,
  globalReplyBudgetPerMinute: 100,
  rankingPeriod: 'month',
  noReset: false,
};
const memberSnapshot = {
  ok: true,
  snapshotId: 'snapshot-1',
  members: [
    { username: 'wxid_a', nickname: 'A' },
    { username: 'wxid_b', nickname: 'B' },
  ],
};

function input(text, localId, receivedAtMs = start, extra = {}) {
  return {
    text,
    agentName: '小米粒',
    accountNamespace: 'wechat:test',
    chatWxid: 'room_1@chatroom',
    senderUsername: 'wxid_a',
    senderName: 'A',
    localId,
    timestampSec: start / 1000,
    receivedAtMs,
    config: baseConfig,
    ...extra,
  };
}

async function testDependencyTiersAndReadIds() {
  let memberCalls = 0;
  const requests = [];
  const market = createGameMarket({
    memberProvider: {
      getSnapshot: async () => {
        memberCalls += 1;
        return { ok: false, members: [], error: 'offline' };
      },
    },
    store: {
      hasState: async () => true,
      request: async request => {
        requests.push(request);
        return { ok: true, code: 'ok', reply: 'ok', mutated: false, marketWrite: false, replayed: false };
      },
      close: async () => {},
    },
    now: () => start,
  });

  const help = await market.handle(input('@小米粒 #帮助', null));
  assert.strictEqual(help.status, 'ok');
  assert.match(help.reply, /小米粒群友市场/);
  assert.strictEqual(requests.length, 0, '帮助应完全静态，不进入账本');

  await market.handle(input('@小米粒 #加入市场', 'join-1'));
  await market.handle(input('@小米粒 #银行 状态', null, start + 1_000));
  await market.handle(input('@小米粒 #市场状态', null, start + 2_000));
  assert.strictEqual(memberCalls, 0, '本人加入、银行和状态只依赖可信入站身份');
  assert.strictEqual(requests[1].payload.readOnly, true);
  assert.strictEqual(requests[2].payload.readOnly, true);
  assert.notStrictEqual(requests[1].payload.messageId, requests[2].payload.messageId, '无 localId 的读取请求应包含入站时间');

  const work = await market.handle(input('@小米粒 #打工', 'work-needs-members'));
  assert.strictEqual(work.code, 'member_snapshot_failed');
  assert.strictEqual(memberCalls, 1, '涉及关系收益的打工继续要求完整成员快照');

  const ranking = await market.handle(input('@小米粒 #排行', null, start + 3_000));
  assert.strictEqual(ranking.code, 'member_snapshot_failed');
  assert.strictEqual(memberCalls, 2, '涉及其他人的排行继续要求完整成员快照');
  await market.close();
}

async function testStoreWriteAccountingAndPureReads() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-market-store-regression-'));
  const market = createGameMarket({ rootDir: root, now: () => start });
  try {
    for (let index = 0; index < 10; index += 1) {
      const failed = await market.handle(input('@小米粒 #银行 存 1', `failed-${index}`, start + index));
      assert.strictEqual(failed.ok, false);
      assert.strictEqual(failed.code, 'insufficient_funds');
      assert.strictEqual(failed.marketWrite, false);
    }

    const work = await market.handle(input('@小米粒 #打工', 'successful-work', start + 20, { memberSnapshot }));
    assert.strictEqual(work.ok, true, '失败写不得占满成功写额度');
    assert.strictEqual(work.marketWrite, true);
    const transactionId = work.transactionId;
    const beforeReads = await market.inspect('room_1@chatroom', baseConfig);

    const statusA = await market.handle(input('@小米粒 #市场状态', null, start + 30));
    const statusB = await market.handle(input('@小米粒 #市场状态', null, start + 40));
    const bank = await market.handle(input('@小米粒 #银行 状态', null, start + 50));
    const ranking = await market.handle(input('@小米粒 #排行', null, start + 60, { memberSnapshot }));
    assert.match(statusA.reply, new RegExp(transactionId));
    assert.match(statusB.reply, new RegExp(transactionId), '重复状态查询仍应展示最近成功经济交易');
    assert.strictEqual(bank.ok, true);
    assert.strictEqual(ranking.ok, true);

    const afterReads = await market.inspect('room_1@chatroom', baseConfig);
    assert.strictEqual(afterReads.meta.commitSequence, beforeReads.meta.commitSequence, '状态、银行状态和排行不得提交账本维护');
  } finally {
    await market.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function testResetConfirmationVersionBinding() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-market-reset-version-'));
  const market = createGameMarket({ rootDir: root, now: () => start });
  const adminConfig = { ...baseConfig, adminUsers: ['wxid_a'] };
  try {
    const force = await market.handle(input('@小米粒 #市场重置 强制', 'reset-force', start, { config: adminConfig, memberSnapshot }));
    assert.strictEqual(force.ok, true);
    const token = force.reply.match(/#([a-f0-9]{8})/)[1];

    const intervening = await market.handle(input('@小米粒 #加入市场', 'join-after-reset-request', start + 1, { config: adminConfig }));
    assert.strictEqual(intervening.ok, true);
    const confirm = await market.handle(input(`@小米粒 #市场重置 确认 #${token}`, 'reset-confirm', start + 2, { config: adminConfig, memberSnapshot }));
    assert.strictEqual(confirm.code, 'reset_state_changed', '确认码必须在账本版本变化后失效');
  } finally {
    await market.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
}

async function main() {
  await testDependencyTiersAndReadIds();
  await testStoreWriteAccountingAndPureReads();
  await testResetConfirmationVersionBinding();
  console.log('game market store regression tests passed');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
