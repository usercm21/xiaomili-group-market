'use strict';

const DAY = 86_400_000;
const HOUR = 3_600_000;

function shanghaiParts(ms) {
  const shifted = new Date(ms + 8 * HOUR);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth(), day: shifted.getUTCDate(), weekday: shifted.getUTCDay() };
}

function shanghaiUtc(year, month, day) { return Date.UTC(year, month, day) - 8 * HOUR; }
function dayId(ms) {
  const p = shanghaiParts(ms);
  return `${p.year}-${String(p.month + 1).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
function monthBounds(ms) {
  const p = shanghaiParts(ms);
  return { id: `${p.year}-${String(p.month + 1).padStart(2, '0')}`, startAt: shanghaiUtc(p.year, p.month, 1), endAt: shanghaiUtc(p.year, p.month + 1, 1) };
}
function weekBounds(ms) {
  const p = shanghaiParts(ms);
  const isoDay = p.weekday === 0 ? 7 : p.weekday;
  const startAt = shanghaiUtc(p.year, p.month, p.day - isoDay + 1);
  return { id: dayId(startAt), startAt, endAt: startAt + 7 * DAY };
}
function eventDefinition(startAt) {
  const slot = ((Math.floor(startAt / (7 * DAY)) % 3) + 3) % 3;
  return [
    { command: 'work', title: '全群打工接力', goal: 20 },
    { command: 'train', title: '全群训练营', goal: 10 },
    { command: 'duel', title: '全群擂台周', goal: 10 },
  ][slot];
}

function createSeason(now) {
  const bounds = monthBounds(now);
  return { ...bounds, hasActivity: false };
}
function createWeekEvent(now) {
  const bounds = weekBounds(now);
  const definition = eventDefinition(bounds.startAt);
  return { ...bounds, ...definition, contributions: {}, participantDays: {}, rewarded: false };
}

function awardHonors(state, season) {
  const rows = [...state.players.values()].filter((p) => Number(p.seasonPoints || 0) > 0)
    .sort((a, b) => b.seasonPoints - a.seasonPoints || a.id.localeCompare(b.id));
  if (!season?.hasActivity || season.invalid || rows.length === 0) return;
  let lastPoints = null;
  let denseRank = 0;
  const awards = rows.map((player) => {
    if (player.seasonPoints !== lastPoints) denseRank += 1;
    lastPoints = player.seasonPoints;
    const badge = denseRank === 1 ? '👑 月度冠军' : denseRank === 2 ? '🥈 月度达人' : denseRank === 3 ? '🥉 月度新星' : '🎖️ 月度参与者';
    return { playerId: player.id, points: player.seasonPoints, rank: denseRank, badge };
  });
  state.honors.unshift({ seasonId: season.id, startAt: season.startAt, endAt: season.endAt, awards });
  state.honors = state.honors.slice(0, 12);
}

function settleEventRewards(state, now = Date.now()) {
  const event = state.weekEvent;
  if (!event || event.rewarded) return false;
  const ids = Object.keys(event.contributions || {}).filter((id) => event.contributions[id] > 0);
  const total = ids.reduce((sum, id) => sum + event.contributions[id], 0);
  if (ids.length < 3 || total < event.goal) return false;
  for (const id of ids) {
    const player = state.players.get(id);
    if (player) {
      player.cosmeticTickets = Number(player.cosmeticTickets || 0) + 1;
      if (!player.achievementStats) player.achievementStats = {};
      player.achievementStats.eventsCompleted = Number(player.achievementStats.eventsCompleted || 0) + 1;
      unlockAchievements(player);
    }
  }
  event.rewarded = true;
  event.completedAt = now;
  return true;
}

function ensureProgressionPeriods(state, now, mutate = true) {
  const month = monthBounds(now);
  if (!state.season) {
    if (mutate) state.season = createSeason(now);
  } else if (state.season.id !== month.id && mutate) {
    // Only a complete, natural calendar month can issue honors.
    const natural = monthBounds(state.season.startAt);
    if (state.season.startAt === natural.startAt && state.season.endAt === natural.endAt && state.season.endAt <= now) awardHonors(state, state.season);
    for (const player of state.players.values()) {
      player.seasonPoints = 0;
      player.buybackCount = 0;
      player.buybackMonthId = month.id;
    }
    state.season = createSeason(now);
  }
  const week = weekBounds(now);
  if (!state.weekEvent) {
    if (mutate) state.weekEvent = createWeekEvent(now);
  } else if (state.weekEvent.id !== week.id && mutate) {
    settleEventRewards(state, now);
    state.weekEvent = createWeekEvent(now);
  }
  const visibleSeason = state.season?.id === month.id ? state.season : createSeason(now);
  const visibleEvent = state.weekEvent?.id === week.id ? state.weekEvent : createWeekEvent(now);
  return { season: visibleSeason, event: visibleEvent };
}

const POINT_COMMANDS = new Set(['work', 'train', 'duel', 'rank']);
const TASK_COMMANDS = new Set(['work', 'train', 'duel']);

function refreshPlayerDay(player, now) {
  const current = dayId(now);
  if (player.progressDayId !== current) {
    player.progressDayId = current;
    player.taskProgress = {};
    player.dailyPointCommands = [];
  }
  if (!Array.isArray(player.dailyPointCommands)) player.dailyPointCommands = [];
  if (!player.taskProgress || typeof player.taskProgress !== 'object') player.taskProgress = {};
  return current;
}

function unlockAchievements(player) {
  const stats = player.achievementStats || {};
  const set = new Set(player.achievements || []);
  if ((stats.work || 0) >= 1) set.add('first-work');
  if ((stats.interactions || 0) >= 1) set.add('social-starter');
  if ((stats.work || 0) >= 10) set.add('hard-worker');
  if ((stats.work || 0) >= 50) set.add('work-50');
  if ((stats.work || 0) >= 100) set.add('work-100');
  if ((stats.activeDays || 0) >= 7) set.add('active-7');
  if ((stats.activeDays || 0) >= 30) set.add('active-30');
  if ((stats.trainWins || 0) >= 10) set.add('train-10');
  if ((stats.duelWins || 0) >= 10) set.add('duel-10');
  if ((stats.eventsCompleted || 0) >= 3) set.add('event-3');
  if ((stats.total || 0) >= 25) set.add('market-regular');
  player.achievements = [...set];
}

function recordSuccessfulAction(state, player, command, now, outcome = {}) {
  ensureProgressionPeriods(state, now, true);
  const currentDay = refreshPlayerDay(player, now);
  let taskBonus = 0;
  let pointAdded = 0;
  if (POINT_COMMANDS.has(command) && !player.dailyPointCommands.includes(command) && player.dailyPointCommands.length < 4) {
    player.dailyPointCommands.push(command);
    player.seasonPoints = Number(player.seasonPoints || 0) + 1;
    state.season.hasActivity = true;
    pointAdded = 1;
  }
  if (TASK_COMMANDS.has(command) && !player.taskProgress[command]) {
    player.taskProgress[command] = true;
    if (!Number.isSafeInteger(player.coins) || player.coins < 0 || player.coins > 9_000_000_000_000 - 10) throw new Error('amount_overflow');
    player.coins += 10;
    taskBonus = 10;
  }
  if (!player.achievementStats || typeof player.achievementStats !== 'object') player.achievementStats = {};
  if (player.achievementStats.lastActiveDay !== currentDay) {
    player.achievementStats.lastActiveDay = currentDay;
    player.achievementStats.activeDays = Number(player.achievementStats.activeDays || 0) + 1;
  }
  player.achievementStats.total = Number(player.achievementStats.total || 0) + 1;
  player.achievementStats[command] = Number(player.achievementStats[command] || 0) + 1;
  if (command === 'train' && outcome.won) player.achievementStats.trainWins = Number(player.achievementStats.trainWins || 0) + 1;
  if (command === 'duel' && outcome.won) player.achievementStats.duelWins = Number(player.achievementStats.duelWins || 0) + 1;
  if (['recruit', 'release', 'train', 'steal', 'buyback', 'duel', 'rank'].includes(command)) {
    player.achievementStats.interactions = Number(player.achievementStats.interactions || 0) + 1;
  }
  unlockAchievements(player);

  const event = state.weekEvent;
  let eventContribution = 0;
  if (event?.command === command && !event.rewarded) {
    const key = `${player.id}:${currentDay}`;
    const today = Number(event.participantDays[key] || 0);
    if (today < 3) {
      event.participantDays[key] = today + 1;
      event.contributions[player.id] = Number(event.contributions[player.id] || 0) + 1;
      eventContribution = 1;
      settleEventRewards(state, now);
    }
  }
  return { taskBonus, pointAdded, eventContribution };
}

function taskText(player, now) {
  const current = dayId(now);
  const progress = player?.progressDayId === current ? player.taskProgress || {} : {};
  const rows = [['work', '完成 1 次打工'], ['train', '完成 1 次训练'], ['duel', '完成 1 次主动决斗']];
  return [`📋 今日市场任务（每项自动奖励 10 虚拟币）`, ...rows.map(([key, label]) => `${progress[key] ? '✅' : '⬜'} ${label}`), `完成：${rows.filter(([key]) => progress[key]).length}/3`].join('\n');
}

const ACHIEVEMENTS = Object.freeze({
  'first-work': '第一桶金：完成首次打工',
  'social-starter': '社交启动器：完成首次群友互动',
  'hard-worker': '市场劳模：累计打工 10 次',
  'work-50': '打工达人：累计打工 50 次',
  'work-100': '打工传奇：累计打工 100 次',
  'active-7': '活跃一周：累计活跃 7 天',
  'active-30': '活跃一月：累计活跃 30 天',
  'train-10': '训练高手：累计训练成功 10 次',
  'duel-10': '决斗高手：累计决斗获胜 10 次',
  'event-3': '群体功臣：参与完成 3 次周事件',
  'market-regular': '市场常客：累计完成 25 次操作',
});
function achievementText(player) {
  if (!player) return '🏅 成就\n尚未建卡，完成一次玩法后开始记录。';
  const unlocked = new Set(player.achievements || []);
  return ['🏅 市场成就', ...Object.entries(ACHIEVEMENTS).map(([id, label]) => `${unlocked.has(id) ? '✅' : '🔒'} ${label}`)].join('\n');
}
function honorText(state, playerId) {
  const own = [];
  for (const season of state.honors || []) for (const award of season.awards || []) if (award.playerId === playerId && !award.redacted) own.push(`${season.seasonId} ${award.badge}（${award.points} 分）`);
  return ['🎖️ 我的月度荣誉', ...(own.length ? own.slice(0, 12) : ['暂无荣誉，完成打工、训练、决斗、排位可积累月积分。'])].join('\n');
}
function eventText(state, now) {
  const { event } = ensureProgressionPeriods(state, now, false);
  const participants = Object.keys(event.contributions || {}).filter((id) => event.contributions[id] > 0);
  const total = participants.reduce((sum, id) => sum + event.contributions[id], 0);
  return [`🎪 本周事件：${event.title}`, `进度：${Math.min(total, event.goal)}/${event.goal}`, `参与人数：${participants.length}/3`, `状态：${event.rewarded ? '已完成，贡献者已获得展示票券' : '进行中'}`, '规则：每人每天最多贡献 3 次，至少 3 人共同完成。'].join('\n');
}

module.exports = { achievementText, dayId, ensureProgressionPeriods, eventText, honorText, monthBounds, recordSuccessfulAction, taskText, weekBounds };
