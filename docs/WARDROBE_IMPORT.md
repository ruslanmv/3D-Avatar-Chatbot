# Wardrobe artifacts: shipping, importing, and an optional Forge

**Artifacts are the product; generation is an optional service.** The app works
completely from the wardrobe pack it ships in `vendor/wardrobe/`. A running
[3D-Wardrobe-Forge](https://github.com/ruslanmv/3D-Wardrobe-Forge) — a Hugging
Face Docker Space, or any host — only adds _creating_ looks. Hugging Face is
never required for the normal wardrobe. Read `docs/WARDROBE.md` and
`docs/TRY_ON_TOGETHER.md` first; this is the contract and the reasons.

## 1. The shape

```
                    WARDROBE UI / TRY-ON
                           │
                 WardrobeService ─ WardrobeRegistry
              ┌────────────┼────────────┐
        BUILT-IN (1)   IMPORTED (2)   FORGE (3)
        vendor/wardrobe  this browser  optional baseUrl
              └────────────┼────────────┘
                 WardrobePackValidator
                           │
                    normalized Look
                           │
                 WardrobeController ── the only swapper
                           │
                    AvatarManager
```

**A look is an artifact. Where it came from must not matter after
validation.** Every source hands its manifest to `WardrobePackValidator` and
gets back the same normalized look; nothing downstream learns a second shape.
`WardrobeController` never knows whether a look was generated.

## 2. What ships, measured

| | |
| --- | --- |
| Pack | `homepilot-default` 2026.09.27, schema 2, `visibility: public` |
| Looks | 10: two everyday looks for each of the five bundled avatars (AvatarSample A/B/C, fem/masc VRoid) |
| Size | ~137 MB — a look is a whole avatar, 12–15 MB, until garment packs (W15) |
| Made by | `tools/export_default_wardrobe.py --web-previews` in the Forge; every fit passed, every look `general` |
| Provenance | `vendor/wardrobe/provenance.json`: generator, version, recipe, prompt, garments, source hash |
| Licence | CC0-1.0, derived from the CC0 bundled avatars |

Recipes were chosen by render as well as fit: a blazer passed its fit check and
read as a black sack, so it is not in the pack.

## 3. The contract: wardrobe pack v2

```jsonc
{
  "schemaVersion": 2,
  "pack": { "id": "homepilot-default", "version": "2026.09.27",
            "generatedBy": "3D-Wardrobe-Forge", "generatorVersion": "0.2.0", "createdAt": "…Z" },
  "sourceName": "HomePilot",
  "visibility": "public",                      // "private" when any look is above general
  "avatars": [{ "avatarId": "avatar-sample-a", "name": "AvatarSample A",
                "sourceSha256": "b86b…", "license": { "spdx": "CC0-1.0" } }],
  "looks": [{
    "id": "crop-top-jeans", "name": "Crop top & jeans", "avatarId": "avatar-sample-a",
    "vrmUrl": "looks/avatar-sample-a/crop-top-jeans/2026.09.27/look.vrm",
    "sha256": "…", "bytes": 15285400,
    "previewUrl": "looks/…/preview.webp", "previewSha256": "…", "previewBytes": 9182,
    "tags": ["casual", "denim", "day"], "rating": "general",
    "fit": { "avatarId": "avatar-sample-a", "quality": "verified", "clipping": "passed" },
    "provenance": { "generator": "3D-Wardrobe-Forge", "recipeId": "crop-top-jeans@2026.09.27", "prompt": "…" },
    "license": { "spdx": "CC0-1.0", "derivedFrom": "avatar-sample-a" }
  }]
}
```

Each field prevents a failure:

| Field | Prevents |
| --- | --- |
| `pack.id` + look `id` + `avatarId` | two avatars' "crop-top-jeans" merging into one. Looks are keyed `source:pack:avatar:id`, never by name |
| `sha256`, `bytes` | a corrupted, truncated or swapped file reaching Three.js |
| `avatars[].sourceSha256` | a look fitted to one file offered on a different version of that avatar |
| `rating` | nothing — it can only **hide**. Unknown ratings count as `intimate` |
| versioned paths | a release overwriting a file an older manifest names; a rollback is the old manifest |
| `license`, `provenance` | licence and origin living in someone's memory instead of beside the file |

v1 manifests still read: missing fields take the safe default, and a v1 look
with no owner belongs to anyone, as before.

## 4. Trusted and untrusted metadata

A pack may **describe** a look: name, tags, preview, colour, style. It may
never **grant** anything. The normalized look is built from a list of fields,
never by copying, so `depictsAdult`, `trusted`, `private` or any other claim a
file makes about permissions is not carried at all (a test asserts it). Whether
a non-general look shows is the app's own decision — private mode on _and_ the
avatar declared adult by its owner (W10, `TryOnPrivate`) — and nothing in a pack
feeds it.

| Source | Unrated looks count as | Why |
| --- | --- | --- |
| Built-in | general | this repository's own, checked by `wardrobe:check` |
| Forge | general | Forge gates on its side and hides private looks from everyone but an admin |
| Imported | swimwear (gated) | untrusted |

## 5. Validation — the one boundary

`src/wardrobe/WardrobePackValidator.js` (browser and Node):

- schema supported; manifest shape; ≤ 500 looks
- ids safe and unique per avatar
- URLs: relative and under the pack folder, or `https:`; no `javascript:`,
  `data:`, `blob:`, `..` (encoded or not), backslashes or protocol-relative
- a v2 look must name its SHA-256; size limits (VRM 60 MB, preview 2 MB)
- at wear time (`fetchVerified`): size, SHA-256, binary glTF header, a VRM
  humanoid with hips — then the loader gets a `blob:…#look.vrm` URL, so the
  file is never downloaded twice and a mismatch refuses before anything is
  swapped

`scripts/wardrobe-pack.cjs` adds what only the shipped pack must satisfy:
public; every avatar one of this app's five, byte for byte (AvatarIdentity's
pins); every file named by the manifest and none extra; zip entries safe
(no absolute paths, `..`, symlinks, unknown file types, encryption).

