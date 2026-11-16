'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { createGameMarket, parseCandidate, validateConfig } = require('../lib/game-market');
const { createGameMarketStore, safeChatKey } = require('../lib/game-market/store');
const { RULESET_HASH } = require('../lib/game-market/version');

const sqliteBin = '/usr/bin/sqlite3';
const start = Date.parse('2026-11-13T06:00:00.000Z');
const chatId = 'room_140@chatroom';
const config = {
  enabled: true,
  groups: [chatId],
  maxAcceptedWritesPer10Min: 1000,
  groupReplyBudgetPerMinute: 1000,
  globalReplyBudgetPerMinute: 1000,
};

function dbPath(root) {
  return path.join(root, 'data', 'game-market', `${safeChatKey(chatId)}.sqlite`);
}

function sql(db, statement, json = false) {
  const args = json ? ['-json', db, statement] : [db, statement];
  const output = execFileSync(sqliteBin, args, { encoding: 'utf8' });
  return json && output.trim() ? JSON.parse(output) : output;
}

function input(text, localId, senderId = 'wxid_a', at = start, extra = {}) {
  return {
    text,
    agentName: '小米粒',
    accountNamespace: 'wechat:test-140',
    chatWxid: chatId,
    senderUsername: senderId,
    senderName: senderId,
    localId,
    timestampSec: at / 1000,
    receivedAtMs: at,
    config,
    ...extra,
  };
}

