#!/usr/bin/env sh
# Deploy a branch of 3D-Wardrobe-Forge to its Hugging Face Space, wait for the build, and check
# the running Space answers. Reusable: an AI coder deploying later runs this, not a new script.
#
#   HF_TOKEN=hf_... sh audits/deploy/deploy-forge-space.sh                    # ultimate → ruslanmv/3D-Wardrobe-Forge
#   HF_TOKEN=hf_... BRANCH=main sh audits/deploy/deploy-forge-space.sh
#   HF_TOKEN=hf_... HF_SPACE_REPO=you/space FORGE_DIR=../forge sh audits/deploy/deploy-forge-space.sh
#   DRY_RUN=1 sh audits/deploy/deploy-forge-space.sh                          # stage only, upload nothing
#
# What it does, in order:
#   1. a clean checkout of FORGE_REPO at BRANCH (a temporary clone; FORGE_DIR reuses one), so
#      what is deployed is exactly a pushed commit — never a working tree;
#   2. Forge's own deploy/huggingface/deploy.sh (git archive of HEAD, the Space README, a
#      mirrored `hf upload`, the Space variables) — the one script CI runs too;
#   3. waits for the Space to leave BUILDING (up to WAIT_MIN minutes) and reports its stage;
#   4. smoke test: /health, /v1/outfits and /v1/library on the Space's public URL.
#
# The token is read from the environment only and never echoed or written anywhere. A Space
# deploy is a production change: run it only when the person asked for it.
set -eu

: "${HF_TOKEN:?Set HF_TOKEN to a Hugging Face token with write access to the Space}"
export HF_TOKEN
FORGE_REPO="${FORGE_REPO:-https://github.com/ruslanmv/3D-Wardrobe-Forge.git}"
BRANCH="${BRANCH:-ultimate}"
HF_SPACE_REPO="${HF_SPACE_REPO:-ruslanmv/3D-Wardrobe-Forge}"
WAIT_MIN="${WAIT_MIN:-30}"
export HF_SPACE_REPO

command -v hf >/dev/null 2>&1 || python3 -m pip install -q "huggingface_hub[cli]>=0.34"

if [ -n "${FORGE_DIR:-}" ]; then
    WORK="$FORGE_DIR"
    git -C "$WORK" fetch -q origin "$BRANCH"
    git -C "$WORK" checkout -q --detach "origin/$BRANCH"
else
    WORK="$(mktemp -d)"
    trap 'rm -rf "$WORK"' EXIT
    git clone -q --depth 1 --branch "$BRANCH" "$FORGE_REPO" "$WORK"
fi
SHA="$(git -C "$WORK" rev-parse HEAD)"
echo "Forge $BRANCH at $SHA → $HF_SPACE_REPO"

DRY_RUN="${DRY_RUN:-0}" sh "$WORK/deploy/huggingface/deploy.sh"
[ "${DRY_RUN:-0}" = "1" ] && exit 0

python3 - "$HF_SPACE_REPO" "$WAIT_MIN" "$SHA" <<'PY'
import json, sys, time, urllib.request
from huggingface_hub import HfApi

repo, wait_min, sha = sys.argv[1], float(sys.argv[2]), sys.argv[3]
api = HfApi()
deadline = time.time() + wait_min * 60
stage = None
time.sleep(20)  # the upload has to register before the build starts
while time.time() < deadline:
    runtime = api.get_space_runtime(repo)
    stage = runtime.stage
    print(f"  {time.strftime('%H:%M:%S')} {stage}", flush=True)
    if stage in ("RUNNING", "BUILD_ERROR", "RUNTIME_ERROR", "CONFIG_ERROR", "PAUSED", "STOPPED"):
        break
    time.sleep(30)
domains = api.get_space_runtime(repo).raw.get("domains") or []
base = f"https://{domains[0]['domain']}" if domains else None
result = {"space": repo, "forgeSha": sha, "stage": stage, "url": base, "checks": {}}
if stage == "RUNNING" and base:
    for path in ("/health", "/v1/outfits", "/v1/library"):
        try:
            with urllib.request.urlopen(base + path, timeout=60) as r:
                body = json.loads(r.read())
            summary = {"status": r.status}
            if path == "/v1/outfits":
                summary["outfits"] = len(body.get("outfits", []))
            if path == "/v1/library":
                summary["avatars"] = sum(1 for a in body.get("avatars", []) if a.get("available"))
            if path == "/health":
                summary.update({k: body.get(k) for k in ("ok", "version")})
            result["checks"][path] = summary
        except Exception as exc:  # a failed check is reported, not hidden
            result["checks"][path] = {"error": str(exc)[:200]}
print(json.dumps(result, indent=1))
ok = stage == "RUNNING" and all("error" not in c for c in result["checks"].values())
sys.exit(0 if ok else 1)
PY
