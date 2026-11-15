#!/usr/bin/env sh
# Build every garment and every dictionary outfit for every library character with a local
# Wardrobe Forge, publish each look to the Hugging Face dataset as it finishes, then check the
# dataset really holds what its lists name. Reusable and resumable: run it again after a stop
# and it skips what is already there (Forge answers those from the dataset in ~0.1 s each).
#
#   HF_TOKEN=hf_... FORGE_ADMIN_PASSWORD=... FORGE_DIR=../3D-Wardrobe-Forge \
#       sh audits/deploy/build-wardrobe-dataset.sh
#   VERIFY_ONLY=1 HF_TOKEN=hf_... FORGE_DIR=... sh audits/deploy/build-wardrobe-dataset.sh
#   PLAN_ONLY=1 ...                      # list what would be built, build nothing
#   ONLY=leather SLUGS=fem-vroid,avatar-sample-a ...   # a subset (prebuild.py's own filters)
#   OUTFITS=0 ...                        # garments only, no dictionary outfits
#   OUTFITS_ONLY=1 ...                   # dictionary outfits only, no single garments
#
# What it does, in order:
#   1. uses the Forge checkout at FORGE_DIR as it stands (check out the branch you mean first;
#      new garment templates are built only if that checkout has them);
#   2. starts that Forge on PORT with the dataset as its store, unless one already answers
#      there (a build already running is joined, never doubled);
#   3. opens an admin session (the token goes to a 0600 temp file, never to the terminal);
#   4. runs Forge's tools/prebuild.py over the catalogue and the outfit dictionary, up to
#      PASSES times (a pass that ends with failures is retried: most are a busy worker);
#   5. verifies the dataset: looks, files per look, and for each character how many garment
#      templates and outfits are listed and whether any listed look has no file.
#
# The bare body (body-bare-v1) is never part of this: it is a manual, per-character operator
# build behind Forge's eligibility contract. Publishing to the dataset is a public change: run
# this only when the person asked for it. Exit status: 0 when the dataset is complete and
# consistent, 1 when something is missing (the summary says what).
set -eu

: "${HF_TOKEN:?Set HF_TOKEN to a Hugging Face token with write access to the dataset}"
: "${FORGE_DIR:?Set FORGE_DIR to a 3D-Wardrobe-Forge checkout}"
export HF_TOKEN
DATASET="${DATASET:-ruslanmv/3d-wardrobe-garments}"
PORT="${PORT:-8092}"
FORGE_URL="http://127.0.0.1:$PORT"
STORE="${STORE:-${TMPDIR:-/tmp}/wardrobe-prebuilt-store}"
LOG_DIR="${LOG_DIR:-${TMPDIR:-/tmp}/wardrobe-build}"
PASSES="${PASSES:-3}"
WORKERS="${WORKERS:-2}"
mkdir -p "$LOG_DIR"
cd "$FORGE_DIR"
echo "Forge checkout: $(git rev-parse --short HEAD) ($(git rev-parse --abbrev-ref HEAD))"

verify() {
    DATASET="$DATASET" python3 - <<'PY'
import json, os, sys
sys.path.insert(0, ".")
from huggingface_hub import HfApi, hf_hub_download
from wardrobe.domain.garments import TemplateCatalog
from wardrobe.pipeline import outfit_dictionary

repo, token = os.environ["DATASET"], os.environ["HF_TOKEN"]
files = HfApi(token=token).list_repo_files(repo, repo_type="dataset")
with_vrm = {f.split("/")[1] for f in files if f.startswith("looks/") and f.endswith("/look.vrm")}
garments = {t.id for t in TemplateCatalog.from_directory("assets/garment_templates").all()
            if not getattr(t, "is_body_mode", False)}
outfits = len(outfit_dictionary.OUTFITS)
print(f"dataset {repo}: {len(with_vrm)} looks, {len(files)} files")
print(f"this checkout: {len(garments)} garment templates, {outfits} dictionary outfits")
incomplete = 0
for path in sorted(f for f in files if f.startswith("prebuilt/wardrobes/")):
    listed = json.load(open(hf_hub_download(repo, path, repo_type="dataset", token=token,
                                            force_download=True)))["looks"]
    templates = {i.get("templateId") for i in listed} & garments
    plans = sum(1 for i in listed if i.get("plan") or i.get("outfitId"))
    orphans = sum(1 for i in listed if i.get("lookId") not in with_vrm)
    missing = sorted(garments - templates)
    incomplete += bool(missing) + bool(orphans) + (plans < outfits)
    print(f"  {path.rsplit('/', 1)[-1][:-5]:24} looks {len(listed):4}  garments {len(templates):3}/{len(garments)}"
          f"  outfits {plans:3}/{outfits}  listed without file {orphans}"
          + (f"  missing: {', '.join(missing[:4])}{'…' if len(missing) > 4 else ''}" if missing else ""))
print("COMPLETE" if not incomplete else f"INCOMPLETE: {incomplete} gap(s) above")
sys.exit(1 if incomplete else 0)
PY
}

