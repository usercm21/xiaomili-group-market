'use strict';

const crypto = require('crypto');
const { createGameMarketStore } = require('./store');
const { createMemberProvider } = require('./member-provider');
const { marketHelpText } = require('./rules');
const { CONTENT_VERSION, CURRENT_SCHEMA_VERSION, MARKET_VERSION, RULESET_HASH, RULESET_VERSION } = require('./version');

const WRITE_COMMANDS = new Set(['join', 'exit', 'work', 'bank-deposit', 'bank-withdraw', 'bank-upgrade', 'recruit', 'release', 'train', 'steal', 'buyback', 'duel', 'rank', 'admin-reset', 'admin-reset-force', 'admin-reset-confirm']);
const ECONOMIC_WRITE_COMMANDS = new Set(['work', 'bank-deposit', 'bank-withdraw', 'bank-upgrade', 'recruit', 'release', 'train', 'steal', 'buyback', 'duel', 'rank']);
const READ_ONLY_COMMANDS = new Set([
  'status', 'ranking', 'last-ranking', 'bank-status', 'admin-reset-status',
  'market-version', 'market-records', 'market-tasks', 'market-achievements', 'market-honors', 'market-event',
]);
const FULL_MEMBER_COMMANDS = new Set(['work', 'ranking', 'last-ranking', 'recruit', 'release', 'train', 'steal', 'buyback', 'duel', 'rank', 'admin-reset-status', 'admin-reset', 'admin-reset-force', 'admin-reset-confirm']);

function normalizeSpaces(value) { return String(value || '').replace(/[\u3000\s]+/g, ' ').trim(); }

