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