if [ "${VERIFY_ONLY:-0}" = "1" ]; then
    verify
    exit $?
fi

: "${FORGE_ADMIN_PASSWORD:?Set FORGE_ADMIN_PASSWORD (the Forge admin password, for the full catalogue)}"
if curl -sf "$FORGE_URL/health" >/dev/null 2>&1; then
    echo "a Forge already answers on $FORGE_URL: using it"
else
    echo "starting Forge on $FORGE_URL (store: dataset $DATASET, working copy $STORE)"
    WARDROBE_ADMIN_PASSWORD="$FORGE_ADMIN_PASSWORD" WARDROBE_STORAGE_BACKEND=hf \
        WARDROBE_HF_DATASET="$DATASET" WARDROBE_STORAGE_ROOT="$STORE" \
        nohup python3 -m uvicorn apps.api.main:app --port "$PORT" >>"$LOG_DIR/forge.log" 2>&1 &
    i=0
    until curl -sf "$FORGE_URL/health" >/dev/null 2>&1; do
        i=$((i + 1))
        [ "$i" -gt 120 ] && { echo "Forge did not start; see $LOG_DIR/forge.log" >&2; exit 2; }
        sleep 2
    done
fi

TOKEN_FILE="$(mktemp)"
chmod 600 "$TOKEN_FILE"
trap 'rm -f "$TOKEN_FILE"' EXIT
FORGE_ADMIN_PASSWORD="$FORGE_ADMIN_PASSWORD" python3 - "$FORGE_URL" "$TOKEN_FILE" <<'PY'
import json, os, sys, urllib.request
req = urllib.request.Request(sys.argv[1] + "/v1/admin/session", method="POST",
                             data=json.dumps({"password": os.environ["FORGE_ADMIN_PASSWORD"]}).encode(),
                             headers={"content-type": "application/json"})
open(sys.argv[2], "w").write(json.load(urllib.request.urlopen(req, timeout=60))["token"])
PY

set -- --forge "$FORGE_URL" --admin-token-file "$TOKEN_FILE" --workers "$WORKERS"
if [ "${OUTFITS_ONLY:-0}" = "1" ]; then
    set -- "$@" --outfits-only
elif [ "${OUTFITS:-1}" = "1" ]; then
    set -- "$@" --outfits
fi
[ -n "${ONLY:-}" ] && set -- "$@" --only "$ONLY"
[ -n "${SLUGS:-}" ] && set -- "$@" --slugs "$SLUGS"
if [ "${PLAN_ONLY:-0}" = "1" ]; then
    python3 tools/prebuild.py "$@" --plan-only | tail -3
    exit 0
fi

pass=1
while [ "$pass" -le "$PASSES" ]; do
    echo "=== build pass $pass of $PASSES ($(date +%T)); log: $LOG_DIR/build.log"
    if python3 tools/prebuild.py "$@" --report "$LOG_DIR/report-pass$pass.json" >>"$LOG_DIR/build.log" 2>&1; then
        break
    fi
    pass=$((pass + 1))
done
tail -1 "$LOG_DIR/build.log"
verify
