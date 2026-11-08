# How to create a Private World

A Private World is an existing private place (a world rated `private` in the
catalogue), plus an experience config that names what can happen there. You
write data and measure space; you write no gate and no renderer code. Read
`PRIVATE_WORLD_ENGINE.md` first.

> **Before you start.** Every Private World is off unless the deployment sets
> `NEXUS_PRIVATE_WORLD_CONFIG` with server-attested eligibility. Building one
> does not make it reachable. Do not "test" it by loosening the gate: the tests
> set the gate's answers explicitly, and the browser harness states that it
> simulates the deployment config and the attestation.

## Rules that are not negotiable

- **The world must already be rated `private` in
  `assets/vr-worlds/worlds.json`.** A config cannot make a world private.
  `validateConfig` refuses a world that is not, and you must not change a
  world's rating to make your config pass.
- **Adult characters only.** The avatar is checked against Forge's
  `depictsAdult` at start (`AvatarAdultDeclaration`). Never add a way around it,
  and never author a scene, prop or line that suggests a minor or an
  age-ambiguous character.
- **Non-explicit by default.** The config's `tone` and labels describe the
  room and what can happen in it. Consent levels and ceilings belong to Private,
  not to your config.
- **Nothing is claimed that does not exist.** No sitting, lying down, holding
  objects or touching until a seat-aligned pose or a hand-held prop really
  exists and is confirmed by its owner.

## Steps

### 1. Choose a licensed scene that is already a private world

Use the asset pipeline (`NEXUS_WORLD_ASSET_PIPELINE.md`): glTF/GLB only,
provenance recorded beside the asset, a light variant cut by recipe
(`tools/vr/playground-subsets.json`), and triangles measured. Add the world to
the catalogue with `rating: "private"` and `place: true`, as
`private-cabaret` is. Run `npx jest tests/vr-places.test.js`: a private world
must stay invisible everywhere except a private request from `intimate`.

### 2. Measure its spots

Add the scene to `tools/vr/spot-targets.json`. Each spot has:

- `id`, `label` (en/it), `room`
- `near` (regexes over top-level node names)
- `can` (`stand-near`, `look-at` only)
- `sees` (en/it)
- `rating`

Then run:

```bash
node tools/vr/measure-spots.mjs scenes/<your-scene>.glb
```

A spot that fails is written `verified: false` and is never offered. Do not
type a position: fix the target (`near`) or accept that the spot does not
exist. Measure the light variant too; it is a different file with different
spots. Add the result tables to `NEXUS_SPATIAL_COORDINATES.md` §6 and add the
stem to the spatial test in `tests/engine-docs.test.js`.

### 3. Give the venue a private template

In `src/experiences/playgrounds/PlaygroundTemplateCatalog.js`, a template with
`rating: 'private'` names:

- the chips (kind `clip` for anything she does with her body)
- the anchors she can look at (`at` and `space`)

The router (`PlaygroundInteractionRouter`) answers only for a private world
shown at the `intimate` owner's request.

### 4. Write the experience config

Copy `docs/engine/templates/private-world.example.json` to
`assets/vr-worlds/private/<id>.json`. The fields are exactly:

- `schemaVersion` (1), `id`, `title` (en/it)
- `worlds` (private world ids)
- `template` (a private template id)
- `tone` (en/it, one sentence)
- `interactions`

Each interaction is:

- `id` (`[a-z0-9-]`)
- `kind`: `light` (`preset`, or `null` for the room's own light), `chip` /
  `chip-stop` (`chip`), or `look` (`anchor`)
- `label` (en/it): what the prompt calls it
- `words` (en/it): what the person says to ask for it

Any other field (a rating, a URL, a script, a permission) refuses the whole
config. The page logs one warning and offers nothing.

Today the adapter loads one config, `assets/vr-worlds/private/private-sanctuary.json`.
Loading one per world requires changing `attach()` to pick by world id.

### 5. Prove it

```bash
npx jest tests/private-world tests/vr-places.test.js tests/engine-docs.test.js
npm run validate
node scripts/behavior-parity-baseline.mjs --check
```

Add your config to the "validates against the real catalogue" test. Then walk
it in the real page with the harness pattern in
`docs/qa/PRIVATE_WORLD_EXPERIENCE_EVALUATION.md`, on desktop and a phone
profile:

- the default avatar must be refused
- every interaction must be confirmed
- a hard consent exit must revoke and remove the world

Report SwiftShader numbers as SwiftShader numbers, never as hardware.
