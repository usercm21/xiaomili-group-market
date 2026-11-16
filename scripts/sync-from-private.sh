#!/usr/bin/env bash
set -euo pipefail

: "${PUBLIC_SOURCE_ROOT:?Set PUBLIC_SOURCE_ROOT to the private Gateway workspace}"
if [[ ! -d "$PUBLIC_SOURCE_ROOT/lib/game-market" || ! -d "$PUBLIC_SOURCE_ROOT/tests" ]]; then
  echo 'Invalid private source root' >&2
  exit 1
fi

public_root="$(cd "$(dirname "$0")/.." && pwd)"
for name in index member-provider progression rules store store-worker version; do
  cp "$PUBLIC_SOURCE_ROOT/lib/game-market/$name.js" "$public_root/lib/game-market/$name.js"
done
for name in core member_provider store_regressions 140_rules 140_store; do
  cp "$PUBLIC_SOURCE_ROOT/tests/test_game_market_$name.js" "$public_root/tests/test_game_market_$name.js"
done

python3 - "$public_root/lib/game-market/member-provider.js" <<'PY'
import pathlib, re, sys
path = pathlib.Path(sys.argv[1])
source = path.read_text()
pattern = r"const DEFAULT_BIN = '/Users/[^']+/datasvc';"
updated, count = re.subn(pattern, "const DEFAULT_BIN = process.env.DATASVC_BIN || 'datasvc';", source)
if count != 1:
    raise SystemExit('Member provider default path changed; review it before publishing')
updated, home_count = re.subn(r"datasvcHome = process\.env\.DATASVC_HOME \|\| '/Users/[^']+',", "datasvcHome = process.env.DATASVC_HOME || './data/db-service',", updated)
if home_count != 1:
    raise SystemExit('Member provider runtime home changed; review it before publishing')
path.write_text(updated)
PY

node "$public_root/scripts/check-publication.js"
(cd "$public_root" && npm test)
echo 'Sync and checks passed. Review the diff, update docs/version, then commit and push with git.'
