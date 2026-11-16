'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { parentPort, workerData, threadId } = require('worker_threads');
const { emptyState, execute, listTargetCandidates, validateState } = require('./rules');
const { HISTORY_RESET_VERSION, upgradeState } = require('./version');

const rootDir = path.resolve(workerData.rootDir);
const sqliteBin = workerData.sqliteBin || '/usr/bin/sqlite3';
const dataDir = path.join(rootDir, 'data', 'game-market');
const initialized = new Set();
fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
try { fs.chmodSync(dataDir, 0o700); } catch {}

function sqlText(value) {
  return `CAST(X'${Buffer.from(String(value), 'utf8').toString('hex')}' AS TEXT)`;
}

function runSql(dbPath, sql, json = false) {
  return new Promise((resolve, reject) => {
    const child = spawn(sqliteBin, json ? ['-json', dbPath] : [dbPath], { stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`sqlite_${code}:${stderr.trim()}`)));
    child.stdin.end(`.bail on\n.timeout 5000\n${sql}\n`);
  });
}

async function init(dbPath) {
  if (initialized.has(dbPath)) return;
  const initializeSql = `
PRAGMA journal_mode=WAL;
PRAGMA synchronous=FULL;
PRAGMA foreign_keys=ON;
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS players(player_id TEXT PRIMARY KEY, data_json TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS opted_out(player_id TEXT PRIMARY KEY, reason TEXT NOT NULL, exited_at INTEGER NOT NULL, rejoin_not_before INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS processed_requests(account_ns TEXT NOT NULL, chat_id TEXT NOT NULL, message_id TEXT NOT NULL, sender_id TEXT NOT NULL, digest TEXT NOT NULL, result_json TEXT NOT NULL, created_at INTEGER NOT NULL, is_write INTEGER NOT NULL DEFAULT 1, PRIMARY KEY(account_ns,chat_id,message_id));
CREATE INDEX IF NOT EXISTS processed_requests_created ON processed_requests(created_at);
CREATE TABLE IF NOT EXISTS recent_operations(id INTEGER PRIMARY KEY AUTOINCREMENT, player_id TEXT NOT NULL, result_json TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS recent_operations_player_id ON recent_operations(player_id,id DESC);
CREATE TABLE IF NOT EXISTS last_period_ranking(singleton INTEGER PRIMARY KEY CHECK(singleton=1), data_json TEXT NOT NULL);
`;
  for (let attempt = 0; ; attempt += 1) {
    try {
      await runSql(dbPath, initializeSql);
      break;
    } catch (error) {
      if (attempt >= 4 || !/database is locked/.test(error.message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }
  try { fs.chmodSync(dbPath, 0o600); } catch {}
  const check = await query(dbPath, 'PRAGMA quick_check;');
  if (check[0]?.quick_check !== 'ok') throw new Error('sqlite_integrity_check_failed');
  initialized.add(dbPath);
}

function secureDbFiles(dbPath) {
  for (const file of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) {
    try { if (fs.existsSync(file)) fs.chmodSync(file, 0o600); } catch {}
  }
}

async function backupDatabase(dbPath, createdAt, commitSequence) {
  const backupPath = `${dbPath}.backup`;
  const versionedPath = `${dbPath}.backup-${createdAt}-${commitSequence}-${threadId}.sqlite`;
  const tempPath = `${versionedPath}.tmp`;
  try { if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath); } catch {}
  const quoted = tempPath.replace(/'/g, "''");
  await runSql(dbPath, `.backup '${quoted}'`);
  fs.chmodSync(tempPath, 0o600);
  fs.renameSync(tempPath, versionedPath);
  const latestTemp = `${backupPath}.${threadId}.tmp`;
  try { if (fs.existsSync(latestTemp)) fs.unlinkSync(latestTemp); } catch {}
  fs.copyFileSync(versionedPath, latestTemp, fs.constants.COPYFILE_EXCL);
  fs.chmodSync(latestTemp, 0o600);
  fs.renameSync(latestTemp, backupPath);
  const prefix = `${path.basename(dbPath)}.backup-`;
  const versions = fs.readdirSync(path.dirname(dbPath))
    .filter((name) => name.startsWith(prefix) && name.endsWith('.sqlite'))
    .sort()
    .reverse();
  for (const stale of versions.slice(5)) {
    try { fs.unlinkSync(path.join(path.dirname(dbPath), stale)); } catch {}
  }
}

async function query(dbPath, sql) {
  const out = await runSql(dbPath, sql, true);
  return out.trim() ? JSON.parse(out) : [];
}

async function loadState(dbPath, now, config) {
  // One sqlite connection and one read transaction guarantee that all pieces
  // belong to the same WAL snapshot. Parallel sqlite CLI reads could otherwise
  // combine meta from one commit with players from another.
  const snapshotRows = await query(dbPath, `
BEGIN DEFERRED;
SELECT json_object(
  'meta', (SELECT json_group_array(json_object('key',key,'value_json',value_json)) FROM meta),
  'players', (SELECT json_group_array(json_object('player_id',player_id,'data_json',data_json)) FROM players),
  'opted_out', (SELECT json_group_array(json_object('player_id',player_id,'reason',reason,'exited_at',exited_at,'rejoin_not_before',rejoin_not_before)) FROM opted_out),
  'last_period_ranking', (SELECT data_json FROM last_period_ranking WHERE singleton=1)
) AS snapshot;
COMMIT;
`);
  if (!snapshotRows[0]?.snapshot) throw new Error('market_snapshot_unavailable');
  const snapshot = JSON.parse(snapshotRows[0].snapshot);
  const metaRows = Array.isArray(snapshot.meta) ? snapshot.meta : [];
  const playerRows = Array.isArray(snapshot.players) ? snapshot.players : [];
  const outRows = Array.isArray(snapshot.opted_out) ? snapshot.opted_out : [];
  const state = emptyState(now, config.rankingPeriod, config.noReset);
  let extras = null;
  for (const row of metaRows) {
    if (row.key === 'stateExtras') extras = JSON.parse(row.value_json);
    else state.meta[row.key] = JSON.parse(row.value_json);
  }
  state.players = new Map(playerRows.map((row) => [row.player_id, JSON.parse(row.data_json)]));
  state.optedOut = new Map(outRows.map((row) => [row.player_id, { playerId: row.player_id, reason: row.reason, exitedAt: row.exited_at, rejoinNotBefore: row.rejoin_not_before }]));
  state.lastPeriodRanking = snapshot.last_period_ranking ? JSON.parse(snapshot.last_period_ranking) : null;
  if (extras && typeof extras === 'object') {
    state.honors = Array.isArray(extras.honors) ? extras.honors : [];
    state.season = extras.season && typeof extras.season === 'object' ? extras.season : null;
    state.weekEvent = extras.weekEvent && typeof extras.weekEvent === 'object' ? extras.weekEvent : null;
  }
  const loadedSchemaVersion = Number(state.meta.schemaVersion || 1);
  upgradeState(state, now, config.noReset);
  Object.defineProperties(state, {
    loadedSchemaVersion: { value: loadedSchemaVersion, enumerable: false },
    needsSchemaMigration: { value: loadedSchemaVersion < Number(state.meta.schemaVersion), enumerable: false },
    needsHistoryReset: { value: state.meta.historyResetVersion !== HISTORY_RESET_VERSION, enumerable: false },
  });
  return state;
}

function persistScript(state, before, request, result, expectedCommitSequence) {
  const acceptedWrite = Boolean(request.isWrite && result.ok === true && result.mutated === true);
  const marketWrite = Boolean(request.isEconomicWrite && result.ok === true && result.mutated === true);
  const lines = [
    'PRAGMA synchronous=FULL;',
    'PRAGMA foreign_keys=ON;',
    'BEGIN IMMEDIATE;',
    'CREATE TEMP TABLE concurrent_state_conflict_guard(ok INTEGER NOT NULL, CONSTRAINT concurrent_state_conflict CHECK(ok=1));',
    `INSERT INTO concurrent_state_conflict_guard(ok) VALUES(CASE WHEN COALESCE((SELECT CAST(value_json AS INTEGER) FROM meta WHERE key='commitSequence'),0)=${expectedCommitSequence} THEN 1 ELSE 0 END);`,
  ];
  if (state.needsHistoryReset) lines.push('DELETE FROM recent_operations;');
  for (const [key, value] of Object.entries(state.meta)) lines.push(`INSERT INTO meta(key,value_json) VALUES(${sqlText(key)},${sqlText(JSON.stringify(value))}) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json;`);
  const stateExtras = { honors: state.honors || [], season: state.season || null, weekEvent: state.weekEvent || null };
  lines.push(`INSERT INTO meta(key,value_json) VALUES('stateExtras',${sqlText(JSON.stringify(stateExtras))}) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json;`);
  for (const playerId of before.playerIds) {
    if (!state.players.has(playerId)) lines.push(`DELETE FROM players WHERE player_id=${sqlText(playerId)};`);
  }
  for (const player of state.players.values()) {
    const json = JSON.stringify(player);
    if (before.players.get(player.id) !== json) lines.push(`INSERT INTO players(player_id,data_json) VALUES(${sqlText(player.id)},${sqlText(json)}) ON CONFLICT(player_id) DO UPDATE SET data_json=excluded.data_json;`);
  }
  for (const playerId of before.optedOutIds) {
    if (!state.optedOut.has(playerId)) lines.push(`DELETE FROM opted_out WHERE player_id=${sqlText(playerId)};`);
  }
  for (const marker of state.optedOut.values()) {
    const json = JSON.stringify(marker);
    if (before.optedOut.get(marker.playerId) !== json) lines.push(`INSERT INTO opted_out(player_id,reason,exited_at,rejoin_not_before) VALUES(${sqlText(marker.playerId)},${sqlText(marker.reason)},${marker.exitedAt},${marker.rejoinNotBefore}) ON CONFLICT(player_id) DO UPDATE SET reason=excluded.reason,exited_at=excluded.exited_at,rejoin_not_before=excluded.rejoin_not_before;`);
  }
  if (state.lastPeriodRanking) lines.push(`INSERT INTO last_period_ranking(singleton,data_json) VALUES(1,${sqlText(JSON.stringify(state.lastPeriodRanking))}) ON CONFLICT(singleton) DO UPDATE SET data_json=excluded.data_json;`);
  else lines.push('DELETE FROM last_period_ranking WHERE singleton=1;');
  lines.push(`INSERT INTO processed_requests(account_ns,chat_id,message_id,sender_id,digest,result_json,created_at,is_write) VALUES(${sqlText(request.accountNamespace)},${sqlText(request.chatId)},${sqlText(request.messageId)},${sqlText(request.senderId)},${sqlText(request.digest)},${sqlText(JSON.stringify(result))},${request.now},${acceptedWrite ? 1 : 0});`);
  lines.push(`DELETE FROM processed_requests WHERE created_at < ${request.now - 600_000};`);
  if (request.command === 'exit') lines.push(`DELETE FROM recent_operations WHERE player_id=${sqlText(request.senderId)};`);
  const recentResult = { ...result, command: request.command, createdAt: request.now, marketWrite };
  if (marketWrite) {
    lines.push(`INSERT INTO recent_operations(player_id,result_json,created_at) VALUES(${sqlText(request.senderId)},${sqlText(JSON.stringify(recentResult))},${request.now});`);
  }
  lines.push('DELETE FROM recent_operations WHERE id IN (SELECT id FROM (SELECT id,ROW_NUMBER() OVER (PARTITION BY player_id ORDER BY id DESC) AS row_number FROM recent_operations) WHERE row_number>20);');
  lines.push('DELETE FROM recent_operations WHERE id IN (SELECT id FROM recent_operations ORDER BY id DESC LIMIT -1 OFFSET 10000);', 'COMMIT;');
  return lines.join('\n');
}

async function executeRequest(dbPath, payload) {
  if (!Number.isSafeInteger(payload.now) || payload.now < 0) throw new Error('invalid_request_time');
  if (payload.readOnly === true) {
    const state = await loadState(dbPath, payload.now, payload.config);
    validateState(state);
    if (payload.command === 'status' && !state.needsHistoryReset) {
      const recent = await query(dbPath, `SELECT result_json FROM recent_operations WHERE player_id=${sqlText(payload.senderId)} ORDER BY id DESC LIMIT 20;`);
      payload.recentOperation = null;
      for (const row of recent) {
        try {
          const parsed = JSON.parse(row.result_json);
          if (parsed?.ok === true && parsed.marketWrite === true) {
            payload.recentOperation = parsed;
            break;
          }
        } catch {}
      }
    }
    if (payload.command === 'market-records' && !state.needsHistoryReset) {
      const recent = await query(dbPath, `SELECT result_json,created_at FROM recent_operations WHERE player_id=${sqlText(payload.senderId)} ORDER BY id DESC LIMIT 10;`);
      payload.operationHistory = recent.flatMap((row) => {
        try {
          const parsed = JSON.parse(row.result_json);
          return [{ ...parsed, createdAt: Number(parsed.createdAt || row.created_at) }];
        } catch {
          return [];
        }
      });
    }
    if (state.needsHistoryReset) {
      payload.recentOperation = null;
      payload.operationHistory = [];
    }
    const result = execute(state, payload, payload.config, Math.random);
    return { ...result, mutated: false, marketWrite: false, replayed: false };
  }
  const maxCasRetries = 2;
  for (let attempt = 0; attempt <= maxCasRetries; attempt += 1) {
    const prior = await query(dbPath, `SELECT sender_id,digest,result_json FROM processed_requests WHERE account_ns=${sqlText(payload.accountNamespace)} AND chat_id=${sqlText(payload.chatId)} AND message_id=${sqlText(payload.messageId)} LIMIT 1;`);
    if (prior[0]) {
      if (prior[0].sender_id !== payload.senderId || prior[0].digest !== payload.digest) return { ok: false, code: 'idempotency_conflict', reply: '消息标识冲突，操作已拒绝。', replayed: false };
      return { ...JSON.parse(prior[0].result_json), replayed: true };
    }
    if (payload.isWrite && (!Number.isFinite(payload.messageAt) || payload.messageAt < payload.now - 300_000 || payload.messageAt > payload.now + 60_000)) {
      return { ok: false, code: 'stale_message', reply: '消息已过期，未执行操作。', mutated: false, replayed: false };
    }
    if (payload.isWrite && payload.command !== 'exit') {
      const rows = await query(dbPath, `SELECT COUNT(*) AS count FROM processed_requests WHERE is_write=1 AND created_at >= ${payload.now - 600_000};`);
      if (Number(rows[0]?.count || 0) >= payload.config.maxAcceptedWritesPer10Min) {
        return { ok: false, code: 'write_limit', reply: '本群操作较多，请稍后再试。', mutated: false, replayed: false };
      }
    }
    const state = await loadState(dbPath, payload.now, payload.config);
    validateState(state);
    const expectedCommitSequence = Number(state.meta.commitSequence || 0);
    if (!Number.isSafeInteger(expectedCommitSequence) || expectedCommitSequence < 0) throw new Error('invalid_commit_sequence');
    payload.currentCommitSequence = expectedCommitSequence;
    payload.currentPeriodId = state.meta.periodId;
    const before = {
      playerIds: new Set(state.players.keys()),
      players: new Map([...state.players].map(([id, value]) => [id, JSON.stringify(value)])),
      optedOutIds: new Set(state.optedOut.keys()),
      optedOut: new Map([...state.optedOut].map(([id, value]) => [id, JSON.stringify(value)])),
    };
    const result = execute(state, payload, payload.config, Math.random);
    if (state.needsSchemaMigration) {
      await backupDatabase(dbPath, payload.now, expectedCommitSequence);
    }
    if (payload.command === 'admin-reset-confirm' && result.ok === true) {
      await backupDatabase(dbPath, payload.now, expectedCommitSequence);
    }
    state.meta.historyResetVersion = HISTORY_RESET_VERSION;
    state.meta.commitSequence = expectedCommitSequence + 1;
    const committedResult = {
      ...result,
      marketWrite: Boolean(payload.isEconomicWrite && result.ok === true && result.mutated === true),
      transactionId: `${payload.chatKey}:${state.meta.commitSequence}`,
    };
    validateState(state);
    try {
      await runSql(dbPath, persistScript(state, before, payload, committedResult, expectedCommitSequence));
      secureDbFiles(dbPath);
      return { ...committedResult, replayed: false };
    } catch (error) {
      if (!/concurrent_state_conflict/.test(error.message)) throw error;
      if (attempt === maxCasRetries) throw new Error('concurrent_state_conflict');
    }
  }
  throw new Error('concurrent_state_conflict');
}

async function inspect(dbPath, payload) {
  const state = await loadState(dbPath, payload.now || Date.now(), payload.config || { rankingPeriod: 'month', noReset: true });
  return {
    meta: state.meta,
    players: [...state.players.values()],
    optedOut: [...state.optedOut.values()],
    lastPeriodRanking: state.lastPeriodRanking,
    honors: state.honors || [],
    season: state.season || null,
    weekEvent: state.weekEvent || null,
  };
}

async function candidates(dbPath, payload) {
  const state = await loadState(dbPath, payload.now || Date.now(), payload.config || { rankingPeriod: 'month', noReset: true });
  validateState(state);
  const rows = await query(dbPath, `SELECT recent.player_id,recent.result_json,recent.created_at
    FROM recent_operations AS recent
    INNER JOIN (SELECT player_id,MAX(id) AS id FROM recent_operations GROUP BY player_id) AS latest
      ON latest.id=recent.id;`);
  const lastSuccessfulAt = {};
  for (const row of rows) {
    if (lastSuccessfulAt[row.player_id] !== undefined) continue;
    try {
      const result = JSON.parse(row.result_json);
      if (result?.ok === true && result.marketWrite === true) lastSuccessfulAt[row.player_id] = Number(row.created_at) || 0;
    } catch {}
  }
  const members = listTargetCandidates(state, { ...payload, lastSuccessfulAt });
  return { members: members.slice(0, 20), total: members.length };
}

const queues = new Map();
function serialize(chatKey, task) {
  const prior = queues.get(chatKey) || Promise.resolve();
  const next = prior.catch(() => {}).then(task);
  const tracked = next.finally(() => { if (queues.get(chatKey) === tracked) queues.delete(chatKey); });
  queues.set(chatKey, tracked);
  return tracked;
}

parentPort.on('message', ({ id, chatKey, type, payload }) => {
  serialize(chatKey, async () => {
    if (!Number.isFinite(payload?.deadlineAt) || Date.now() >= payload.deadlineAt) throw new Error('store_deadline_exceeded');
    if (!/^[a-f0-9]{32}$/.test(chatKey)) throw new Error('invalid_chat_key');
    const dbPath = path.join(dataDir, `${chatKey}.sqlite`);
    if (!dbPath.startsWith(`${dataDir}${path.sep}`)) throw new Error('unsafe_db_path');
    if (type === 'exists') {
      if (!fs.existsSync(dbPath)) return false;
      const rows = await query(dbPath, "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name='meta';");
      return Number(rows[0]?.count || 0) === 1;
    }
    await init(dbPath);
    if (type === 'inspect') return inspect(dbPath, payload);
    if (type === 'candidates') return candidates(dbPath, payload);
    return executeRequest(dbPath, payload);
  }).then((result) => parentPort.postMessage({ id, result }), (error) => parentPort.postMessage({ id, error: error.message }));
});
