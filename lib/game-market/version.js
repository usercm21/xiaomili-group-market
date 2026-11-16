'use strict';

const crypto = require('crypto');

const MARKET_VERSION = '1.4.1';
const RULESET_VERSION = '1.4.0';
const CONTENT_VERSION = '1.4.1';
const HISTORY_RESET_VERSION = '1.4.1';
const CURRENT_SCHEMA_VERSION = 2;

// Keep the competitive rules in one canonical, hashable value.  The hash is
// persisted with the ledger so a season can be traced back to the exact rules
// that produced it even when the gateway release changes independently.
const RULESET = Object.freeze({
  bank: { dailyRatePermille: 5, principalCap: 40000, dailyInterestCap: 200, catchupDays: 7 },
  work: { cooldownMs: 3600000, dailyLimit: 5, baseMin: 40, baseMax: 80, valueBonusCap: 20, recruitBonusCapPercent: 30 },
  train: { cooldownMs: 7200000, dailyLimit: 3, successPermille: 700, costMin: 10, costMax: 100, valueGainMin: 5, valueGainMax: 20 },
  recruit: { cooldownMs: 3600000, firstTargetPercent: 95, transferOwnerPercent: 85, transferTargetPercent: 10, valueGain: 5 },
  steal: { cooldownMs: 600000, dailyLimit: 5, actorMinimum: 20, targetMinimum: 10, successPermille: 300, targetPercent: 10, gainCap: 100, failureCost: 20, shieldMs: 7200000, victimDailyLimit: 2 },
  duel: { cooldownMs: 180000, dailyLimit: 10, entryCost: 10, winReturn: 15, valueGain: 2, ratingGain: 2 },
  rank: { cooldownMs: 3600000, dailyLimit: 5, kFactor: 32, winReward: 20 },
  progression: { dailyPointCommands: ['work', 'train', 'duel', 'rank'], dailyPointLimit: 4, dailyTaskReward: 10, weeklyParticipantMinimum: 3, weeklyDailyContributionLimit: 3 },
});

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

const RULESET_HASH = crypto.createHash('sha256').update(canonical(RULESET)).digest('hex');

function safeInt(value, fallback = 0) {
  return Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function ensurePlayerV2(player, now) {
  const dayFields = ['train', 'trained', 'steal', 'stealVictim', 'rank', 'rankParticipant'];
  for (const kind of dayFields) {
    const count = `${kind}DailyCount`;
    if (!Number.isSafeInteger(player[count]) || player[count] < 0) player[count] = 0;
    const day = `${kind}DayId`;
    if (typeof player[day] !== 'string') player[day] = '';
  }
  for (const field of ['lastTrainedAt', 'lastRankParticipantAt', 'recruitLockedUntil', 'stealShieldUntil']) {
    player[field] = safeInt(player[field], 0);
  }
  player.bankInterestCarry = safeInt(player.bankInterestCarry, 0);
  player.seasonPoints = safeInt(player.seasonPoints, 0);
  player.cosmeticTickets = safeInt(player.cosmeticTickets, 0);
  if (!player.taskProgress || typeof player.taskProgress !== 'object' || Array.isArray(player.taskProgress)) player.taskProgress = {};
  if (!player.achievementStats || typeof player.achievementStats !== 'object' || Array.isArray(player.achievementStats)) player.achievementStats = {};
  if (!Array.isArray(player.achievements)) player.achievements = [];
  if (typeof player.progressDayId !== 'string') player.progressDayId = '';
  if (!Array.isArray(player.dailyPointCommands)) player.dailyPointCommands = [];
  if (typeof player.buybackMonthId !== 'string') player.buybackMonthId = '';
  if (!Number.isSafeInteger(player.lastInterestTime) || player.lastInterestTime < 0) player.lastInterestTime = now;
}

function upgradeState(state, now = Date.now(), noReset = true) {
  if (!state || typeof state !== 'object') throw new Error('invalid_market_state');
  if (!state.meta || typeof state.meta !== 'object') state.meta = {};
  const schema = state.meta.schemaVersion == null ? 1 : Number(state.meta.schemaVersion);
  if (!Number.isSafeInteger(schema) || schema < 1) throw new Error('invalid_market_schema');
  if (schema > CURRENT_SCHEMA_VERSION) throw new Error('unsupported_market_schema');
  if (schema === CURRENT_SCHEMA_VERSION
    && (state.meta.rulesetVersion !== RULESET_VERSION || state.meta.rulesetHash !== RULESET_HASH)) {
    throw new Error('unsupported_market_ruleset');
  }

  if (!(state.players instanceof Map)) state.players = new Map(Object.entries(state.players || {}));
  if (!(state.optedOut instanceof Map)) state.optedOut = new Map(Object.entries(state.optedOut || {}));
  if (!Array.isArray(state.honors)) state.honors = [];
  if (!state.season || typeof state.season !== 'object') state.season = null;
  if (!state.weekEvent || typeof state.weekEvent !== 'object') state.weekEvent = null;
  if (typeof state.meta.noReset !== 'boolean') state.meta.noReset = true;
  if (schema < 2) state.meta.noReset = Boolean(noReset);

  for (const player of state.players.values()) {
    ensurePlayerV2(player, now);
    // V1 paid interest into principal.  Starting the V2 clock at migration
    // avoids retroactive interest while preserving every existing bank coin.
    if (schema < 2) {
      player.lastInterestTime = now;
      player.bankInterestCarry = 0;
    }
  }

  state.meta.schemaVersion = CURRENT_SCHEMA_VERSION;
  state.meta.marketVersion = MARKET_VERSION;
  state.meta.rulesetVersion = RULESET_VERSION;
  state.meta.contentVersion = CONTENT_VERSION;
  state.meta.rulesetHash = RULESET_HASH;
  return state;
}

module.exports = {
  CONTENT_VERSION,
  CURRENT_SCHEMA_VERSION,
  HISTORY_RESET_VERSION,
  MARKET_VERSION,
  RULESET,
  RULESET_HASH,
  RULESET_VERSION,
  upgradeState,
};
