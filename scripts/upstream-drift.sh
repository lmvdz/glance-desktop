#!/usr/bin/env bash
#
# upstream-drift.sh — forecast the cost of rebasing this glance-desktop fork onto
# crynta/terax-ai BEFORE doing it. Prints how far behind we are and, crucially, the
# CONFLICT FORECAST: files that BOTH we and upstream changed since the common base —
# the exact set a rebase will make you resolve by hand. See UPSTREAM.md for the runbook.
#
# Usage:
#   scripts/upstream-drift.sh            # human-readable report
#   scripts/upstream-drift.sh --markdown # GitHub-issue body (used by the weekly Action)
#
# Env overrides: UPSTREAM_REMOTE (default: upstream), UPSTREAM_BRANCH (default: main),
#                SKIP_FETCH=1 (assume the remote is already fetched — used in CI).
set -euo pipefail

REMOTE="${UPSTREAM_REMOTE:-upstream}"
BRANCH="${UPSTREAM_BRANCH:-main}"
UP="$REMOTE/$BRANCH"
FORMAT="human"
[ "${1:-}" = "--markdown" ] && FORMAT="markdown"

if [ "${SKIP_FETCH:-0}" != "1" ]; then
  git fetch -q "$REMOTE" "$BRANCH" 2>/dev/null || {
    echo "error: cannot fetch $UP — is the '$REMOTE' remote configured? (see UPSTREAM.md)" >&2
    exit 2
  }
fi

BASE="$(git merge-base HEAD "$UP")"
BEHIND="$(git rev-list --count "HEAD..$UP")"
AHEAD="$(git rev-list --count "$UP..HEAD")"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
git diff --name-only "$BASE" HEAD | sort >"$tmp/ours"
git diff --name-only "$BASE" "$UP" | sort >"$tmp/theirs"
comm -12 "$tmp/ours" "$tmp/theirs" >"$tmp/conflicts"
CONFLICT_N="$(wc -l <"$tmp/conflicts" | tr -d ' ')"

# The registration points the additive fleet module touches upstream files at — the most
# likely conflict sites. If upstream changed any of these, a rebase needs a careful hand.
REG_POINTS='src/app/App.tsx src/app/components/WorkspaceSurface.tsx src/modules/command-palette/commands.ts src/modules/spaces/lib/serialize.ts src/modules/tabs/index.ts src/modules/tabs/lib/useTabs.ts src/modules/tabs/lib/tabLabel.ts src/settings/SettingsApp.tsx src/modules/settings/openSettingsWindow.ts'
reg_hits=""
for f in $REG_POINTS; do
  grep -qxF "$f" "$tmp/theirs" && reg_hits="$reg_hits $f"
done

verdict="CLEAN"
[ "$CONFLICT_N" -gt 0 ] && verdict="CONFLICTS LIKELY"
[ "$BEHIND" = "0" ] && verdict="UP TO DATE"

if [ "$FORMAT" = "markdown" ]; then
  echo "## Upstream drift: $verdict"
  echo
  echo "- Behind \`$UP\`: **$BEHIND** commit(s) · ahead (our work): $AHEAD"
  echo "- Common base: \`${BASE:0:12}\`"
  echo "- Files both sides changed (rebase will conflict here): **$CONFLICT_N**"
  if [ "$CONFLICT_N" -gt 0 ]; then
    echo
    echo "<details><summary>Conflict forecast</summary>"
    echo
    sed 's/^/- `/; s/$/`/' "$tmp/conflicts"
    echo
    echo "</details>"
  fi
  if [ -n "$reg_hits" ]; then
    echo
    echo "⚠️ Upstream touched fleet-module **registration points** — rebase these by hand:"
    for f in $reg_hits; do echo "- \`$f\`"; done
  fi
  echo
  echo "Rebase runbook: \`UPSTREAM.md\`. Regenerate: \`scripts/upstream-drift.sh\`."
else
  echo "upstream drift: $verdict"
  echo "  behind $UP : $BEHIND commit(s)   (we are ahead by $AHEAD)"
  echo "  common base: ${BASE:0:12}"
  echo "  conflict forecast (files both sides changed): $CONFLICT_N"
  if [ "$CONFLICT_N" -gt 0 ]; then
    sed 's/^/    - /' "$tmp/conflicts"
  fi
  if [ -n "$reg_hits" ]; then
    echo "  ⚠️  upstream touched fleet-module registration points:"
    for f in $reg_hits; do echo "    - $f"; done
  fi
fi

# Exit non-zero when a hand-rebase is warranted, so a caller/Action can gate on it.
[ "$CONFLICT_N" -gt 0 ] && exit 1
exit 0