function parseBody(body) {
  if (body === '加入市场' || body === '加入小米粒群友市场') return { command: 'join' };
  if (body === '退出市场' || body === '退出小米粒群友市场') return { command: 'exit' };
  if (body === '打工') return { command: 'work' };
  if (['帮助', '市场帮助', '小米粒群友市场', '小米粒群友市场帮助'].includes(body)) return { command: 'help' };
  if (body === '排行') return { command: 'ranking' };
  if (['上期排行', '上周排行', '上月排行'].includes(body)) return { command: 'last-ranking', requestedRanking: body };
  if (body === '市场版本') return { command: 'market-version' };
  if (body === '市场记录') return { command: 'market-records' };
  if (body === '市场任务') return { command: 'market-tasks' };
  if (body === '市场成就') return { command: 'market-achievements' };
  if (body === '市场荣誉') return { command: 'market-honors' };
  if (body === '市场事件') return { command: 'market-event' };
  if (body === '市场状态' || body === '小米粒群友市场状态') return { command: 'status' };
  if (body === '市场重置状态') return { command: 'admin-reset-status' };
  if (body === '市场重置') return { command: 'admin-reset' };
  if (body === '市场重置 强制') return { command: 'admin-reset-force' };
  let match = body.match(/^市场重置 确认 #([A-Za-z0-9]{6,16})$/);
  if (match) return { command: 'admin-reset-confirm', resetToken: match[1] };
  if (body === '银行 状态') return { command: 'bank-status' };
  if (body === '银行 升级') return { command: 'bank-upgrade' };
  if (body === '回购自身') return { command: 'buyback' };
  if (body === '决斗') return { command: 'duel' };
  if (body === '训练') return { command: 'train' };
  if (body === '招募') return { command: 'recruit' };
  if (body === '放生') return { command: 'release' };
  if (body === '排位') return { command: 'rank' };
  match = body.match(/^银行 (存|取) (全部|[0-9]+)$/);
  if (match) return { command: match[1] === '存' ? 'bank-deposit' : 'bank-withdraw', amount: match[2] === '全部' ? 'all' : Number(match[2]) };
  match = body.match(/^(招募|放生|训练|夺取|排位) (.+)$/);
  if (match) return { command: { 招募: 'recruit', 放生: 'release', 训练: 'train', 夺取: 'steal', 排位: 'rank' }[match[1]], targetText: match[2].trim() };
  if (body === '夺取') return { command: 'steal', randomTarget: true };
  if (/^(?:银行|招募|放生|训练|夺取|排位|加入市场|退出市场|加入小米粒群友市场|退出小米粒群友市场|小米粒群友市场|市场版本|市场记录|市场任务|市场成就|市场荣誉|市场事件|市场重置)(?:\s|$)/.test(body)) return { command: 'usage', usage: '指令格式不正确，请发送“@小米粒 #帮助”查看用法。' };
  return null;
}

function parseCandidate({ text, agentName = '小米粒' } = {}) {
  const normalized = normalizeSpaces(text);
  const prefix = `@${normalizeSpaces(agentName)}`;
  if (!normalized.startsWith(`${prefix} `)) return null;
  const markedBody = normalized.slice(prefix.length + 1);
  if (!markedBody.startsWith('#') || markedBody.length === 1 || markedBody[1] === ' ') return null;
  const parsed = parseBody(markedBody.slice(1));
  if (!parsed) return null;
  return {
    ...parsed,
    normalizedText: normalized,
    isWrite: WRITE_COMMANDS.has(parsed.command),
    isEconomicWrite: ECONOMIC_WRITE_COMMANDS.has(parsed.command),
    readOnly: READ_ONLY_COMMANDS.has(parsed.command),
  };
}

function staticHelp(config) {
  return marketHelpText(config.rankingPeriod, config.noReset);
}

function storeErrorReply(code) {
  if (code === 'unsupported_market_schema') return '账本版本高于当前程序，已停止读写，请升级小米粒群友市场。';
  if (code === 'store_result_unknown') return '操作结果待核对，请勿换消息重试。';
  return '市场账本暂不可用。';
}

function validateConfig(input = {}) {
  if (input.enabled !== undefined && typeof input.enabled !== 'boolean') throw new Error('invalid_enabled');
  for (const field of ['groups', 'adminUsers', 'protectedUsers']) {
    if (input[field] !== undefined && !Array.isArray(input[field])) throw new Error(`invalid_${field}`);
  }
  const config = {
    enabled: input.enabled === true,
    groups: Array.isArray(input.groups) ? input.groups.map(String) : [],
    adminUsers: Array.isArray(input.adminUsers) ? input.adminUsers.map(String) : [],
    protectedUsers: Array.isArray(input.protectedUsers) ? input.protectedUsers.map(String) : [],
    maxPlayersPerGroup: input.maxPlayersPerGroup ?? 500,
    maxAcceptedWritesPer10Min: input.maxAcceptedWritesPer10Min ?? 3000,
    spamCooldownSec: input.spamCooldownSec ?? 10,
    groupReplyBudgetPerMinute: input.groupReplyBudgetPerMinute ?? 20,
    globalReplyBudgetPerMinute: input.globalReplyBudgetPerMinute ?? 100,
    rankingPeriod: input.rankingPeriod ?? 'month',
    noReset: input.noReset ?? true,
  };
  if (!['week', 'month'].includes(config.rankingPeriod)) throw new Error('invalid_ranking_period');
  if (typeof config.noReset !== 'boolean') throw new Error('invalid_no_reset');
  if (!Number.isInteger(config.maxPlayersPerGroup) || config.maxPlayersPerGroup < 1 || config.maxPlayersPerGroup > 5000) throw new Error('invalid_max_players');
  if (!Number.isInteger(config.maxAcceptedWritesPer10Min) || config.maxAcceptedWritesPer10Min < 10 || config.maxAcceptedWritesPer10Min > 100000) throw new Error('invalid_write_limit');
  if (!Number.isInteger(config.spamCooldownSec) || config.spamCooldownSec < 0 || config.spamCooldownSec > 300) throw new Error('invalid_spam_cooldown');
  if (!Number.isInteger(config.groupReplyBudgetPerMinute) || config.groupReplyBudgetPerMinute < 1 || config.groupReplyBudgetPerMinute > 1000) throw new Error('invalid_group_reply_budget');
  if (!Number.isInteger(config.globalReplyBudgetPerMinute) || config.globalReplyBudgetPerMinute < 1 || config.globalReplyBudgetPerMinute > 10000) throw new Error('invalid_global_reply_budget');
  if (config.groups.some((group) => !/^[A-Za-z0-9_-]{1,96}@chatroom$/.test(group))) throw new Error('invalid_group_id');
  if ([...config.adminUsers, ...config.protectedUsers].some((id) => !safeId(id))) throw new Error('invalid_user_id');
  return Object.freeze(config);
}

function safeId(value, max = 128) {
  return typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
}

function resolveTarget(candidate, members) {
  if (candidate.randomTarget) return null;
  if (!candidate.targetText) return null;
  const targetText = normalizeSpaces(candidate.targetText);
  const exactId = members.find((member) => member.username === targetText);
  if (exactId) return { member: exactId, matches: [exactId] };
  const matches = members.filter((member) => normalizeSpaces(member.nickname) === targetText);
  return { member: matches.length === 1 ? matches[0] : null, matches };
}

function createGameMarket(options = {}) {
  const store = options.store || createGameMarketStore(options);
  const memberProvider = options.memberProvider || createMemberProvider(options.memberProviderOptions || options);
  const now = options.now || (() => Date.now());
  const random = options.random || Math.random;
  const selections = new Map();
  const selectionLabels = { recruit: '招募', release: '放生', train: '训练', steal: '夺取', rank: '排位' };
  const emptySelectionReplies = {
    recruit: '当前没有可招募的群友。',
    release: '你当前没有可以放生的名下群友。',
    train: '当前没有可以训练的对象。',
    rank: '你当前没有可以排位的名下群友。',
  };
  async function handle(input = {}) {
    const candidate = parseCandidate({ text: input.text, agentName: input.agentName });
    if (!candidate) return { consumed: false, status: 'ignored' };
    let config;
    try { config = validateConfig(input.config || {}); } catch (error) { return { consumed: true, status: 'rejected', code: error.message, reply: '市场配置异常，暂不能操作。' }; }
    const chatId = input.chatWxid;
    const isExit = candidate.command === 'exit';
    if (!safeId(chatId, 108) || !/@chatroom$/.test(chatId) || !safeId(input.senderUsername)) return { consumed: true, status: 'rejected', code: 'untrusted_identity', reply: '身份信息不足，暂不能操作。' };
    const enabledGroup = config.enabled && config.groups.includes(chatId);
    if (!enabledGroup && !isExit) return { consumed: true, status: 'rejected', code: 'market_disabled' };
    if (isExit && !config.groups.includes(chatId)) {
      try {
        if (!(await store.hasState(chatId))) return { consumed: true, status: 'rejected', code: 'market_unknown_group' };
      } catch (error) {
        return { consumed: true, status: 'rejected', code: error.message, reply: '市场账本暂不可用，退出未生效。' };
      }
    }
    if (candidate.command === 'usage') return { consumed: true, status: 'rejected', code: 'invalid_usage', reply: candidate.usage };
    if (candidate.command === 'help') {
      return { consumed: true, status: 'ok', ok: true, code: 'ok', reply: staticHelp(config), mutated: false, marketWrite: false };
    }
    if (candidate.command === 'market-version') {
      return {
        consumed: true,
        status: 'ok',
        ok: true,
        code: 'ok',
        reply: `🎮 小米粒群友市场 ${MARKET_VERSION}\n规则：${RULESET_VERSION}｜内容：${CONTENT_VERSION}｜账本：${CURRENT_SCHEMA_VERSION}\n规则指纹：${RULESET_HASH.slice(0, 12)}\n默认赛制：月榜｜资产不清零`,
        mutated: false,
        marketWrite: false,
      };
    }
    const receivedAt = Number(input.receivedAtMs || now());
    const messageAt = Number(input.timestampSec) * 1000;
    if (candidate.isWrite && !safeId(String(input.localId || ''), 160)) return { consumed: true, status: 'rejected', code: 'missing_message_id', reply: '消息标识缺失，未执行操作。' };
    let snapshot = input.memberSnapshot;
    // 入站群消息已经提供可信的群 ID 和发送者 ID。只有涉及其他人的操作
    // 才依赖完整成员快照，避免成员服务短暂不可用拖垮本人生命周期和银行操作。
    const needsMembers = FULL_MEMBER_COMMANDS.has(candidate.command);
    if (!snapshot && needsMembers) snapshot = await memberProvider.getSnapshot(chatId);
    if (needsMembers && (!snapshot || snapshot.ok !== true || !snapshot.members.some((member) => member.username === input.senderUsername))) return { consumed: true, status: 'rejected', code: 'member_snapshot_failed', reply: '暂时无法确认群成员信息，请稍后重试。' };
    let targetMember = null;
    const selectionKey = `${chatId}\n${input.senderUsername}\n${candidate.command}`;
    const numberMatch = candidate.targetText?.match(/^#([1-9][0-9]?)$/);
    if (numberMatch) {
      const saved = selections.get(selectionKey);
      const index = Number(numberMatch[1]) - 1;
      if (saved && saved.expiresAt >= receivedAt && saved.members[index]
        && snapshot?.members?.some((member) => member.username === saved.members[index].username)) targetMember = saved.members[index];
      else return { consumed: true, status: 'rejected', code: 'selection_expired', reply: '临时编号已失效或服务已重启，请重新发送不带目标的原指令获取新编号。' };
    } else if (snapshot?.ok && candidate.targetText) {
      const resolved = resolveTarget(candidate, snapshot.members);
      targetMember = resolved?.member || null;
      if (!targetMember && resolved?.matches?.length > 1) {
        const shown = resolved.matches.slice(0, 20);
        selections.set(selectionKey, { expiresAt: receivedAt + 60_000, members: shown });
        const rows = shown.map((member, index) => `#${index + 1} ${member.nickname || '群友'}`).join('\n');
        const suffix = resolved.matches.length > 20 ? '\n仅展示前 20 个同名候选。' : '';
        return {
          consumed: true,
          status: 'rejected',
          code: 'target_ambiguous',
          reply: `👥 找到多个同名群友\n有效期：60 秒\n\n${rows}${suffix}\n\n📝 请按编号重发，例如：@小米粒 #${selectionLabels[candidate.command] || '招募'} #1`,
        };
      }
    }
    if (candidate.targetText && !targetMember) return { consumed: true, status: 'rejected', code: 'target_unavailable', reply: '未找到该群成员。' };
    if (!candidate.targetText && ['recruit', 'release', 'train', 'rank'].includes(candidate.command)) {
      let listed;
      try {
        listed = await store.request({
          chatId,
          type: 'candidates',
          payload: {
            command: candidate.command,
            senderId: input.senderUsername,
            memberSnapshot: snapshot,
            protectedUsers: config.protectedUsers,
            now: receivedAt,
            config,
          },
        });
      } catch (error) {
        return { consumed: true, status: 'rejected', code: error.message, reply: storeErrorReply(error.message) };
      }
      const members = Array.isArray(listed?.members) ? listed.members : [];
      if (members.length === 0) {
        return { consumed: true, status: 'rejected', code: 'no_candidates', reply: emptySelectionReplies[candidate.command] };
      }
      if (members.length === 1) targetMember = members[0];
      else {
        const shown = members.slice(0, 20);
        selections.set(selectionKey, { expiresAt: receivedAt + 60_000, members: shown });
        const label = selectionLabels[candidate.command];
        const heading = listed.total > 20
          ? `候选较多，显示最近参与市场的前 20 人`
          : `请选择${label}对象`;
        const rows = shown.map((member, index) => `#${index + 1} ${member.nickname || '群友'}`).join('\n');
        const suffix = listed.total > 20 ? '\n未展示的群友仍可直接输入完整群昵称。' : '';
        return {
          consumed: true,
          status: 'rejected',
          code: 'target_required',
          reply: `🎯 ${heading}\n有效期：60 秒\n\n${rows}${suffix}\n\n📝 发送示例：@小米粒 #${label} #1`,
        };
      }
    }
    const normalized = candidate.normalizedText;
    const digest = crypto.createHash('sha256').update(`${input.senderUsername}\n${normalized}`).digest('hex');
    const readMessageTime = Number.isFinite(messageAt) ? messageAt : receivedAt;
    const payload = {
      ...candidate,
      accountNamespace: String(input.accountNamespace || options.accountNamespace || 'wechat:default'),
      messageId: String(input.localId || `read:${readMessageTime}:${digest.slice(0, 24)}`),
      senderId: input.senderUsername,
      senderName: input.senderName,
      targetId: targetMember?.username || null,
      targetName: targetMember?.nickname || null,
      memberSnapshot: snapshot?.ok ? snapshot : null,
      protectedUsers: config.protectedUsers,
      adminUsers: config.adminUsers,
      confirmationToken: crypto.createHash('sha256').update(`${input.localId || ''}\n${input.senderUsername}\n${receivedAt}`).digest('hex').slice(0, 8),
      digest,
      now: receivedAt,
      messageAt,
      config,
    };
    try {
      const result = await store.request({ chatId, type: 'execute', payload });
      return { consumed: true, status: result.replayed ? 'replay' : (result.ok ? 'ok' : 'rejected'), ...result };
    } catch (error) {
      const code = error.message;
      return {
        consumed: true,
        status: code === 'store_result_unknown' ? 'unknown' : 'rejected',
        code,
        reply: storeErrorReply(code),
      };
    }
  }
  return { handle, close: () => store.close(), inspect: (chatId, config) => store.request({ chatId, type: 'inspect', payload: { now: now(), config: validateConfig(config || {}) } }), store, memberProvider };
}

module.exports = { createGameMarket, createMemberProvider, parseCandidate, validateConfig };
