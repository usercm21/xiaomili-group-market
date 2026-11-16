'use strict';

const crypto = require('crypto');
const { execFile: nodeExecFile } = require('child_process');

const DEFAULT_BIN = process.env.DATASVC_BIN || 'datasvc';

function createMemberProvider({
  bin = DEFAULT_BIN,
  datasvcHome = process.env.DATASVC_HOME || './data/db-service',
  timeoutMs = 3000,
  ttlMs = 10_000,
  maxConcurrent = 4,
  maxQueued = 64,
  maxBuffer = 2 * 1024 * 1024,
  now = () => Date.now(),
  execFile = nodeExecFile,
  log = () => {},
} = {}) {
  if (!Number.isInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 32) throw new Error('invalid_members_max_concurrent');
  if (!Number.isInteger(maxQueued) || maxQueued < 0 || maxQueued > 1000) throw new Error('invalid_members_max_queued');
  const cache = new Map();
  const inFlight = new Map();
  const waiters = [];
  let active = 0;
  let refreshSequence = 0;

  function acquire() {
    if (active < maxConcurrent) { active += 1; return Promise.resolve(); }
    if (waiters.length >= maxQueued) return Promise.reject(new Error('members_provider_busy'));
    return new Promise((resolve) => waiters.push(resolve));
  }
  function release() {
    active -= 1;
    const next = waiters.shift();
    if (next) { active += 1; next(); }
  }
  function run(groupId) {
    return new Promise((resolve, reject) => {
      execFile(bin, ['members', groupId, '--json'], {
        timeout: timeoutMs,
        maxBuffer,
        env: { ...process.env, DATASVC_HOME: datasvcHome },
        windowsHide: true,
      }, (error, stdout, stderr) => {
        if (error) return reject(new Error(error.killed ? 'members_timeout' : `members_exec_failed:${error.code || error.message}`));
        let data;
        try { data = JSON.parse(stdout); } catch { return reject(new Error('members_invalid_json')); }
        if (data && (data.ok === false || data.success === false || data.error)) return reject(new Error('members_reported_failure'));
        const raw = Array.isArray(data)
          ? data
          : (Array.isArray(data?.members) ? data.members : data?.results);
        if (!Array.isArray(raw) || raw.length === 0) return reject(new Error('members_empty_result'));
        const members = [];
        const seen = new Set();
        for (const item of raw) {
          const username = typeof item?.username === 'string' ? item.username.trim() : '';
          if (!username || username.length > 128 || /[\u0000-\u001f\u007f]/.test(username) || seen.has(username)) continue;
          seen.add(username);
          members.push({
            username,
            nickname: String(item.group_nickname || item.contact_display || item.display || '').replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 32),
          });
        }
        if (!members.length) return reject(new Error('members_no_valid_identity'));
        const fetchedAt = now();
        const material = `${groupId}\n${fetchedAt}\n${++refreshSequence}\n${members.map((m) => m.username).join('\n')}`;
        resolve({ ok: true, groupId, fetchedAt, snapshotId: crypto.createHash('sha256').update(material).digest('hex').slice(0, 24), members });
      });
    });
  }

  async function refresh(groupId) {
    if (typeof groupId !== 'string' || !/^[A-Za-z0-9_-]{1,96}@chatroom$/.test(groupId)) return { ok: false, error: 'invalid_group_id', members: [] };
    if (inFlight.has(groupId)) return inFlight.get(groupId);
    const promise = (async () => {
      let acquired = false;
      try {
        await acquire();
        acquired = true;
        const snapshot = await run(groupId);
        cache.set(groupId, snapshot);
        return snapshot;
      } catch (error) {
        log('warn', `[game-market] members refresh failed: ${error.message}`);
        return { ok: false, groupId, error: error.message, fetchedAt: now(), members: [] };
      } finally {
        if (acquired) release();
      }
    })();
    inFlight.set(groupId, promise);
    promise.finally(() => { if (inFlight.get(groupId) === promise) inFlight.delete(groupId); });
    return promise;
  }

  function getSnapshot(groupId, { force = false } = {}) {
    const saved = cache.get(groupId);
    if (!force && saved && now() - saved.fetchedAt <= ttlMs) return Promise.resolve(saved);
    return refresh(groupId);
  }

  function clear(groupId) { groupId ? cache.delete(groupId) : cache.clear(); }
  function diagnostics() {
    return {
      active,
      queued: waiters.length,
      maxConcurrent,
      maxQueued,
      cachedGroups: cache.size,
      inFlightGroups: inFlight.size,
    };
  }
  return { getSnapshot, refresh, clear, diagnostics };
}

module.exports = { createMemberProvider };
