---
description:
    Add or tune a bare-body variant (Forge body detail, states, extras) and see
    it on her — flat check, preview VRM, the app's viewer, live switching
---

Arguments: `$ARGUMENTS` — what to add or tune (e.g. `state pumped`,
`extra tattoo-mons-rose`, `preset natural`).

The painting lives in **Forge** (`/home/user/3d-wardrobe-forge`, base branch
`ultimate`). Read its `CLAUDE.md` and `docs/qa/BARE_DETAIL.md` first. This
repository only shows the result and switches states live
(`src/wardrobe/SkinStateSwitcher.js`, UN32; the pace mapping and the afterglow
fade are in `src/experiences/private/PrivateActionBridge.js`, UN33).

1. **Change Forge.** A state goes in `assets/body_detail/states.json` (keys in
   `STATE_KEYS`, plus a `body` line), an extra goes in `extras.json` (keys in
   `EXTRA_KEYS`; piercings in `FX.PIERCINGS`, tattoos in `FX.TATTOOS`), and
   anatomy goes in `wardrobe/vrm/body_detail.py` / `skin_effects.py`. Colour and
   relief read the same helper.
2. **Flat check (seconds).** In Forge:
   `.venv/bin/python tools/body_surface/detail_flat.py --base <scratch>/ref-atlas.vrm --out <scratch>/flat --preset natural --states <s> --extras <a+b> --views pelvis,nipple,torso`.
   Look at the PNGs. Stripes and gaps are the fixture's sparse texels.
3. **Preview VRM, then the viewer.** In Forge:
   `.venv/bin/python tools/body_surface/detail_preview.py --out /home/user/3D-Avatar-Chatbot/audits/poses/runs/detail --base <scratch>/ref-atlas.vrm --presets natural --states <s> --extras <a+b>`
   (without `--base`, the first run builds `ref-atlas.vrm` in about five
   minutes). Then here:
   `node tools/qa/body-detail-render.mjs --vrm audits/poses/runs/detail/ref-natural-<s>.vrm --views chest,torso,back`.
   `audits/poses/runs/` is gitignored, so never commit previews.
4. **Tests.** Forge: `.venv/bin/python -m ruff check .` and
   `.venv/bin/python -m pytest tests/unit/test_body_detail.py tests/unit/test_skin_pack.py tests/integration/test_bare_body.py -q`.
   Here:
   `npx jest tests/skin-state-switcher.test.js tests/behavior/private-actions.test.js`,
   then `npm run validate`.
5. **Ship.** Commit `Updates of quality`. The PR title and body are `Updates`
   and the merge commit is `Updates`, into `ultimate` in both repositories.
   Never write a token into a file, commit or log.
