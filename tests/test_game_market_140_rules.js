'use strict';

const assert = require('assert');
const {
  CURRENT_SCHEMA_VERSION, HOUR, MARKET_VERSION, RULESET_HASH, emptyState, execute, initialPlayer, upgradeState, validateState,
} = require('../lib/game-market/rules');
const { recordSuccessfulAction, weekBounds } = require('../lib/game-market/progression');

const start = Date.parse('2026-11-13T04:00:00.000Z');
const config = { rankingPeriod: 'month', noReset: true, maxPlayersPerGroup: 500 };

function snapshot(ids) {
  return { ok: true, snapshotId: `s-${ids.join('-')}`, members: ids.map((id) => ({ username: id, nickname: id })) };
}
function request(command, senderId, now, extra = {}) {
  return { command, senderId, senderName: senderId, now, messageId: `${command}-${senderId}-${now}`, memberSnapshot: snapshot(['a', 'b', 'c', 'd', 'e', 'f', 'g']), ...extra };
}
function sequence(...values) {
  let index = 0;
  return () => values[Math.min(index++, values.length - 1)] ?? 0;
}

function testVersionAndMigration() {
  const state = emptyState(start);
  assert.strictEqual(state.meta.schemaVersion, 2);
  assert.strictEqual(state.meta.marketVersion, '1.4.1');
  assert.strictEqual(state.meta.noReset, true);
  assert.strictEqual(MARKET_VERSION, '1.4.1');
  assert.match(RULESET_HASH, /^[a-f0-9]{64}$/);

  const legacy = emptyState(start);
  legacy.meta.schemaVersion = 1;
  delete legacy.meta.marketVersion;
  const player = initialPlayer('a', 'A', start - 30 * 86_400_000);
  player.bankBalance = 1234;
  player.lastInterestTime = start - 30 * 86_400_000;
  delete player.seasonPoints;
  legacy.players.set('a', player);
  upgradeState(legacy, start);
  assert.strictEqual(legacy.meta.schemaVersion, CURRENT_SCHEMA_VERSION);
  assert.strictEqual(player.bankBalance, 1234, '迁移必须保留本金');
  assert.strictEqual(player.lastInterestTime, start, '迁移不得追发旧规则利息');
  assert.strictEqual(player.seasonPoints, 0);
  assert.strictEqual(validateState(legacy), true);

  const future = emptyState(start);
  future.meta.schemaVersion = 3;
  assert.throws(() => upgradeState(future, start), /unsupported_market_schema/);
  const mismatched = emptyState(start);
  mismatched.meta.rulesetHash = '0'.repeat(64);
  assert.throws(() => upgradeState(mismatched, start), /unsupported_market_ruleset/);
}

function testDeterministicEconomy() {
  const state = emptyState(start);
  let result = execute(state, request('work', 'a', start), config, () => 0);
  const a = state.players.get('a');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(a.coins, 51, '40基础+1身价加成+10首次任务');
  assert.strictEqual(a.seasonPoints, 1);
  result = execute(state, request('work', 'a', start + HOUR), config, () => 0);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(a.coins, 92, '同日任务奖励只能领取一次');
  assert.strictEqual(a.seasonPoints, 1, '同一玩法每天只加一次月积分');

  const bank = initialPlayer('b', 'B', start);
  bank.bankBalance = 40_000;
  state.players.set('b', bank);
  execute(state, request('bank-withdraw', 'b', start + 86_400_000, { amount: 1 }), config, () => 0);
  assert.strictEqual(bank.coins, 201, '一天利息200进入现金，再取出1');
  assert.strictEqual(bank.bankBalance, 39_999, '利息不得滚入本金');

  const recruitState = emptyState(start);
  const buyer = initialPlayer('a', 'A', start); buyer.coins = 100;
  recruitState.players.set('a', buyer);
  result = execute(recruitState, request('recruit', 'a', start, { targetId: 'b', targetName: 'B' }), config, () => 0);
  const target = recruitState.players.get('b');
  assert.strictEqual(result.ok, true);
  assert.strictEqual(buyer.coins, 0);
  assert.strictEqual(target.coins, 95);
  assert.strictEqual(target.value, 105);
  const nextBuyer = initialPlayer('c', 'C', start); nextBuyer.coins = 105;
  recruitState.players.set('c', nextBuyer);
  assert.strictEqual(execute(recruitState, request('recruit', 'c', start + 1, { targetId: 'b' }), config, () => 0).code, 'cooldown');
  result = execute(recruitState, request('recruit', 'c', start + HOUR, { targetId: 'b' }), config, () => 0);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(buyer.coins, 89, '转招募旧主取得85%向下取整');
  assert.strictEqual(target.coins, 105, '转招募目标取得10%向下取整');
  assert.strictEqual(target.value, 110);

  const combat = emptyState(start);
  const actor = initialPlayer('a', 'A', start); actor.coins = 100;
  const victim = initialPlayer('b', 'B', start); victim.coins = 100;
  combat.players.set('a', actor); combat.players.set('b', victim);
  result = execute(combat, request('steal', 'a', start, { targetId: 'b' }), config, () => 0);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(actor.coins, 110);
  assert.strictEqual(victim.coins, 90);
  assert.strictEqual(victim.stealShieldUntil, start + 2 * HOUR);

  actor.coins = 100;
  result = execute(combat, request('duel', 'a', start + 3 * 60_000), config, sequence(0, 0));
  assert.strictEqual(result.ok, true);
  assert.strictEqual(actor.coins, 115, '主动付10、胜返15、首次任务奖10');
  assert.strictEqual(actor.value, 102);
  assert.strictEqual(actor.rating, 1002);
  assert.strictEqual(victim.value, 100, '被动对手资产不得变化');
  assert.strictEqual(victim.rating, 1000, '被动对手竞技分不得变化');
}