## 6. Build-time import is canonical

```bash
npm run wardrobe:import -- <pack folder or .zip> [--dry-run]
npm run wardrobe:check
```

Import checks everything, writes beside the old folder and swaps with two
renames; a failure changes nothing. `wardrobe:check` changes nothing and is also
a Jest test, so `npm run validate` fails on a bad pack. Nobody copies files into
`vendor/wardrobe/` by hand.

## 7. Importing in the browser (W14)

Try-On ▸ _＋ Import wardrobe pack_ (and _Import pack_ in the drawer) takes a zip —
the Forge Studio's _Export pack_, or `GET /v1/wardrobes/{avatar}/pack.zip`. It is
checked whole before anything is kept: zip entries (known paths only, no `..`,
symlinks, encryption, and only JSON may be compressed — a compressed model is
the zip-bomb shape), the manifest through the validator, every file's hash and
VRM humanoid, every preview's image header. The person then reads what it is —
how many looks, for which avatars, verified or not, the licence, how many are
private — and nothing is stored until they say yes. It lives in this browser's
IndexedDB and is served from object URLs; _Remove_ deletes it.

- A pack with any look above `general` — and an older v1 bundle, whose looks are
  unrated — imports only while private mode (18+) is on. Importing is not
  showing: those looks appear only when Try-On's private gate is open for the
  avatar she is (private mode _and_ her owner's declaration, W10).
- A v1 bundle is marked unverified; its hashes are taken at import, so it cannot
  change afterwards.

## 8. The optional Forge

```js
window.NEXUS_WARDROBE_CONFIG = {
    enabled: true,
    staticManifest: '/vendor/wardrobe/wardrobe.json',
    forge: { enabled: true, baseUrl: 'https://ruslanmv-3d-wardrobe-forge.hf.space' },
};
```

A Forge is a `baseUrl`, not a provider: Hugging Face, Cloud Run, a private
server or localhost read the same. `forge.enabled: false` means none, whatever
an older `apiUrl` or a stored URL says. **No key belongs in a page**: a public
Forge trusts yourfriend.online by origin (Forge F5), limits job creation (F1),
and a private one sits behind the reference proxy (F4). The integration contract
is `docs/TRY_ON_INTEGRATION.md` in the Forge.

A Space's disk is ephemeral: a created look worth keeping is exported as a pack
and imported, where it becomes an artifact with a hash. Job storage is never the
catalogue.

## 9. Build order

| Batch | Repo | What | State |
| --- | --- | --- | --- |
| W11 | chatbot | Validator, registry, per-avatar listing, verified wear, `wardrobe:import` / `wardrobe:check`, shipped pack | done |
| W12 | Forge | pack v2 (`wardrobe/targets/pack.py`), `tools/export_default_wardrobe.py` | done |
| F1–F4 | Forge | job-creation limits, integration contract, reference proxy | done |
| W13 | chatbot | Forge source: health check, cold-start state, capability-driven UI | next |
| W14 | both | _Import wardrobe pack_ in Try-On and the drawer (`WardrobeArtifactImporter`, IndexedDB, remove); Forge `pack.zip` export and Studio "Export pack" | done |
| W15 | both | garment packs: the garments alone (~300 KB) attached to the avatar already loaded | later |

## 10. What not to do

- Don't copy files into `vendor/wardrobe/` by hand; import a pack.
- Don't let a manifest field enable anything; it may only hide.
- Don't merge looks by id or name across avatars or sources.
- Don't bypass `WardrobeController` to load a look.
- Don't put a Forge key in a page or in `NEXUS_WARDROBE_CONFIG`.
- Don't name a provider in the client (`huggingFace: true`); name a URL.
