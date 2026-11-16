'use strict';

const crypto = require('crypto');
const path = require('path');
const { Worker } = require('worker_threads');

function safeChatKey(chatId) {
  if (typeof chatId !== 'string' || !/^[A-Za-z0-9_-]{1,96}@chatroom$/.test(chatId)) throw new Error('invalid_chat_id');
  return crypto.createHash('sha256').update(chatId).digest('hex').slice(0, 32);
}

function createGameMarketStore({ rootDir, sqliteBin = '/usr/bin/sqlite3', timeoutMs = 5000, maxPending = 256, reservedExitSlots = 8 } = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 50 || timeoutMs > 120_000) throw new Error('invalid_store_timeout');
  if (!Number.isInteger(maxPending) || maxPending < 1 || maxPending > 100_000) throw new Error('invalid_store_queue_limit');
  if (!Number.isInteger(reservedExitSlots) || reservedExitSlots < 1 || reservedExitSlots > 1_000) throw new Error('invalid_store_exit_reserve');
  const worker = new Worker(path.join(__dirname, 'store-worker.js'), { workerData: { rootDir: path.resolve(rootDir || path.join(__dirname, '..', '..')), sqliteBin } });
  let sequence = 0; let closed = false; let workerFailure = null;
  const pending = new Map();
  worker.on('message', ({ id, result, error }) => {
    const entry = pending.get(id); if (!entry) return;
    pending.delete(id); clearTimeout(entry.timer);
    error ? entry.reject(new Error(error)) : entry.resolve(result);
  });
  worker.on('error', (error) => {
    workerFailure = error;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(error); }
    pending.clear();
  });
  worker.on('exit', (code) => {
    if (!closed && code !== 0) workerFailure = new Error(`store_worker_exit_${code}`);
  });
  function request({ chatId, type = 'execute', payload }) {
    if (closed) return Promise.reject(new Error('store_closed'));
    if (workerFailure) return Promise.reject(workerFailure);
    const isExit = type === 'execute' && payload?.command === 'exit';
    if ((!isExit && pending.size >= maxPending) || (isExit && pending.size >= maxPending + reservedExitSlots)) {
      return Promise.reject(new Error('store_queue_full'));
    }
    const chatKey = safeChatKey(chatId); const id = ++sequence;
    return new Promise((resolve, reject) => {
      const deadlineAt = Date.now() + timeoutMs;
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('store_result_unknown')); }, timeoutMs);
      pending.set(id, { resolve, reject, timer });
      worker.postMessage({ id, chatKey, type, payload: { ...payload, chatKey, chatId, deadlineAt } });
    });
  }
  async function close() {
    closed = true;
    for (const entry of pending.values()) { clearTimeout(entry.timer); entry.reject(new Error('store_closed')); }
    pending.clear();
    await worker.terminate();
  }
  function hasState(chatId) { return request({ chatId, type: 'exists', payload: {} }); }
  return { request, hasState, close, safeChatKey };
}

module.exports = { createGameMarketStore, safeChatKey };
