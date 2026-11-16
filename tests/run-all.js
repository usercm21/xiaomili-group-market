'use strict';

const { spawnSync } = require('node:child_process');
const path = require('node:path');

const files = [
  'test_game_market_core.js',
  'test_game_market_member_provider.js',
  'test_game_market_store_regressions.js',
  'test_game_market_140_rules.js',
  'test_game_market_140_store.js',
];
for (const file of files) {
  const result = spawnSync(process.execPath, [path.join(__dirname, file)], { stdio: 'inherit' });
  if (result.status !== 0) process.exit(result.status || 1);
}
process.stdout.write(`All ${files.length} game-market test files passed.\n`);
