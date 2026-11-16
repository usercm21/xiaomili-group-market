'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { DAY, HOUR, emptyState, execute, initialPlayer, listTargetCandidates, nextBoundary, noticeLinesFor, playfulLinesFor, reconcileMembers, validateState } = require('../lib/game-market/rules');
const { createGameMarket, parseCandidate, validateConfig } = require('../lib/game-market');
const { createMemberProvider } = require('../lib/game-market/member-provider');

const baseConfig = validateConfig({ enabled: true, groups: ['room_1@chatroom'], rankingPeriod: 'week', noReset: false });
const memberSnapshot = { ok: true, snapshotId: 's1', members: [{ username: 'wxid_a', nickname: 'A' }, { username: 'wxid_b', nickname: 'B' }] };

function request(command, senderId = 'wxid_a', now = Date.UTC(2026, 10, 9, 2), extra = {}) {
  return { command, senderId, senderName: senderId, now, memberSnapshot, ...extra };
}

async function main() {
  assert.strictEqual(parseCandidate({ text: '@小米粒 #打工', agentName: '小米粒' }).command, 'work');
  assert.strictEqual(parseCandidate({ text: '@小米粒\u2005#市场状态', agentName: '小米粒' }).command, 'status', '兼容微信 @ 后的特殊空格');
  assert.strictEqual(parseCandidate({ text: '@小米粒 #小米粒群友市场', agentName: '小米粒' }).command, 'help', '品牌全称可直接打开帮助');
  assert.strictEqual(parseCandidate({ text: '@小米粒 #小米粒群友市场帮助', agentName: '小米粒' }).command, 'help', '品牌帮助别名应可用');
  assert.strictEqual(parseCandidate({ text: '@小米粒 #小米粒群友市场状态', agentName: '小米粒' }).command, 'status', '品牌状态别名应可用');
  assert.strictEqual(parseCandidate({ text: '@小米粒 #加入小米粒群友市场', agentName: '小米粒' }).command, 'join', '品牌加入别名应可用');
  assert.strictEqual(parseCandidate({ text: '@小米粒 #退出小米粒群友市场', agentName: '小米粒' }).command, 'exit', '品牌退出别名应可用');
  assert.strictEqual(parseCandidate({ text: '@小米粒 打工', agentName: '小米粒' }), null, '无 # 的普通话术不得触发市场');
  assert.strictEqual(parseCandidate({ text: '请 @小米粒 #打工', agentName: '小米粒' }), null);
  assert.strictEqual(parseCandidate({ text: '@小米粒 # 打工', agentName: '小米粒' }), null, '# 后不得插入空格');
  assert.strictEqual(parseCandidate({ text: '@小米粒 #打工 真苦', agentName: '小米粒' }), null);
  assert.throws(() => validateConfig({ rankingPeriod: 'quarter' }), /invalid_ranking_period/);
  assert.strictEqual(validateConfig({}).rankingPeriod, 'month', '默认应为月榜');
  assert.strictEqual(parseCandidate({ text: '@小米粒 #招募', agentName: '小米粒' }).command, 'recruit');
  assert.strictEqual(parseCandidate({ text: '@小米粒 #放生', agentName: '小米粒' }).command, 'release');
  assert.strictEqual(parseCandidate({ text: '@小米粒 #夺取', agentName: '小米粒' }).randomTarget, true);
  assert.strictEqual(parseCandidate({ text: '@小米粒 #排位 B', agentName: '小米粒' }).command, 'rank');

  const playfulReplyKeys = [
    'join', 'exit', 'status', 'ranking', 'last-ranking', 'bank-status', 'work',
    'bank-upgrade', 'bank-deposit', 'bank-withdraw', 'recruit', 'release',
    'train-success', 'train-fail', 'steal-success', 'steal-fail', 'buyback',
    'duel-win', 'duel-loss', 'rank-win', 'rank-loss',
  ];
  for (const key of playfulReplyKeys) {
    const lines = playfulLinesFor(key);
    assert.ok(Array.isArray(lines), `${key} 必须提供趣味文案列表`);
    assert.strictEqual(lines.length, 50, `${key} 必须恰好提供 50 条趣味文案`);
    assert.strictEqual(new Set(lines).size, 50, `${key} 的 50 条趣味文案不得重复`);
    assert.ok(lines.every((line) => typeof line === 'string' && line.length > 0 && !/[\u0000-\u001f\u007f]/u.test(line)), `${key} 的趣味文案不得包含控制字符`);
  }
  assert.deepStrictEqual(playfulLinesFor('unknown-playful-key'), [], '未知趣味文案键应安全返回空列表');
  const noticeKeys = ['work-cooldown', 'cooldown', 'daily-limit', 'insufficient', 'target', 'relationship', 'capacity', 'participation', 'rule'];
  for (const key of noticeKeys) {
    const lines = noticeLinesFor(key);
    assert.strictEqual(lines.length, 50, `${key} 必须恰好提供 50 条趣味提示`);
    assert.strictEqual(new Set(lines).size, 50, `${key} 的 50 条趣味提示不得重复`);
    assert.ok(lines.every((line) => typeof line === 'string' && line.length > 0 && !/[\u0000-\u001f\u007f]/u.test(line)), `${key} 的趣味提示不得包含控制字符`);
  }
  assert.deepStrictEqual(noticeLinesFor('unknown-notice-key'), [], '未知趣味提示键应安全返回空列表');

  const start = Date.UTC(2026, 10, 9, 2);
  const state = emptyState(start, 'week', false);
  let result = execute(state, request('work', 'wxid_a', start), baseConfig, () => 0);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(state.players.get('wxid_a').coins, 51);
  assert.match(result.reply, /^.+\n\n📌 打工结算\n• 本次获得：41 虚拟币\n• 今日任务奖励：10 虚拟币\n• 当前余额：51 虚拟币\n• 今日次数：1\/5\n• 本月积分：1$/u, '玩法回执应按“趣味描述 + 结果区”排版');
  result = execute(state, request('work', 'wxid_a', start + 1), baseConfig, () => 0);
  assert.strictEqual(result.code, 'cooldown');
  assert.match(result.reply, /^.+\n\n📌 打工提示\n• 打工冷却中，剩余 1 小时。$/u, '打工冷却应提供趣味描述和精确剩余时间');
  for (let index = 1; index < 5; index += 1) {
    result = execute(state, request('work', 'wxid_a', start + index * HOUR), baseConfig, () => 0);
    assert.strictEqual(result.ok, true, `第 ${index + 1} 次打工应成功`);
  }
  result = execute(state, request('work', 'wxid_a', start + 5 * HOUR), baseConfig, () => 0);
  assert.strictEqual(result.code, 'work_daily_limit');
  assert.match(result.reply, /^.+\n\n📌 打工提示\n• 今日打工次数已用完（5\/5），北京时间明日 00:00 后恢复。$/u, '每日次数提示也应有趣味描述');
  result = execute(state, request('work', 'wxid_a', start + DAY), baseConfig, () => 0);
  assert.strictEqual(result.ok, true, '北京时间新自然日应重置打工次数');

  const beijingMidnightState = emptyState(Date.UTC(2026, 10, 9, 15, 30), 'week', false);
  beijingMidnightState.players.set('wxid_a', initialPlayer('wxid_a', 'A', Date.UTC(2026, 10, 9, 15, 30)));
  beijingMidnightState.players.get('wxid_a').workDailyCount = 5;
  beijingMidnightState.players.get('wxid_a').lastWorkAt = Date.UTC(2026, 10, 9, 15, 30);
  result = execute(beijingMidnightState, request('work', 'wxid_a', Date.UTC(2026, 10, 9, 15, 59)), baseConfig, () => 0);
  assert.strictEqual(result.code, 'work_daily_limit', '北京时间 23:59 仍属于同一自然日');
  result = execute(beijingMidnightState, request('work', 'wxid_a', Date.UTC(2026, 10, 9, 16, 0)), baseConfig, () => 0);
  assert.strictEqual(result.code, 'cooldown', '北京时间 00:00 只重置每日次数，不提前结束一小时冷却');
  result = execute(beijingMidnightState, request('work', 'wxid_a', Date.UTC(2026, 10, 9, 16, 30)), baseConfig, () => 0);
  assert.strictEqual(result.ok, true, '每日次数重置且一小时冷却结束后应可打工');

  const duelState = emptyState(start, 'week', false);
  duelState.players.set('wxid_a', initialPlayer('wxid_a', 'A', start));
  duelState.players.set('wxid_b', initialPlayer('wxid_b', 'B', start));
  duelState.players.get('wxid_a').coins = 1000;
  for (let index = 0; index < 10; index += 1) {
    result = execute(duelState, request('duel', 'wxid_a', start + index * 3 * 60_000), baseConfig, () => 0);
    assert.strictEqual(result.ok, true, `第 ${index + 1} 次决斗应成功`);
  }
  result = execute(duelState, request('duel', 'wxid_a', start + 10 * 3 * 60_000), baseConfig, () => 0);
  assert.strictEqual(result.code, 'duel_daily_limit');

  const markerState = emptyState(start, 'week', false);
  markerState.players.set('wxid_a', initialPlayer('wxid_a', 'A', start));
  markerState.players.set('wxid_b', initialPlayer('wxid_b', 'B', start));
  markerState.players.get('wxid_a').recruits.push('wxid_b');
  markerState.players.get('wxid_b').recruitedBy = 'wxid_a';
  result = execute(markerState, request('exit', 'wxid_b', start), baseConfig, () => 0);
  assert.strictEqual(result.ok, true);
  assert.strictEqual(markerState.players.has('wxid_b'), false);
  assert.deepStrictEqual(markerState.players.get('wxid_a').recruits, []);
  const marker = markerState.optedOut.get('wxid_b');
  assert.strictEqual(marker.rejoinNotBefore, nextBoundary(start, 'week'));
  result = execute(markerState, request('join', 'wxid_b', start + 1000), baseConfig, () => 0);
  assert.strictEqual(result.code, 'rejoin_locked');

  const absence = emptyState(start, 'week', false);
  absence.players.set('wxid_a', initialPlayer('wxid_a', 'A', start));
  assert.strictEqual(reconcileMembers(absence, { ok: true, snapshotId: 'one', members: [{ username: 'wxid_b' }] }, start), true);
  assert.strictEqual(absence.players.get('wxid_a').isolated, true);
  reconcileMembers(absence, { ok: true, snapshotId: 'two', members: [{ username: 'wxid_a', nickname: 'A2' }] }, start + 1);
  assert.strictEqual(absence.players.get('wxid_a').isolated, false);
  reconcileMembers(absence, { ok: true, snapshotId: 'three', members: [{ username: 'wxid_b' }] }, start + 2);
  reconcileMembers(absence, { ok: true, snapshotId: 'four', members: [{ username: 'wxid_b' }] }, start + 3);
  assert.strictEqual(absence.players.has('wxid_a'), true, '短时间内第二个缺失快照不得永久移除成员');
  reconcileMembers(absence, { ok: true, snapshotId: 'five', members: [{ username: 'wxid_b' }] }, start + 60_002);
  assert.strictEqual(absence.players.has('wxid_a'), false);
  assert.strictEqual(absence.optedOut.get('wxid_a').reason, 'left_group');
  const failed = emptyState(start, 'week', false);
  failed.players.set('wxid_a', initialPlayer('wxid_a', 'A', start));
  assert.strictEqual(reconcileMembers(failed, { ok: false, members: [] }, start), false);
  assert.strictEqual(failed.players.get('wxid_a').isolated, false);

  const selfTrain = emptyState(start, 'week', false);
  selfTrain.players.set('wxid_a', initialPlayer('wxid_a', 'A', start));
  selfTrain.players.get('wxid_a').coins = 100;
  result = execute(selfTrain, request('train', 'wxid_a', start), baseConfig, () => 0);
  assert.strictEqual(result.ok, true, '无名下群友时训练自身');
  assert.strictEqual(selfTrain.players.get('wxid_a').value, 105);

  const lazyRecruit = emptyState(start, 'week', false);
  lazyRecruit.players.set('wxid_a', initialPlayer('wxid_a', 'A', start));
  lazyRecruit.players.get('wxid_a').coins = 100;
  result = execute(lazyRecruit, request('recruit', 'wxid_a', start, { targetId: 'wxid_b', targetName: 'B' }), baseConfig, () => 0);
  assert.strictEqual(result.ok, true, '默认参与者被招募时才惰性建卡');
  assert.strictEqual(lazyRecruit.players.get('wxid_b').recruitedBy, 'wxid_a');

  const optedOutRecruit = emptyState(start, 'week', false);
  optedOutRecruit.players.set('wxid_a', initialPlayer('wxid_a', 'A', start));
  optedOutRecruit.players.get('wxid_a').coins = 100;
  optedOutRecruit.optedOut.set('wxid_b', { playerId: 'wxid_b', reason: 'voluntary', exitedAt: start, rejoinNotBefore: start + DAY });
  result = execute(optedOutRecruit, request('recruit', 'wxid_a', start, { targetId: 'wxid_b', targetName: 'B' }), baseConfig, () => 0);
  assert.strictEqual(result.code, 'target_unavailable', '显式目标不得绕过退出市场标记');
  assert.strictEqual(optedOutRecruit.players.has('wxid_b'), false);

  const overlap = emptyState(start, 'week', false);
  overlap.players.set('wxid_b', initialPlayer('wxid_b', 'B', start));
  overlap.optedOut.set('wxid_b', { playerId: 'wxid_b', reason: 'voluntary', exitedAt: start, rejoinNotBefore: start + DAY });
  assert.throws(() => validateState(overlap), /player_opted_out_overlap/, '玩家卡与退出标记不得同时存在');

  const bankInterest = emptyState(start, 'week', false);
  bankInterest.players.set('wxid_a', initialPlayer('wxid_a', 'A', start));
  bankInterest.players.get('wxid_a').bankBalance = 1000;
  bankInterest.players.get('wxid_a').coins = 1000;
  const projectedBank = execute(bankInterest, request('bank-status', 'wxid_a', start + 30 * 60_000, { readOnly: true }), baseConfig, () => 0);
  assert.strictEqual(bankInterest.players.get('wxid_a').lastInterestTime, start, '银行状态必须纯读，不得推进计息起点');
  assert.match(projectedBank.reply, /• 银行本金：1000\n• 待结利息：0（结息进入现金）\n• 存款限额：1000/, '不足整小时的状态查询展示当前本金');
  execute(bankInterest, request('bank-withdraw', 'wxid_a', start + DAY, { amount: 1 }), baseConfig, () => 0);
  assert.strictEqual(bankInterest.players.get('wxid_a').bankBalance, 999, '利息进入现金，不滚入本金');
  assert.strictEqual(bankInterest.players.get('wxid_a').coins, 1006, '状态查询不得吞掉后续写操作的利息');

  const emptyBankStatus = emptyState(start, 'week', false);
  result = execute(emptyBankStatus, request('bank-status', 'wxid_a', start, { readOnly: true }), baseConfig, () => 0);
  assert.strictEqual(result.mutated, false);
  assert.strictEqual(emptyBankStatus.players.size, 0, '银行状态不得为未建卡用户创建玩家卡');

  const pureRead = emptyState(start, 'week', false);
  const pureReadPlayer = initialPlayer('wxid_a', 'A', start);
  pureReadPlayer.isolated = true;
  pureReadPlayer.missingSnapshotId = 'old';
  pureReadPlayer.missingAt = start;
  pureRead.players.set(pureReadPlayer.id, pureReadPlayer);
  execute(pureRead, request('ranking', 'wxid_a', nextBoundary(start, 'week') + 1, {
    readOnly: true,
    memberSnapshot: { ok: true, snapshotId: 'new', members: [] },
  }), baseConfig, () => 0);
  assert.strictEqual(pureRead.players.has('wxid_a'), true, '只读请求不得推进成员离群状态');
  assert.strictEqual(pureRead.lastPeriodRanking, null, '只读请求不得触发周期结算');

  const pureStatus = initialPlayer('wxid_b', 'B', start);
  pureStatus.workDayId = '2026-01-01';
  pureStatus.workDailyCount = 5;
  pureRead.players.set(pureStatus.id, pureStatus);
  execute(pureRead, request('status', 'wxid_b', start, { readOnly: true, memberSnapshot: { ok: false, members: [] } }), baseConfig, () => 0);
  assert.strictEqual(pureStatus.workDayId, '2026-01-01', '状态查询不得刷新每日次数存储');
  assert.strictEqual(pureStatus.workDailyCount, 5);

  const capacityState = emptyState(start, 'week', false);
  const isolatedAtCapacity = initialPlayer('wxid_c', 'C', start);
  isolatedAtCapacity.isolated = true;
  isolatedAtCapacity.missingSnapshotId = 'missing';
  isolatedAtCapacity.missingAt = start;
  capacityState.players.set(isolatedAtCapacity.id, isolatedAtCapacity);
  result = execute(capacityState, request('join', 'wxid_a', start, {
    memberSnapshot: { ok: true, snapshotId: 'capacity', members: [{ username: 'wxid_a', nickname: 'A' }] },
  }), { ...baseConfig, maxPlayersPerGroup: 1 }, () => 0);
  assert.strictEqual(result.ok, true, '隔离玩家不得占用活跃玩家容量');

  const relationshipState = emptyState(start, 'week', false);
  const relationshipOwner = initialPlayer('wxid_a', 'A', start);
  const activeChild = initialPlayer('wxid_b', 'B', start);
  const isolatedChild = initialPlayer('wxid_c', 'C', start);
  activeChild.recruitedBy = relationshipOwner.id;
  isolatedChild.recruitedBy = relationshipOwner.id;
  isolatedChild.isolated = true;
  relationshipOwner.recruits.push(activeChild.id, isolatedChild.id);
  relationshipState.players.set(relationshipOwner.id, relationshipOwner);
  relationshipState.players.set(activeChild.id, activeChild);
  relationshipState.players.set(isolatedChild.id, isolatedChild);
  result = execute(relationshipState, request('status', 'wxid_a', start, {
    memberSnapshot: { ok: false, members: [] },
  }), baseConfig, () => 0);
  assert.match(result.reply, /名下群友 1/, '状态只统计有效群友');
  result = execute(relationshipState, request('ranking', 'wxid_a', start, {
    memberSnapshot: { ok: false, members: [] },
  }), baseConfig, () => 0);
  assert.match(result.reply, /群友数榜\n1\. A 1/, '群友数榜只统计有效群友');

  const settlementOrder = emptyState(start, 'week', false);
  const departing = initialPlayer('wxid_b', 'B', start);
  departing.coins = 999;
  departing.isolated = true;
  departing.missingSnapshotId = 'old';
  departing.missingAt = start;
  settlementOrder.players.set(departing.id, departing);
  execute(settlementOrder, request('ranking', 'wxid_a', nextBoundary(start, 'week') + 1, {
    memberSnapshot: { ok: true, snapshotId: 'new', members: [{ username: 'wxid_a', nickname: 'A' }] },
  }), baseConfig, () => 0);
  assert.strictEqual(settlementOrder.players.has('wxid_b'), false, '到期结算前应先确认离群成员');
  assert.ok(!settlementOrder.lastPeriodRanking.coins.some((row) => row.playerId === 'wxid_b'), '已确认离群成员不得进入期末榜单');

  const isolatedOwnerSale = emptyState(start, 'week', false);
  const buyer = initialPlayer('wxid_a', 'A', start);
  const saleTarget = initialPlayer('wxid_b', 'B', start);
  const saleOwner = initialPlayer('wxid_c', 'C', start);
  buyer.coins = 1000;
  saleOwner.isolated = true;
  saleOwner.recruits.push(saleTarget.id);
  saleTarget.recruitedBy = saleOwner.id;
  isolatedOwnerSale.players.set(buyer.id, buyer);
  isolatedOwnerSale.players.set(saleTarget.id, saleTarget);
  isolatedOwnerSale.players.set(saleOwner.id, saleOwner);
  result = execute(isolatedOwnerSale, request('recruit', 'wxid_a', start, {
    targetId: 'wxid_b', targetName: 'B', memberSnapshot: { ok: false, members: [] },
  }), baseConfig, () => 0);
  assert.strictEqual(result.code, 'relationship_invalid', '转售不得向隔离所有者支付');
  assert.strictEqual(buyer.coins, 1000, '转售拒绝时买方不得扣款');
  assert.strictEqual(saleOwner.coins, 0);

  const isolatedOwnerBuyback = emptyState(start, 'week', false);
  const buybackPlayer = initialPlayer('wxid_a', 'A', start);
  const buybackOwner = initialPlayer('wxid_b', 'B', start);
  buybackPlayer.coins = 1000;
  buybackPlayer.recruitedBy = buybackOwner.id;
  buybackOwner.recruits.push(buybackPlayer.id);
  buybackOwner.isolated = true;
  isolatedOwnerBuyback.players.set(buybackPlayer.id, buybackPlayer);
  isolatedOwnerBuyback.players.set(buybackOwner.id, buybackOwner);
  result = execute(isolatedOwnerBuyback, request('buyback', 'wxid_a', start, {
    memberSnapshot: { ok: false, members: [] },
  }), baseConfig, () => 0);
  assert.strictEqual(result.code, 'relationship_invalid', '回购不得向隔离所有者支付');
  assert.strictEqual(buybackPlayer.coins, 1000);

  const resetVersion = emptyState(start, 'week', false);
  const adminRequest = { adminUsers: ['wxid_a'], confirmationToken: 'deadbeef', memberSnapshot: { ok: false, members: [] } };
  result = execute(resetVersion, request('admin-reset-force', 'wxid_a', start, adminRequest), baseConfig, () => 0);
  assert.strictEqual(result.ok, true);
  resetVersion.meta.commitSequence += 1; // 模拟发起强制重置请求的 Store 提交。
  result = execute(resetVersion, request('admin-reset-confirm', 'wxid_a', start + 1, {
    adminUsers: ['wxid_a'], resetToken: 'deadbeef', memberSnapshot: { ok: false, members: [] },
  }), baseConfig, () => 0);
  assert.strictEqual(result.ok, true, '账本未变化时确认应成功');

  const changedResetVersion = emptyState(start, 'week', false);
  execute(changedResetVersion, request('admin-reset-force', 'wxid_a', start, adminRequest), baseConfig, () => 0);
  changedResetVersion.meta.commitSequence += 2; // 发起请求提交后，又有一笔新提交。
  result = execute(changedResetVersion, request('admin-reset-confirm', 'wxid_a', start + 1, {
    adminUsers: ['wxid_a'], resetToken: 'deadbeef', memberSnapshot: { ok: false, members: [] },
  }), baseConfig, () => 0);
  assert.strictEqual(result.code, 'reset_state_changed', '账本版本变化后旧确认码必须作废');

  const candidateState = emptyState(start, 'week', false);
  const candidateMembers = Array.from({ length: 24 }, (_, index) => ({ username: `wxid_${index}`, nickname: `群友${index}` }));
  candidateMembers.unshift({ username: 'wxid_a', nickname: 'A' });
  const actor = initialPlayer('wxid_a', 'A', start);
  candidateState.players.set(actor.id, actor);
  for (let index = 0; index < 4; index += 1) {
    const id = `wxid_${index}`;
    const child = initialPlayer(id, `群友${index}`, start);
    child.recruitedBy = actor.id;
    actor.recruits.push(id);
    candidateState.players.set(id, child);
  }
  candidateState.players.get('wxid_1').isolated = true;
  candidateState.optedOut.set('wxid_2', { playerId: 'wxid_2', reason: 'voluntary', exitedAt: start, rejoinNotBefore: start + DAY });
  const ownedCandidates = listTargetCandidates(candidateState, {
    command: 'release', senderId: actor.id, memberSnapshot: { ok: true, members: candidateMembers }, protectedUsers: [],
  });
  assert.deepStrictEqual(ownedCandidates.map((item) => item.username), ['wxid_0', 'wxid_3'], '放生/排位候选应排除隔离和退出者');
  const recruitCandidates = listTargetCandidates(candidateState, {
    command: 'recruit', senderId: actor.id, memberSnapshot: { ok: true, members: candidateMembers },
    protectedUsers: ['wxid_4'], lastSuccessfulAt: { wxid_6: start + 20, wxid_5: start + 10 },
  });
  assert.ok(!recruitCandidates.some((item) => ['wxid_a', 'wxid_0', 'wxid_1', 'wxid_2', 'wxid_3', 'wxid_4'].includes(item.username)), '招募候选应排除自己、已名下、隔离、退出和保护对象');
  assert.deepStrictEqual(recruitCandidates.slice(0, 2).map((item) => item.username), ['wxid_6', 'wxid_5'], '超额候选应优先最近成功操作者');
  const noOwnedTrain = listTargetCandidates(emptyState(start, 'week', false), {
    command: 'train', senderId: 'wxid_a', memberSnapshot: { ok: true, members: [{ username: 'wxid_a', nickname: 'A' }] }, protectedUsers: [],
  });
  assert.deepStrictEqual(noOwnedTrain.map((item) => item.username), ['wxid_a'], '无名下群友时裸训练直接选自己');

  async function selectionMarket(members) {
    const calls = [];
    const instance = createGameMarket({
      store: {
        request: async ({ type, payload }) => {
          calls.push({ type, payload });
          if (type === 'candidates') return { members: members.slice(0, 20), total: members.length };
          return { ok: true, code: 'ok', reply: '已执行', replayed: false };
        },
        close: async () => {},
      },
      now: () => start,
    });
    return { instance, calls };
  }
  function selectionInput(text, localId, members, receivedAtMs = start, senderUsername = 'wxid_a') {
    return {
      text, agentName: '小米粒', chatWxid: 'room_1@chatroom', senderUsername, senderName: senderUsername,
      localId, timestampSec: receivedAtMs / 1000, receivedAtMs, config: baseConfig,
      memberSnapshot: { ok: true, snapshotId: `s-${localId}`, members: [{ username: senderUsername, nickname: senderUsername }, ...members] },
    };
  }

  let selection = await selectionMarket([]);
  let selectionResult = await selection.instance.handle(selectionInput('@小米粒 #放生', 'select-0', []));
  assert.strictEqual(selectionResult.code, 'no_candidates');
  assert.strictEqual(selection.calls.filter((call) => call.type === 'execute').length, 0, '0 候选不应执行经济操作');
  await selection.instance.close();

  const one = [{ username: 'wxid_b', nickname: 'B' }];
  selection = await selectionMarket(one);
  selectionResult = await selection.instance.handle(selectionInput('@小米粒 #放生', 'select-1', one));
  assert.strictEqual(selectionResult.status, 'ok');
  assert.strictEqual(selection.calls.find((call) => call.type === 'execute').payload.targetId, 'wxid_b', '1 候选应直接执行');
  await selection.instance.close();

  const two = [{ username: 'wxid_b', nickname: 'B' }, { username: 'wxid_c', nickname: 'C' }];
  selection = await selectionMarket(two);
  selectionResult = await selection.instance.handle(selectionInput('@小米粒 #放生', 'select-2', two));
  assert.strictEqual(selectionResult.code, 'target_required');
  assert.match(selectionResult.reply, /#1 B\n#2 C/);
  assert.strictEqual(selection.calls.filter((call) => call.type === 'execute').length, 0, '列候选不应提交交易');
  let invalidNumber = await selection.instance.handle(selectionInput('@小米粒 #招募 #1', 'wrong-command', two));
  assert.strictEqual(invalidNumber.code, 'selection_expired', '编号不得跨命令使用');
  invalidNumber = await selection.instance.handle(selectionInput('@小米粒 #放生 #1', 'wrong-user', two, start, 'wxid_z'));
  assert.strictEqual(invalidNumber.code, 'selection_expired', '编号不得跨用户使用');
  invalidNumber = await selection.instance.handle(selectionInput('@小米粒 #放生 #1', 'expired', two, start + 60_001));
  assert.strictEqual(invalidNumber.code, 'selection_expired', '编号 60 秒后过期');
  const selected = await selection.instance.handle(selectionInput('@小米粒 #放生 #2', 'selected', two, start + 60_000));
  assert.strictEqual(selected.status, 'ok', '60 秒边界时仍可使用');
  assert.strictEqual(selection.calls.find((call) => call.type === 'execute').payload.targetId, 'wxid_c');
  await selection.instance.close();

  const spaced = [{ username: 'wxid_b', nickname: '同  名' }];
  selection = await selectionMarket(spaced);
  selectionResult = await selection.instance.handle(selectionInput('@小米粒 #招募 同 名', 'normalized-name', spaced));
  assert.strictEqual(selectionResult.status, 'ok', '成员昵称和用户输入应使用同一空格标准化规则');
  await selection.instance.close();

  const sameNames = Array.from({ length: 6 }, (_, index) => ({ username: `wxid_same_${index}`, nickname: '同名群友' }));
  selection = await selectionMarket(sameNames);
  selectionResult = await selection.instance.handle(selectionInput('@小米粒 #招募 同名群友', 'same-name-list', sameNames));
  assert.strictEqual(selectionResult.code, 'target_ambiguous');
  assert.strictEqual((selectionResult.reply.match(/^#[0-9]+ /gm) || []).length, 6, '超过五个同名群友也必须提供可执行编号');
  const selectedSameName = await selection.instance.handle(selectionInput('@小米粒 #招募 #6', 'same-name-selected', sameNames));
  assert.strictEqual(selectedSameName.status, 'ok');
  assert.strictEqual(selection.calls.findLast((call) => call.type === 'execute').payload.targetId, 'wxid_same_5');
  await selection.instance.close();

  for (const count of [20, 21]) {
    const many = Array.from({ length: count }, (_, index) => ({ username: `wxid_many_${index}`, nickname: `M${index + 1}` }));
    selection = await selectionMarket(many);
    selectionResult = await selection.instance.handle(selectionInput('@小米粒 #招募', `select-${count}`, many));
    assert.strictEqual((selectionResult.reply.match(/^#[0-9]+ /gm) || []).length, 20, `${count} 候选应展示 20 个编号`);
    assert.strictEqual(selectionResult.reply.includes('前 20 人'), count === 21);
    await selection.instance.close();
  }

  const randomStealState = emptyState(start, 'week', false);
  randomStealState.players.set('wxid_a', initialPlayer('wxid_a', 'A', start));
  randomStealState.players.set('wxid_b', initialPlayer('wxid_b', 'B', start));
  randomStealState.players.get('wxid_a').coins = 20;
  randomStealState.players.get('wxid_b').coins = 100;
  result = execute(randomStealState, request('steal', 'wxid_a', start, { randomTarget: true }), baseConfig, () => 0);
  assert.strictEqual(result.ok, true, '裸 #夺取应继续随机选目标执行');
  assert.match(result.reply, /^.+\n\n📌 夺取结果\n• 结果：夺取成功\n• 本次获得：10 虚拟币\n• 当前余额：30 虚拟币\n• 今日次数：1\/5$/u);

  for (const setup of ['only-self', 'zero-coins', 'protected']) {
    const emptyStealState = emptyState(start, 'week', false);
    emptyStealState.players.set('wxid_a', initialPlayer('wxid_a', 'A', start));
    const extra = { randomTarget: true };
    if (setup !== 'only-self') {
      emptyStealState.players.set('wxid_b', initialPlayer('wxid_b', 'B', start));
      if (setup === 'protected') {
        emptyStealState.players.get('wxid_b').coins = 100;
        extra.protectedUsers = ['wxid_b'];
      }
    }
    result = execute(emptyStealState, request('steal', 'wxid_a', start, extra), baseConfig, () => 0);
    assert.strictEqual(result.code, 'empty_target_pool', `${setup} 应返回随机夺取专用空池提示`);
    assert.match(result.reply, /当前没有可夺取的其他群友/);
  }

  const flavorReplies = new Set();
  const flavorMessageIdsByReply = new Map();
  for (let index = 0; index < 500; index += 1) {
    const flavorState = emptyState(start, 'week', false);
    const flavorRequest = request('work', 'wxid_a', start, { messageId: `flavor-${index}` });
    const flavorReply = execute(flavorState, flavorRequest, baseConfig, () => 0).reply.split('\n')[0];
    flavorReplies.add(flavorReply);
    if (!flavorMessageIdsByReply.has(flavorReply)) flavorMessageIdsByReply.set(flavorReply, flavorRequest.messageId);
  }
  assert.ok(flavorReplies.size > 1, '不同消息应能稳定选择不同趣味描述');
  assert.ok(flavorReplies.size >= 40, '足量不同消息应覆盖多条趣味描述，避免退化为固定文案');
  const stableFlavorStateA = emptyState(start, 'week', false);
  const stableFlavorStateB = emptyState(start, 'week', false);
  const stableFlavorRequest = request('work', 'wxid_a', start, { messageId: 'same-flavor' });
  assert.strictEqual(
    execute(stableFlavorStateA, stableFlavorRequest, baseConfig, () => 0).reply,
    execute(stableFlavorStateB, stableFlavorRequest, baseConfig, () => 0).reply,
    '同一消息应得到相同趣味描述且不改变经济随机序列',
  );
  const economicsWithFlavorA = emptyState(start, 'week', false);
  const economicsWithFlavorB = emptyState(start, 'week', false);
  const [firstFlavorMessageId, secondFlavorMessageId] = Array.from(flavorMessageIdsByReply.values()).slice(0, 2);
  const randomSequence = [0.12, 0.88];
  const makeRandom = () => {
    let cursor = 0;
    return () => randomSequence[cursor++];
  };
  const firstEconomics = execute(economicsWithFlavorA, request('work', 'wxid_a', start, { messageId: firstFlavorMessageId }), baseConfig, makeRandom());
  const secondEconomics = execute(economicsWithFlavorB, request('work', 'wxid_a', start, { messageId: secondFlavorMessageId }), baseConfig, makeRandom());
  assert.notStrictEqual(firstEconomics.reply.split('\n')[0], secondEconomics.reply.split('\n')[0], '测试消息应命中不同趣味描述');
  assert.strictEqual(economicsWithFlavorA.players.get('wxid_a').coins, economicsWithFlavorB.players.get('wxid_a').coins, '趣味文案选择不得消耗或改变经济随机序列');
  assert.match(firstEconomics.reply, /• 本次获得：45 虚拟币\n• 今日任务奖励：10 虚拟币\n• 当前余额：55 虚拟币/u);
  assert.match(secondEconomics.reply, /• 本次获得：45 虚拟币\n• 今日任务奖励：10 虚拟币\n• 当前余额：55 虚拟币/u);

  const cooldownReplies = new Set();
  for (let index = 0; index < 500; index += 1) {
    const cooldownState = emptyState(start, 'week', false);
    const cooldownPlayer = initialPlayer('wxid_a', 'A', start);
    cooldownPlayer.lastWorkAt = start;
    cooldownState.players.set(cooldownPlayer.id, cooldownPlayer);
    const cooldownResult = execute(cooldownState, request('work', 'wxid_a', start + 1, { messageId: `cooldown-${index}` }), baseConfig, () => 0);
    assert.strictEqual(cooldownResult.code, 'cooldown');
    cooldownReplies.add(cooldownResult.reply.split('\n')[0]);
  }
  assert.ok(cooldownReplies.size >= 40, '足量不同冷却消息应覆盖至少 40 条趣味提示');
  const stableCooldownStateA = emptyState(start, 'week', false);
  const stableCooldownStateB = emptyState(start, 'week', false);
  stableCooldownStateA.players.set('wxid_a', { ...initialPlayer('wxid_a', 'A', start), lastWorkAt: start });
  stableCooldownStateB.players.set('wxid_a', { ...initialPlayer('wxid_a', 'A', start), lastWorkAt: start });
  const stableCooldownRequest = request('work', 'wxid_a', start + 1, { messageId: 'same-cooldown' });
  assert.strictEqual(
    execute(stableCooldownStateA, stableCooldownRequest, baseConfig, () => 0).reply,
    execute(stableCooldownStateB, stableCooldownRequest, baseConfig, () => 0).reply,
    '同一冷却消息应得到相同趣味提示',
  );

  const noReset = emptyState(start, 'week', false);
  noReset.players.set('wxid_a', initialPlayer('wxid_a', 'A', start));
  noReset.players.get('wxid_a').coins = 99;
  const weekEnd = nextBoundary(start, 'week');
  execute(noReset, request('status', 'wxid_a', weekEnd + 1), { ...baseConfig, noReset: true }, () => 0);
  assert.strictEqual(noReset.players.get('wxid_a').coins, 99, '新 noReset 值决定下一次结算是否清零');
  assert.strictEqual(noReset.lastPeriodRanking.cumulative, true);

  const cadence = emptyState(start, 'week', false);
  const pristineSwitch = execute(cadence, request('help', 'wxid_a', start), { ...baseConfig, rankingPeriod: 'month' }, () => 0);
  assert.strictEqual(pristineSwitch.ok, true);
  assert.strictEqual(cadence.meta.cadence, 'month', '无经济数据的旧默认账本应立即切换为月榜');

  const activeCadence = emptyState(start, 'week', false);
  activeCadence.players.set('wxid_a', initialPlayer('wxid_a', 'A', start));
  execute(activeCadence, request('status', 'wxid_a', start), { ...baseConfig, rankingPeriod: 'month' }, () => 0);
  assert.strictEqual(activeCadence.meta.cadence, 'week');
  assert.strictEqual(activeCadence.meta.pendingCadence, 'month');
  execute(activeCadence, request('status', 'wxid_a', activeCadence.meta.pendingCadenceAt + 1), { ...baseConfig, rankingPeriod: 'month' }, () => 0);
  assert.strictEqual(activeCadence.meta.cadence, 'month');

  let memberCalls = 0;
  let failMembers = false;
  const provider = createMemberProvider({
    now: () => start,
    execFile: (_bin, _args, _opts, callback) => {
      memberCalls += 1;
      setImmediate(() => failMembers
        ? callback(Object.assign(new Error('failed'), { code: 1 }), '', '')
        : callback(null, JSON.stringify({ members: [{ username: 'wxid_a', group_nickname: 'A' }] }), ''));
    },
  });
  const [snapshotA, snapshotB] = await Promise.all([provider.getSnapshot('room_1@chatroom'), provider.getSnapshot('room_1@chatroom')]);
  assert.strictEqual(memberCalls, 1, '同群成员刷新应 singleflight');
  assert.strictEqual(snapshotA.snapshotId, snapshotB.snapshotId);
  failMembers = true;
  const failedRefresh = await provider.getSnapshot('room_1@chatroom', { force: true });
  assert.strictEqual(failedRefresh.ok, false, '刷新失败不得回退旧成员名单');

  let helpMemberCalls = 0;
  const helpMarket = createGameMarket({
    memberProvider: { getSnapshot: async () => { helpMemberCalls += 1; return { ok: false, members: [] }; } },
    store: {
      request: async ({ payload }) => ({ ok: true, reply: payload.command === 'help' ? '帮助内容' : '', replayed: false }),
      close: async () => {},
    },
    now: () => start,
  });
  const helpWithoutMembers = await helpMarket.handle({
    text: '@小米粒 #帮助', agentName: '小米粒', chatWxid: 'room_1@chatroom', senderUsername: 'wxid_a',
    timestampSec: start / 1000, receivedAtMs: start, config: baseConfig,
  });
  assert.strictEqual(helpWithoutMembers.status, 'ok');
  assert.strictEqual(helpMemberCalls, 0, '静态帮助不得依赖完整群成员快照');
  assert.match(helpWithoutMembers.reply, /^🎮 小米粒群友市场帮助\n赛制：周榜｜到期结算并清零/u);
  for (const heading of ['💰 赚钱与银行', '🤝 群友关系', '⚔️ 互动挑战', '📊 查询', '🚪 参与设置', '📝 发送示例', '💡 选择对象']) {
    assert.ok(helpWithoutMembers.reply.includes(`\n\n${heading}\n`), `帮助应分区展示：${heading}`);
  }
  assert.match(helpWithoutMembers.reply, /@小米粒 #招募 #1/u, '帮助应提供编号选择示例');
  await helpMarket.close();

  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'game-market-core-'));
  const market = createGameMarket({ rootDir: root, now: () => start });
  const unknownExit = await market.handle({
    text: '@小米粒 #退出市场', agentName: '小米粒', accountNamespace: 'wechat:test', chatWxid: 'unknown@chatroom',
    senderUsername: 'wxid_a', localId: 'exit-unknown', timestampSec: start / 1000, receivedAtMs: start,
    config: { ...baseConfig, enabled: false },
  });
  assert.strictEqual(unknownExit.code, 'market_unknown_group');
  assert.strictEqual(fs.existsSync(path.join(root, 'data', 'game-market')), true);
  assert.strictEqual(fs.readdirSync(path.join(root, 'data', 'game-market')).length, 0, '陌生群退出不得创建数据库');
  const input = {
    text: '@小米粒 #打工', agentName: '小米粒', accountNamespace: 'wechat:test', chatWxid: 'room_1@chatroom',
    senderUsername: 'wxid_a', senderName: 'A', localId: '1001', timestampSec: start / 1000, receivedAtMs: start,
    config: baseConfig, memberSnapshot,
  };
  const first = await market.handle(input);
  const replay = await market.handle(input);
  assert.strictEqual(first.status, 'ok');
  assert.strictEqual(replay.status, 'replay');
  assert.strictEqual(replay.reply, first.reply, '幂等重放必须返回首次持久化的相同趣味文案');
  const delayedReplay = await market.handle({ ...input, receivedAtMs: start + 360_001 });
  assert.strictEqual(delayedReplay.status, 'replay', '幂等命中必须先于新鲜度拒绝');
  const staleNew = await market.handle({ ...input, localId: 'stale-new', receivedAtMs: start + 360_001 });
  assert.strictEqual(staleNew.code, 'stale_message');
  const conflict = await market.handle({ ...input, text: '@小米粒 #银行 存 1' });
  assert.strictEqual(conflict.code, 'idempotency_conflict');
  const beforeCandidatePrompt = await market.inspect('room_1@chatroom', baseConfig);
  const candidatePrompt = await market.handle({
    ...input,
    text: '@小米粒 #招募',
    localId: 'candidate-read-only',
    memberSnapshot: {
      ok: true,
      snapshotId: 'candidate-snapshot',
      members: [...memberSnapshot.members, { username: 'wxid_c', nickname: 'C' }],
    },
  });
  assert.strictEqual(candidatePrompt.code, 'target_required');
  const afterCandidatePrompt = await market.inspect('room_1@chatroom', baseConfig);
  assert.strictEqual(afterCandidatePrompt.meta.commitSequence, beforeCandidatePrompt.meta.commitSequence, '候选列表不得增加账本提交序号');
  assert.strictEqual(afterCandidatePrompt.players.length, beforeCandidatePrompt.players.length, '候选列表不得惰性建卡');
  const adminConfig = { ...baseConfig, adminUsers: ['wxid_a'] };
  const force = await market.handle({ ...input, text: '@小米粒 #市场重置 强制', localId: 'force-1', config: adminConfig });
  assert.strictEqual(force.status, 'ok');
  const resetToken = force.reply.match(/#([a-f0-9]{8})/)[1];
  const confirmed = await market.handle({ ...input, text: `@小米粒 #市场重置 确认 #${resetToken}`, localId: 'force-2', config: adminConfig });
  assert.strictEqual(confirmed.status, 'ok');
  const forceAgain = await market.handle({ ...input, text: '@小米粒 #市场重置 强制', localId: 'force-3', receivedAtMs: start + 1, config: adminConfig });
  const resetTokenAgain = forceAgain.reply.match(/#([a-f0-9]{8})/)[1];
  const confirmedAgain = await market.handle({ ...input, text: `@小米粒 #市场重置 确认 #${resetTokenAgain}`, localId: 'force-4', receivedAtMs: start + 2, config: adminConfig });
  assert.strictEqual(confirmedAgain.status, 'ok');
  const persisted = await market.inspect('room_1@chatroom', baseConfig);
  assert.strictEqual(persisted.players.length, 1);
  assert.ok(persisted.meta.commitSequence >= 3);
  const configuredExitWhileDisabled = await market.handle({
    ...input, text: '@小米粒 #退出市场', localId: '1002', config: { ...baseConfig, enabled: false },
  });
  assert.strictEqual(configuredExitWhileDisabled.status, 'ok');
  await market.close();
  const dbFiles = fs.readdirSync(path.join(root, 'data', 'game-market'))
    .filter((name) => name.endsWith('.sqlite') && !name.includes('.backup-'));
  assert.strictEqual(dbFiles.length, 1);
  assert.strictEqual(fs.statSync(path.join(root, 'data', 'game-market', dbFiles[0])).mode & 0o777, 0o600);
  assert.strictEqual(fs.existsSync(path.join(root, 'data', 'game-market', `${dbFiles[0]}.backup`)), true, '强制重置前创建一致性备份');
  const versionedBackups = fs.readdirSync(path.join(root, 'data', 'game-market'))
    .filter((name) => name.startsWith(`${dbFiles[0]}.backup-`) && name.endsWith('.sqlite'));
  assert.strictEqual(versionedBackups.length, 2, '连续强制重置必须保留多个可回滚版本');

  console.log('game market core tests passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