async function withRoot(name, callback) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `${name}-`));
  try { await callback(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

async function testCommandsAndDefaultNoReset() {
  assert.strictEqual(validateConfig({}).noReset, true);
  const commands = {
    市场版本: 'market-version',
    市场记录: 'market-records',
    市场任务: 'market-tasks',
    市场成就: 'market-achievements',
    市场荣誉: 'market-honors',
    市场事件: 'market-event',
  };
  for (const [text, command] of Object.entries(commands)) {
    const parsed = parseCandidate({ text: `@小米粒 #${text}` });
    assert.strictEqual(parsed.command, command);
    assert.strictEqual(parsed.readOnly, true);
    assert.strictEqual(parsed.isWrite, false);
  }
}

async function testSchemaOneMigrationAndBackup() {
  await withRoot('market-140-migration', async (root) => {
    let market = createGameMarket({ rootDir: root, now: () => start });
    await market.handle(input('@小米粒 #加入市场', 'seed-v2'));
    await market.close();

    const db = dbPath(root);
    sql(db, "UPDATE meta SET value_json='1' WHERE key='schemaVersion'; UPDATE meta SET value_json='false' WHERE key='noReset'; DELETE FROM meta WHERE key IN ('marketVersion','historyResetVersion'); INSERT INTO recent_operations(player_id,result_json,created_at) VALUES('wxid_a','{\"ok\":true,\"code\":\"legacy\",\"command\":\"work\"}',1);");
    market = createGameMarket({ rootDir: root, now: () => start + 1000 });
    const projected = await market.handle(input('@小米粒 #市场状态', null, 'wxid_a', start + 1000));
    assert.match(projected.reply, /不清零/, '旧账本尚未写入迁移时，只读状态仍应按当前配置展示');
    assert.doesNotMatch(projected.reply, /legacy/, '旧版本流水不得出现在状态中');
    const oldHistory = await market.handle(input('@小米粒 #市场记录', null, 'wxid_a', start + 1000));
    assert.match(oldHistory.reply, /暂无成功操作记录/, '迁移前只读查询应隐藏旧流水');
    assert.strictEqual(Number(sql(db, "SELECT value_json FROM meta WHERE key='schemaVersion';", true)[0].value_json), 1, '只读状态不得触发持久迁移');
    assert.strictEqual(Number(sql(db, 'SELECT COUNT(*) AS count FROM recent_operations;', true)[0].count), 1, '只读查询不得清理数据库');
    const result = await market.handle(input('@小米粒 #加入市场', 'migrate-v1', 'wxid_b', start + 1000));
    assert.strictEqual(result.ok, true);
    const migrated = await market.inspect(chatId, config);
    assert.strictEqual(migrated.players.find((player) => player.id === 'wxid_a').coins, 0, '清历史不得修改原玩家资产');
    await market.close();

    const schema = sql(db, "SELECT value_json FROM meta WHERE key='schemaVersion';", true);
    assert.strictEqual(Number(schema[0].value_json), 2);
    assert.strictEqual(Number(sql(db, 'SELECT COUNT(*) AS count FROM recent_operations;', true)[0].count), 0, '首次迁移应清空旧流水，保留玩家资产');
    assert.ok(Number(sql(db, 'SELECT COUNT(*) AS count FROM processed_requests;', true)[0].count) >= 2, '清历史不得删除幂等去重记录');
    const backups = fs.readdirSync(path.dirname(db)).filter((name) => name.startsWith(`${path.basename(db)}.backup-`) && name.endsWith('.sqlite'));
    assert.ok(backups.length >= 1, 'schema 1 首次写入前必须生成一致性备份');
    const backupSchema = sql(path.join(path.dirname(db), backups[0]), "SELECT value_json FROM meta WHERE key='schemaVersion';", true);
    assert.strictEqual(Number(backupSchema[0].value_json), 1, '迁移备份必须保留 schema 1');
  });
}

async function testSchemaTwoHistoryResetOnce() {
  await withRoot('market-141-history', async (root) => {
    const market = createGameMarket({ rootDir: root, now: () => start });
    try {
      await market.handle(input('@小米粒 #加入市场', 'seed-141'));
      const db = dbPath(root);
      sql(db, "DELETE FROM meta WHERE key='historyResetVersion'; INSERT INTO recent_operations(player_id,result_json,created_at) VALUES('wxid_a','{\"ok\":true,\"code\":\"old\",\"command\":\"work\"}',1);");
      const before = await market.handle(input('@小米粒 #市场记录', null));
      assert.match(before.reply, /暂无成功操作记录/);
      assert.strictEqual(Number(sql(db, 'SELECT COUNT(*) AS count FROM recent_operations;', true)[0].count), 1);
      await market.handle(input('@小米粒 #加入市场', 'reset-141', 'wxid_b', start + 1000));
      assert.strictEqual(Number(sql(db, 'SELECT COUNT(*) AS count FROM recent_operations;', true)[0].count), 0);
      assert.strictEqual(JSON.parse(sql(db, "SELECT value_json FROM meta WHERE key='historyResetVersion';", true)[0].value_json), '1.4.1');
      const work = await market.handle(input('@小米粒 #打工', 'new-work-141', 'wxid_a', start + 2000, { memberSnapshot: { ok: true, snapshotId: 'new-141', members: [{ username: 'wxid_a', nickname: 'A' }, { username: 'wxid_b', nickname: 'B' }] } }));
      assert.strictEqual(work.ok, true);
      const after = await market.handle(input('@小米粒 #市场记录', null, 'wxid_a', start + 3000));
      assert.match(after.reply, /work/);
      assert.doesNotMatch(after.reply, /old/);
      assert.strictEqual(Number(sql(db, 'SELECT COUNT(*) AS count FROM recent_operations;', true)[0].count), 1, '新版本流水应在一次清理后正常保留');
    } finally { await market.close(); }
  });
}

async function testSchemaTwoRulesetMigrationAndBackup() {
  await withRoot('market-142-ruleset', async (root) => {
    const market = createGameMarket({ rootDir: root, now: () => start });
    try {
      const members = { ok: true, snapshotId: 'old-rules', members: [{ username: 'wxid_a', nickname: 'A' }] };
      assert.strictEqual((await market.handle(input('@小米粒 #打工', 'seed-work', 'wxid_a', start, { memberSnapshot: members }))).ok, true);
      const db = dbPath(root);
      const oldHash = '9165e2876a7efc90a51248a9dcd07ee4d1f43652d10ac2d8aec727bdc6d90425';
      sql(db, `UPDATE meta SET value_json='"1.4.0"' WHERE key='rulesetVersion'; UPDATE meta SET value_json='"${oldHash}"' WHERE key='rulesetHash'; UPDATE players SET data_json=json_set(data_json,'$.workDailyCount',4) WHERE player_id='wxid_a';`);
      const historyBefore = Number(sql(db, 'SELECT COUNT(*) AS count FROM recent_operations;', true)[0].count);
      const projected = await market.handle(input('@小米粒 #市场状态', null, 'wxid_a', start + 100));
      assert.match(projected.reply, /打工 4\/3/, '只读显示真实旧次数与新上限');
      assert.strictEqual(JSON.parse(sql(db, "SELECT value_json FROM meta WHERE key='rulesetVersion';", true)[0].value_json), '1.4.0', '只读不得持久迁移');

      const rejected = await market.handle(input('@小米粒 #打工', 'limit-142', 'wxid_a', start + 1000, { memberSnapshot: members }));
      assert.strictEqual(rejected.code, 'work_daily_limit');
      assert.match(rejected.reply, /今日已打工 4 次，上限 3 次/);
      assert.strictEqual(JSON.parse(sql(db, "SELECT value_json FROM meta WHERE key='rulesetVersion';", true)[0].value_json), '1.4.2');
      assert.strictEqual(JSON.parse(sql(db, "SELECT value_json FROM meta WHERE key='rulesetHash';", true)[0].value_json), RULESET_HASH);
      assert.strictEqual(JSON.parse(sql(db, "SELECT value_json FROM meta WHERE key='historyResetVersion';", true)[0].value_json), '1.4.1', '规则迁移不得重新清历史');
      assert.strictEqual(Number(sql(db, 'SELECT COUNT(*) AS count FROM recent_operations;', true)[0].count), historyBefore, '规则迁移保留既有流水');
      const backups = fs.readdirSync(path.dirname(db)).filter((name) => name.startsWith(`${path.basename(db)}.backup-`) && name.endsWith('.sqlite'));
      assert.ok(backups.length >= 1, '首次被拒的写操作迁移规则前也须备份');
      const backup = path.join(path.dirname(db), backups[0]);
      assert.strictEqual(JSON.parse(sql(backup, "SELECT value_json FROM meta WHERE key='rulesetHash';", true)[0].value_json), oldHash);
      const state = await market.inspect(chatId, config);
      assert.strictEqual(state.players.find((player) => player.id === 'wxid_a').workDailyCount, 4);
      assert.strictEqual(state.meta.rulesetMigration.fromVersion, '1.4.0');

      sql(db, "UPDATE meta SET value_json='\"bad-hash\"' WHERE key='rulesetHash';");
      assert.strictEqual((await market.handle(input('@小米粒 #市场状态', null, 'wxid_a', start + 2000))).code, 'unsupported_market_ruleset');
      sql(db, "DELETE FROM meta WHERE key='rulesetHash';");
      assert.strictEqual((await market.handle(input('@小米粒 #市场状态', null, 'wxid_a', start + 3000))).code, 'unsupported_market_ruleset', '缺少指纹不得继承空状态默认值');
    } finally { await market.close(); }
  });
}

async function testFutureSchemaReadAndWriteRejected() {
  await withRoot('market-140-future', async (root) => {
    let market = createGameMarket({ rootDir: root, now: () => start });
    await market.handle(input('@小米粒 #加入市场', 'seed-future'));
    await market.close();
    const db = dbPath(root);
    sql(db, "UPDATE meta SET value_json='999' WHERE key='schemaVersion';");

    market = createGameMarket({ rootDir: root, now: () => start + 1000 });
    const version = await market.handle(input('@小米粒 #市场版本', null, 'wxid_a', start + 1000));
    assert.strictEqual(version.ok, true, '市场版本不应依赖账本可读性');
    const read = await market.handle(input('@小米粒 #市场状态', null, 'wxid_a', start + 1001));
    assert.strictEqual(read.code, 'unsupported_market_schema');
    assert.match(read.reply, /账本版本高于当前程序/);
    const write = await market.handle(input('@小米粒 #加入市场', 'future-write', 'wxid_b', start + 1002));
    assert.strictEqual(write.code, 'unsupported_market_schema');
    const schema = sql(db, "SELECT value_json FROM meta WHERE key='schemaVersion';", true);
    assert.strictEqual(Number(schema[0].value_json), 999);
    await market.close();
  });
}

async function testConcurrentStoresDoNotLoseCommit() {
  await withRoot('market-140-concurrent', async (root) => {
    const marketA = createGameMarket({ rootDir: root, now: () => start });
    const marketB = createGameMarket({ rootDir: root, now: () => start });
    try {
      const [a, b] = await Promise.all([
        marketA.handle(input('@小米粒 #加入市场', 'concurrent-a', 'wxid_a')),
        marketB.handle(input('@小米粒 #加入市场', 'concurrent-b', 'wxid_b')),
      ]);
      assert.strictEqual(a.ok, true);
      assert.strictEqual(b.ok, true);
      const duplicated = input('@小米粒 #加入市场', 'concurrent-same-message', 'wxid_c', start + 1);
      const [sameA, sameB] = await Promise.all([marketA.handle(duplicated), marketB.handle(duplicated)]);
      assert.strictEqual(sameA.ok, true);
      assert.strictEqual(sameB.ok, true);
      assert.ok(sameA.status === 'replay' || sameB.status === 'replay', '并发重复消息必须命中幂等结果');
      const state = await marketA.inspect(chatId, config);
      assert.deepStrictEqual(state.players.map((player) => player.id).sort(), ['wxid_a', 'wxid_b', 'wxid_c']);
      assert.strictEqual(state.meta.commitSequence, 3);
    } finally {
      await Promise.all([marketA.close(), marketB.close()]);
    }
  });
}

async function testHistoryIsPrivateBoundedAndDeletedOnExit() {
  await withRoot('market-140-history', async (root) => {
    const market = createGameMarket({ rootDir: root, now: () => start });
    try {
      await market.handle(input('@小米粒 #加入市场', 'history-seed'));
      const db = dbPath(root);
      for (let index = 0; index < 25; index += 1) {
        const value = JSON.stringify({ ok: true, code: `a-${index}`, command: 'work', createdAt: start + index, marketWrite: true });
        sql(db, `INSERT INTO recent_operations(player_id,result_json,created_at) VALUES('wxid_a',CAST(X'${Buffer.from(value).toString('hex')}' AS TEXT),${start + index});`);
      }
      for (let index = 0; index < 5; index += 1) {
        const value = JSON.stringify({ ok: true, code: `private-b-${index}`, command: 'work', createdAt: start + index, marketWrite: true });
        sql(db, `INSERT INTO recent_operations(player_id,result_json,created_at) VALUES('wxid_b',CAST(X'${Buffer.from(value).toString('hex')}' AS TEXT),${start + index});`);
      }

      const records = await market.handle(input('@小米粒 #市场记录', null, 'wxid_a', start + 100));
      assert.strictEqual(records.ok, true);
      assert.match(records.reply, /a-24/);
      assert.doesNotMatch(records.reply, /a-14/);
      assert.doesNotMatch(records.reply, /private-b/);

      const memberSnapshot = { ok: true, snapshotId: 'history-snapshot', members: [{ username: 'wxid_a', nickname: 'A' }] };
      const work = await market.handle(input('@小米粒 #打工', 'history-prune', 'wxid_a', start + 200, { memberSnapshot }));
      assert.strictEqual(work.ok, true);
      const progressed = await market.inspect(chatId, config);
      assert.ok(progressed.season?.id && progressed.weekEvent?.id, '赛季和周事件应与经济变更同事务持久化');
      assert.ok(progressed.players.find((player) => player.id === 'wxid_a').seasonPoints >= 1);
      const counts = sql(db, 'SELECT player_id,COUNT(*) AS count FROM recent_operations GROUP BY player_id ORDER BY player_id;', true);
      assert.deepStrictEqual(counts.map((row) => [row.player_id, Number(row.count)]), [['wxid_a', 20], ['wxid_b', 5]]);

      const exited = await market.handle(input('@小米粒 #退出市场', 'history-exit', 'wxid_a', start + 300));
      assert.strictEqual(exited.ok, true);
      const afterExit = sql(db, 'SELECT player_id,COUNT(*) AS count FROM recent_operations GROUP BY player_id ORDER BY player_id;', true);
      assert.deepStrictEqual(afterExit.map((row) => [row.player_id, Number(row.count)]), [['wxid_b', 5]]);
    } finally {
      await market.close();
    }
  });
}

async function testQueuedDeadlineAndExitReserve() {
  await withRoot('market-140-deadline', async (root) => {
    const slowSqlite = path.join(root, 'slow-sqlite.sh');
    fs.writeFileSync(slowSqlite, '#!/bin/sh\nsleep 0.15\nexec /usr/bin/sqlite3 "$@"\n', { mode: 0o700 });
    const store = createGameMarketStore({ rootDir: root, sqliteBin: slowSqlite, timeoutMs: 75, maxPending: 1, reservedExitSlots: 1 });
    const basePayload = { now: start, config: validateConfig(config) };
    const first = store.request({ chatId, type: 'inspect', payload: basePayload });
    const ordinary = store.request({ chatId, type: 'execute', payload: { ...basePayload, command: 'join' } });
    const exit = store.request({ chatId, type: 'execute', payload: { ...basePayload, command: 'exit' } });
    const [, ordinaryResult, exitResult] = await Promise.allSettled([first, ordinary, exit]);
    assert.strictEqual(ordinaryResult.status, 'rejected');
    assert.strictEqual(ordinaryResult.reason.message, 'store_queue_full');
    assert.strictEqual(exitResult.status, 'rejected');
    assert.notStrictEqual(exitResult.reason.message, 'store_queue_full', '退出指令必须拥有保留队列容量');
    await new Promise((resolve) => setTimeout(resolve, 700));
    await store.close();

    const verifier = createGameMarketStore({ rootDir: root });
    try {
      const state = await verifier.request({ chatId, type: 'inspect', payload: basePayload });
      assert.strictEqual(state.players.length, 0, '排队期间已超时的请求不得开始执行');
    } finally {
      await verifier.close();
    }
  });
}

async function main() {
  await testCommandsAndDefaultNoReset();
  await testSchemaOneMigrationAndBackup();
  await testSchemaTwoHistoryResetOnce();
  await testSchemaTwoRulesetMigrationAndBackup();
  await testFutureSchemaReadAndWriteRejected();
  await testConcurrentStoresDoNotLoseCommit();
  await testHistoryIsPrivateBoundedAndDeletedOnExit();
  await testQueuedDeadlineAndExitReserve();
  console.log('game market 1.4 store tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
