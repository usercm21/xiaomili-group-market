'use strict';

const assert = require('assert');
const { createMemberProvider } = require('../lib/game-market/member-provider');

function snapshotExec(payload) {
  return (_bin, _args, _options, callback) => callback(null, JSON.stringify(payload), '');
}

async function testCacheSingleflightAndConcurrency() {
  let clock = 1000; let calls = 0; let active = 0; let maxActive = 0;
  const execFile = (_bin, args, _options, callback) => {
    calls += 1; active += 1; maxActive = Math.max(maxActive, active);
    setTimeout(() => {
      active -= 1;
      if (args[1].startsWith('fail')) callback(Object.assign(new Error('failed'), { code: 1 }), '', 'bad');
      else callback(null, JSON.stringify({ members: [{ username: `wxid_${args[1]}`, group_nickname: '昵称' }] }), '');
    }, 10);
  };
  const provider = createMemberProvider({ execFile, now: () => clock, ttlMs: 10_000, maxConcurrent: 1 });
  const [a, b] = await Promise.all([provider.getSnapshot('room_a@chatroom'), provider.getSnapshot('room_a@chatroom')]);
  assert.strictEqual(calls, 1, '同群并发必须 singleflight');
  assert.strictEqual(a.snapshotId, b.snapshotId);
  await provider.getSnapshot('room_a@chatroom');
  assert.strictEqual(calls, 1, 'TTL 内必须复用成功快照');
  clock += 10_001;
  await Promise.all([provider.getSnapshot('room_b@chatroom'), provider.getSnapshot('room_c@chatroom')]);
  assert.strictEqual(maxActive, 1, '全局刷新并发必须受限');
  const failed = await provider.getSnapshot('fail_1@chatroom');
  assert.strictEqual(failed.ok, false);
  assert.deepStrictEqual(failed.members, []);
  const failedAgain = await provider.getSnapshot('fail_1@chatroom');
  assert.strictEqual(failedAgain.ok, false, '失败不得回退旧名单或缓存为成功');
}

async function testSupportedResponseShapesAndIdentityFiltering() {
  const fixtures = [
    [{ username: 'wxid_array', group_nickname: '数组成员' }],
    { members: [{ username: 'wxid_members', contact_display: '成员字段' }] },
    { results: [{ username: 'wxid_results', display: '结果字段' }] },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    const provider = createMemberProvider({ execFile: snapshotExec(fixture), now: () => 2000 + index });
    const result = await provider.getSnapshot(`shape_${index}@chatroom`);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.members.length, 1);
    assert.ok(result.members[0].username.startsWith('wxid_'));
  }

  for (const [label, fixture, expectedError] of [
    ['empty', [], 'members_empty_result'],
    ['reported', { ok: false, members: [{ username: 'wxid_hidden' }] }, 'members_reported_failure'],
    ['invalid', [{ username: '' }, { username: 'bad\nidentity' }, null], 'members_no_valid_identity'],
  ]) {
    const provider = createMemberProvider({ execFile: snapshotExec(fixture) });
    const result = await provider.getSnapshot(`${label}@chatroom`);
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, expectedError);
    assert.deepStrictEqual(result.members, []);
  }

  const invalidGroup = await createMemberProvider({ execFile: snapshotExec(fixtures[0]) }).getSnapshot('../bad@chatroom');
  assert.deepStrictEqual(invalidGroup, { ok: false, error: 'invalid_group_id', members: [] });
}

async function testBoundedQueueAndSameGroupSingleflight() {
  const pending = [];
  let calls = 0;
  const logs = [];
  const execFile = (_bin, args, _options, callback) => {
    calls += 1;
    pending.push({ groupId: args[1], callback });
  };
  const provider = createMemberProvider({
    execFile,
    maxConcurrent: 1,
    maxQueued: 1,
    log: (level, message) => logs.push({ level, message }),
  });

  const first = provider.getSnapshot('queue_a@chatroom');
  const sameGroup = provider.getSnapshot('queue_a@chatroom');
  const queued = provider.getSnapshot('queue_b@chatroom');
  await Promise.resolve();
  assert.deepStrictEqual(provider.diagnostics(), {
    active: 1,
    queued: 1,
    maxConcurrent: 1,
    maxQueued: 1,
    cachedGroups: 0,
    inFlightGroups: 2,
  });

  const busy = await provider.getSnapshot('queue_c@chatroom');
  assert.strictEqual(busy.ok, false);
  assert.strictEqual(busy.error, 'members_provider_busy');
  assert.strictEqual(calls, 1, '队列已满时不得启动额外子进程');
  assert.ok(logs.some((entry) => entry.level === 'warn' && entry.message.includes('members_provider_busy')));

  pending.shift().callback(null, JSON.stringify([{ username: 'wxid_a' }]), '');
  const [firstResult, sameResult] = await Promise.all([first, sameGroup]);
  assert.strictEqual(firstResult.ok, true);
  assert.strictEqual(firstResult.snapshotId, sameResult.snapshotId, '同群排队压力下仍必须 singleflight');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(calls, 2);
  pending.shift().callback(null, JSON.stringify({ results: [{ username: 'wxid_b' }] }), '');
  assert.strictEqual((await queued).ok, true);
  assert.strictEqual(provider.diagnostics().queued, 0);
}

function testQueueConfigurationValidation() {
  assert.throws(() => createMemberProvider({ maxConcurrent: 0 }), /invalid_members_max_concurrent/);
  assert.throws(() => createMemberProvider({ maxQueued: -1 }), /invalid_members_max_queued/);
}

async function main() {
  await testCacheSingleflightAndConcurrency();
  await testSupportedResponseShapesAndIdentityFiltering();
  await testBoundedQueueAndSameGroupSingleflight();
  testQueueConfigurationValidation();
  console.log('game market member provider tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
