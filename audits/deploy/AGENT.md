# Deploying 3D-Wardrobe-Forge to its Hugging Face Space

Run `audits/deploy/deploy-forge-space.sh`; do not write a new deploy script.

```bash
HF_TOKEN=hf_... sh audits/deploy/deploy-forge-space.sh
```

- Defaults: Forge branch `ultimate`, Space `ruslanmv/3D-Wardrobe-Forge`.
  Override with `BRANCH`, `HF_SPACE_REPO`, `FORGE_REPO`, `FORGE_DIR` (an
  existing checkout), `WAIT_MIN`.
- `DRY_RUN=1` stages exactly what would be uploaded and stops.
- It deploys a pushed commit (a fresh clone), through Forge's own
  `deploy/huggingface/deploy.sh`, waits for the build, then checks `/health`,
  `/v1/outfits` and `/v1/library` on the running Space and prints the result as
  JSON. Exit 0 only when the Space is RUNNING and every check passed.
- A deploy changes production: only when the person asked. Never put the token
  in a file, a commit or a log; if one was pasted into a conversation, tell the
  person to revoke it.
- The Space reads the prebuilt dataset with `WARDROBE_STORAGE_BACKEND=hf`; since
  RU3 it also publishes looks it makes, which needs its `HF_TOKEN` secret to
  have write access to the dataset (set in the Space's settings, not by this
  script).
- The companion app (this repository) is a static site; it is not part of this
  Space.

## Building the wardrobe dataset

`build-wardrobe-dataset.sh` builds every garment and dictionary outfit for every
library character with a local Forge and publishes each look to the Hugging Face
dataset, then verifies the dataset (looks, files per look, per-character
coverage, listed looks without a file).

```bash
HF_TOKEN=hf_... FORGE_ADMIN_PASSWORD=... FORGE_DIR=../3D-Wardrobe-Forge \
    sh audits/deploy/build-wardrobe-dataset.sh
```

```bash
VERIFY_ONLY=1 HF_TOKEN=hf_... FORGE_DIR=../3D-Wardrobe-Forge sh audits/deploy/build-wardrobe-dataset.sh
```

It is resumable (what exists is skipped), joins a Forge already running on the
port instead of starting a second one, and takes `ONLY`, `SLUGS`, `OUTFITS=0`
and `PLAN_ONLY=1`. New garment templates are built only if the Forge checkout
has them, so check out the branch you mean first. Never run two builds against
the same dataset at once: both merge the wardrobe lists. The bare body is not
part of it.
