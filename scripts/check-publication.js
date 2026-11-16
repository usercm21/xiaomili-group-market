#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const fixed = new Set([
  '.gitignore', 'AGENTS.md', 'CONTRIBUTING.md', 'LICENSE', 'README.md', 'package.json',
  'docs/architecture.md', 'docs/commands.md', 'docs/integration.md',
  'scripts/check-publication.js', 'scripts/sync-from-private.sh', 'tests/run-all.js',
]);
const marketFiles = new Set(['index', 'member-provider', 'progression', 'rules', 'store', 'store-worker', 'version'].map(name => `lib/game-market/${name}.js`));
const tests = new Set(['core', 'member_provider', 'store_regressions', '140_rules', '140_store'].map(name => `tests/test_game_market_${name}.js`));
const allowed = new Set([...fixed, ...marketFiles, ...tests]);
const forbiddenText = [
  /\/Users\/[A-Za-z0-9._-]+\//,
  /(?:authorization\s*[:=]\s*['"]?bearer|(?:api[_-]?key|app[_-]?secret|access[_-]?token)\s*[:=]\s*['"]?)[A-Za-z0-9._-]{24,}/i,
  /\b[0-9]{10,}@chatroom\b/,
];

function walk(dir, prefix = '') {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git') continue;
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isSymbolicLink()) throw new Error(`symlink_forbidden:${relative}`);
    if (entry.isDirectory()) walk(path.join(dir, entry.name), relative);
    else if (entry.isFile()) {
      if (!allowed.has(relative)) throw new Error(`path_not_allowlisted:${relative}`);
      const data = fs.readFileSync(path.join(root, relative));
      if (data.includes(0)) throw new Error(`binary_file_forbidden:${relative}`);
      const content = data.toString('utf8');
      if (forbiddenText.some(pattern => pattern.test(content))) throw new Error(`sensitive_content:${relative}`);
    } else throw new Error(`unsupported_entry:${relative}`);
  }
}

walk(root);
for (const relative of allowed) if (!fs.existsSync(path.join(root, relative))) throw new Error(`required_file_missing:${relative}`);
process.stdout.write(`Publication check passed (${allowed.size} allowlisted files).\n`);