function testNoResetSeasonAndHonors() {
  const state = emptyState(start);
  execute(state, request('work', 'a', start), config, () => 0);
  const before = state.players.get('a').coins;
  const december = Date.parse('2026-12-01T00:01:00.000Z');
  execute(state, request('status', 'a', december), config, () => 0);
  const player = state.players.get('a');
  assert.strictEqual(player.coins, before, '自然月结算默认保留资产');
  assert.strictEqual(player.value, 100);
  assert.strictEqual(player.seasonPoints, 0, '新月重置竞争积分');
  assert.strictEqual(state.lastPeriodRanking.seasonPoints[0].value, 1, '月榜快照应在积分重置前生成');
  assert.strictEqual(state.honors[0].awards[0].badge, '👑 月度冠军');
}

function testReadRankingFilter() {
  const state = emptyState(start);
  for (const [id, name, coins] of [['a', 'VisibleA', 10], ['b', 'HiddenBob', 999], ['c', 'VisibleC', 20]]) {
    const player = initialPlayer(id, name, start); player.coins = coins; state.players.set(id, player);
  }
  const before = JSON.stringify([...state.players.values()]);
  const result = execute(state, request('ranking', 'a', start, {
    readOnly: true,
    memberSnapshot: { ok: true, snapshotId: 'filtered', members: [{ username: 'a', nickname: 'A' }, { username: 'c', nickname: 'C' }] },
  }), config, () => 0);
  assert.doesNotMatch(result.reply, /HiddenBob/);
  assert.match(result.reply, /VisibleC/);
  assert.strictEqual(JSON.stringify([...state.players.values()]), before, '只读过滤不得写回隔离状态');
}

function testWeeklyEventRequiresThreePeople() {
  const state = emptyState(start);
  execute(state, request('market-event', 'a', start), config, () => 0);
  // A compact deterministic event fixture verifies the same production
  // participant gate without requiring twenty cooldown-spaced work calls.
  state.weekEvent.command = 'work';
  state.weekEvent.goal = 3;
  for (const id of ['a', 'b']) execute(state, request('work', id, start), config, () => 0);
  assert.strictEqual(state.weekEvent.rewarded, false);
  assert.strictEqual(state.players.get('a').cosmeticTickets, 0);
  execute(state, request('work', 'c', start), config, () => 0);
  assert.strictEqual(state.weekEvent.rewarded, true);
  assert.strictEqual(state.players.get('a').cosmeticTickets, 1);
  assert.strictEqual(state.players.get('b').cosmeticTickets, 1);
  assert.strictEqual(state.players.get('c').cosmeticTickets, 1);
}

function testAchievementMilestonesAndExitPrivacy() {
  const state = emptyState(start);
  const player = initialPlayer('a', 'A', start);
  state.players.set('a', player);
  for (let index = 0; index < 100; index += 1) {
    recordSuccessfulAction(state, player, 'work', start + index * 86_400_000);
  }
  assert.ok(player.achievements.includes('work-100'));
  assert.ok(player.achievements.includes('active-30'));
  for (let index = 0; index < 10; index += 1) {
    recordSuccessfulAction(state, player, 'train', start + (101 + index) * 86_400_000, { won: true });
    recordSuccessfulAction(state, player, 'duel', start + (101 + index) * 86_400_000, { won: true });
  }
  assert.ok(player.achievements.includes('train-10'));
  assert.ok(player.achievements.includes('duel-10'));
  state.honors.push({ seasonId: '2026-11', awards: [{ playerId: 'a', badge: '👑 月度冠军', points: 10 }] });
  const exitAt = start + 112 * 86_400_000;
  state.weekEvent = { ...weekBounds(exitAt), command: 'work', goal: 20, contributions: { a: 2 }, participantDays: { 'a:2026-11-13': 2 }, rewarded: false };
  execute(state, request('exit', 'a', exitAt), config, () => 0);
  assert.strictEqual(state.players.has('a'), false);
  assert.strictEqual(state.honors.find((season) => season.seasonId === '2026-11').awards[0].redacted, true);
  assert.strictEqual(state.weekEvent.contributions.a, undefined);
  assert.match(execute(state, request('market-achievements', 'a', exitAt, { readOnly: true }), config).reply, /个人记录与进度已清除/);
}

function main() {
  testVersionAndMigration();
  testDeterministicEconomy();
  testNoResetSeasonAndHonors();
  testReadRankingFilter();
  testWeeklyEventRequiresThreePeople();
  testAchievementMilestonesAndExitPrivacy();
  console.log('game market 1.4 rules tests passed');
}

main();
