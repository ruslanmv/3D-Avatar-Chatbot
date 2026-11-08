#!/bin/bash
# AX14. Start every Claude Code session ready to work:
#  - in a cloud session, install dependencies once per lockfile change, so the
#    gate (npm run validate) and the lab tools run;
#  - in every session, print the Quality Lab's top next actions, so the session
#    starts knowing what matters (SessionStart output is added to its context).
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}"

# AX15. Node 24 is what package.json requires (engines) and what Vercel builds with. Cloud
# containers ship /opt/node24 but put Node 22 on PATH (npm ci then warns EBADENGINE). Put 24 first
# for this hook and, through $CLAUDE_ENV_FILE, for every command of the session.
if [ -x /opt/node24/bin/node ] && ! node -v 2>/dev/null | grep -q '^v24\.'; then
  export PATH="/opt/node24/bin:$PATH"
  if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
    echo 'export PATH="/opt/node24/bin:$PATH"' >> "$CLAUDE_ENV_FILE"
  fi
fi

if [ "${CLAUDE_CODE_REMOTE:-}" = "true" ]; then
  # Run the install only if a listed file has changed since it last succeeded
  hashes=node_modules/.session-start.sha256
  if ! sha256sum --check --status "$hashes" 2>/dev/null; then
    rm -f "$hashes"
    # npm ci never rewrites package-lock.json (CLAUDE.md: the lockfile is npm 11's; Node 24 brings npm 11)
    npm ci --no-audit --no-fund >&2
    sha256sum .claude/hooks/session-start.sh package.json package-lock.json 2>/dev/null > "$hashes" || rm -f "$hashes"
  fi
fi

# Never fail a session start over the brief: it is advice, not a gate.
node tools/qa/hub.mjs --brief 2>/dev/null || true
