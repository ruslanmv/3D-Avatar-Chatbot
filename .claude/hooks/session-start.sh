#!/bin/bash
# AX14. Start every Claude Code session ready to work:
#  - in a cloud session, install dependencies once per lockfile change, so the
#    gate (npm run validate) and the lab tools run;
#  - in every session, print the Quality Lab's top next actions, so the session
#    starts knowing what matters (SessionStart output is added to its context).
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}"

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  # Run the install only if a listed file has changed since it last succeeded
  hashes=node_modules/.session-start.sha256
  if ! sha256sum --check --status "$hashes" 2>/dev/null; then
    rm -f "$hashes"
    # npm ci never rewrites package-lock.json (CLAUDE.md: the lockfile is npm 11's)
    npm ci --no-audit --no-fund >&2
    sha256sum .claude/hooks/session-start.sh package.json package-lock.json 2>/dev/null > "$hashes" || rm -f "$hashes"
  fi
fi

# Never fail a session start over the brief: it is advice, not a gate.
node tools/qa/hub.mjs --brief 2>/dev/null || true
