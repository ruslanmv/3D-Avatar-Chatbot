<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# The wardrobe feature (Try-On Haul)

New outfits for the avatar, from the pack this repository ships or from a
running [3D-Wardrobe-Forge](https://github.com/ruslanmv/3D-Wardrobe-Forge).
Thirty-two modules in `src/wardrobe/`: the original eight behind a floating 👗
drawer (`docs/WARDROBE.md`), eleven that put Try-On inside Together as a tile
and hide the drawer from the moment the page loads — W18: the wardrobe is
reached only through Together ▸ Try-On (`docs/TRY_ON_TOGETHER.md`), three that
make every look an artifact and let a pack be imported
(`docs/WARDROBE_IMPORT.md`), the Settings section that chooses the Forge (WF1),
and three that put her wardrobe in the conversation — the outfit dictionary, the
wardrobe tool and the hosted haul (`docs/WARDROBE_TOOL.md`). **The shipped pack
needs no server, and the project's Hugging Face Forge is the default for
creating looks (WF1)** — see the Forge bullet below.

- **`vendor/wardrobe/` is a verified pack, not a folder you edit (W11).** Ten
  looks, two per bundled avatar, ~137 MB of VRMs made by the Forge's
  `tools/export_default_wardrobe.py`. Change it only with
  `npm run wardrobe:import -- <pack>`; `npm run wardrobe:check` — also a Jest
  test, so `validate` runs it — re-hashes every file, checks each avatar against
  AvatarIdentity's pins, and fails on a file the manifest does not name.
  Provenance is `vendor/wardrobe/provenance.json`; the pack refuses a README
  beside it on purpose.
- **Every source goes through `WardrobePackValidator`, and a look is keyed
  `source:pack:avatar:id` (W11).** The pack carries the same look id for five
  avatars; the old merge by `id` kept one and offered another character's file.
  `WardrobeRegistry` lists sources in order (built-in, imported, Forge) and
  never merges by name. A look is shown only on the avatar it was fitted to —
  per look, not per manifest — and its `rating` can only hide it. The normalized
  look is built from a field list, so a pack cannot carry `depictsAdult` or any
  other permission in.
- **An imported pack is checked whole, kept only on yes, and gated (W14).**
  `WardrobeArtifactImporter` reads the zip (known paths only; only JSON may be
  compressed), validates and hashes everything, and stores it in IndexedDB —
  this browser only. A pack with any non-general look, or an unrated v1 bundle,
  imports only with private mode on, and its looks still show only when Try-On's
  private gate is open for her. Look keys, not ids, identify looks in
  `TryOnSession` and `TryOnView`: an imported look may share a built-in one's id
  on the same avatar.
- **A look that names a SHA-256 is worn as a verified `blob:…#look.vrm` (W11).**
  The fragment is load-bearing: `AvatarManager` picks VRM-or-glTF by the URL's
  extension. The controller revokes the blob on the next wear or restore; a
  mismatch refuses before anything is swapped.

- **The whole feature ends at
  `AvatarManager.setAvatarByUrl(url, name, index)`.** A look is a VRM URL.
  Nothing here touches Three.js, the renderer, or the ambience background — a
  generated outfit loads through the same path the avatar picker already uses,
  which is why the feature adds no rendering code.
- **`WardrobeController` is the only owner of snapshot-and-restore**, and it is
  built whether or not a server is configured (W2). It was previously built only
  for remote generation, so the static deployment — the one that ships — swapped
  avatars without snapshotting, `restore()` answered false, and the drawer
  reported success anyway. Without a server it gets `LOCAL_FORGE`: URLs resolve
  to themselves and anything needing the pipeline refuses with the reason. A
  Try-On Haul over looks already in the bundle therefore works offline.
- **A look is never worn without a snapshot to go back to (W3).** The drawer
  mounts as soon as `avatarManager` exists, which is before the startup avatar
  has loaded; inside that window `getCurrent()` answers null, so a tap recorded
  no original and Restore could never work again. `applyLook` now refuses with
  "Wait for the avatar to finish loading" rather than stranding the user.
- **Forge types `avatar.license.conditionsOfUse` as `dict[str, str]` with a
  default factory, not as optional (W1).** A `null` is a 422 and so is a boolean
  value. Omit the key when there is nothing to say, and send strings — the "I
  have permission" path is exactly the path with no conditions to send, so
  getting this wrong broke only the attestation retry.
- **The thirty `<script>` tags live at the end of `index.html`'s `<body>`, and
  moving them is not free.** The parity harness counts boot scripts by line;
  `node scripts/behavior-parity-baseline.mjs --check` is the check. None of them
  may point into an engine folder (`src/behavior/`, Together's own tree): those
  load only through `boot.js`, which is why the Try-On activity is
  `src/wardrobe/TryOnHaulActivity.js` and not a file among Together's
  activities.
- **Try-On keeps the controller as the only avatar swapper (W4–W9).** Its
  session paces the haul and the controller wears and restores; identity for
  Forge comes from the controller's snapshot of the original avatar, never the
  current look. `tryOnInTogether: false` restores the drawer-only behaviour.
- **Try-On is live play, not select-then-Start (LT1–LT2).** Tapping a look wears
  it; the haul begins (and the controller snapshots) on the first wear. Every
  landed look is a step in `TryOnSession`'s history; a wear that has not landed
  is the _pending_ head and the next tap replaces it, so coalesced taps never
  enter the history — keep that, it is what Undo stands on. Compare swaps the
  VRM without touching the history; favourites are not Keep. Typed text goes
  through `TryOnIntent`, which is pure and decides navigation versus a Forge
  request; "change X" is sent as only the new garment with `baseLookId` when
  Forge made the current look on her library route, and otherwise rebuilt from
  the look's own recipe with only that part rewritten. Turn rotates
  `avatarManager.currentRoot` relative to its load-time yaw and writes that yaw
  back on finish.
- **The Forge is the Hugging Face Space unless someone says otherwise (WF1).**
  `WardrobeConfig.resolveForge` decides, in this order: the page's own
  `NEXUS_WARDROBE_CONFIG` (`forge.baseUrl`, `apiUrl`, or `forge.enabled: false`
  — Settings then shows "Set by this site" and offers no control); the person's
  choice from `Settings ▸ Wardrobe Forge` (`wardrobe_forge_mode` of `default`,
  `custom` or `off`, the URL in `wardrobe_forge_url` — a URL stored there before
  WF1 still counts as custom); then `DEFAULT_FORGE_URL`. A change applies
  without a reload through `WardrobeService.setForge()`, which swaps the client
  and the Forge source but keeps the controller — never rebuild the service to
  switch, that drops the snapshot. `WardrobeForgeSettings.js` owns the section
  (inserted before DEVELOPER, like the YouTube and web-search fields), so
  `main.js` knows nothing about it. The default works because the Space's five
  library avatars hash-match AvatarIdentity's pins and its CORS allows any
  origin; if either changes, Test connection in Settings says so.
- **Her wardrobe is a tool, a fifth instance of the capability pattern
  (W15–W17).** `WardrobeTool` holds the MCP-shaped `TOOLS` and the one executor
  `call`; the chat reaches it with `<wardrobe action="…"/>`, consumed at both
  `displayText` seams and suffixed at all three prompt sites. What she is told
  comes from `OutfitDictionary` (Forge's `GET /v1/outfits`, else
  `assets/wardrobe/outfits.json` — refresh with
  `node tools/wardrobe/sync-outfits.mjs`); ratings are Forge's, and an entry is
  private if its rating _or_ its group says so. Private sets and tattoos reach
  the prompt only while the activity's `privateOpen()` (TryOnPrivate `open`) is
  true. `TryOnConversation` hosts the haul in the chat — her lines from
  `callLLM`, posted with `renderAssistant` + `history().addMessage` + `persist`,
  epoch-checked, scrubbed of directives, and never for a private look or a
  tattoo. Do not let a beat run a directive: that is a loop.
- **Try-On asks Forge for Auto Foundation (MG3).** `TryOnGenerator` sends
  `ensureFoundation: true` on both routes (never on a tattoo-only job). Forge
  then adds a foundation only where she has none and carries it from look to
  look: a seamless tube top and slip shorts, or bralette and briefs on an avatar
  Forge declares adult. It is also what lets a dress VRoid filed as _Tops_
  (Model Girl's) come off under a new skirt instead of the skirt going over its
  hem. Other callers do not send it, so their requests are unchanged.
- **She chooses what she wears underneath, once for the haul (FC1).**
  Customize's _Underneath_ row (beige, nude, white, black, red, pink) stores
  `nexus_tryon_foundation_color` through `TryOnGenerator.setFoundationColor`,
  and every look then sends `foundationColor` with `ensureFoundation`. Forge
  colours the foundation it adds, keeps one in that colour, and replaces one in
  another colour where the new clothes go (a half under clothes she keeps
  changes with them). Nothing chosen sends nothing. Every value must be in
  Forge's vocabulary — anything else is a 422 on every look.
- **What she wears underneath changes colour on her, and only that (FC2).** The
  companion's `<wardrobe action="underneath" color="black"/>` — or the
  "Underneath · White · Change" chip on the current look (W18) — opens
  `TryOnUnderneath`, a pop-up (bottom sheet on a phone, dialog elsewhere) with
  White/Black product cards and more colours as chips, the stylist's pick
  highlighted; the person chooses. `TryOnView.underneath` asks Forge for a
  recolour-only job (no outfit, `baseLookId`, `foundationColor`) so the dress
  and boots come back byte for byte, wears an already-made sibling colour
  instead of asking again, and answers ok only once the VRM has loaded. Her
  prompt hears what she has underneath only for a look Forge made here, and for
  a private look (a dress over adult underwear is rated intimate) only while
  Try-On's private gate is open.
- **Cloth is pushed out of her once a pose settles (SW1).** Skinning alone left
  a bodycon's lap 23 mm inside her thighs in Sitting (Wide); no weighting fixes
  a vertex that bridges two surfaces. `PoseClothCorrection` (pure, tested) runs
  in `PoseClothWorker` via `src/gltf-viewer/PoseClothCorrector.js`, two frames
  after `VRPoseSystem` settles a preset; garments' original positions are
  snapshotted and restored when she moves. `docs/SITTING_WIDE.md` has the
  measurements. SW3: a seam's split vertices are welded and corrected as one
  (corrected apart, the bodycon's seams opened 41 mm), pieces of one Forge node
  share a `group` and are one cloth (a boot's lining went out through its
  shell), and a shoe moves at most `SHOE.maxMove` — behind her knee her skin
  meets itself and there is no outside. Verify a change with Forge's
  `bake_pose_correction.py` + `fit_checks.py --baked`, which run this file on
  the real look; a screenshot cannot show a torn seam.
- **Private mode unlocks private outfits only for avatars Forge declares adult
  (W10).** `TryOnPrivate.evaluate()` answers `off`, `locked` with a sentence, or
  `open` with quick picks. Private mode (`NEXUS_SPICY.isEnabled()`) says the
  _person_ is an adult; whether the _avatar_ depicts one is Forge's
  `depictsAdult` from `GET /v1/library`, set by its operator in
  `assets/library/policy.json`, and Forge checks it again on every job. Never
  make private mode stand in for the avatar's declaration — the two questions
  have different owners.
- The licence terms come from VRM Manager's `vrm_manager_installed` localStorage
  entry, which keeps `conditionsOfUse` through `saveInstalled()`'s strip. A
  source that forbids modification is never overridden — Forge refuses with
  `source_model_modification_not_permitted` and the drawer says so.

## Garment Engine V2 (proposal, not implemented)

Clothing deformation in poses, Forge garments under motion, XPBD cloth: read
`docs/POSE_AWARE_GARMENT_ENGINE_V2_PLAN.md` (architecture and gates),
`docs/CLAUDE_CODE_GARMENT_ENGINE_V2_RUNBOOK.md` (Cut 0 → Cut 4) and
`docs/IMMERSIVE_AVATAR_GARMENT_ENGINE_VISION.md` (north star) first. Each opens
with a dated status block; the pose corrector is still the default and the XPBD
pilot (PR #149) was closed unmerged.
