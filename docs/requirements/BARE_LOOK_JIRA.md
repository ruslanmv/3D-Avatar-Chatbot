# EPIC — Fully undressed ("bare") look in Private at level 4

**Epic key (proposed):** NEXUS-BARE
**Repos:** `ruslanmv/3D-Wardrobe-Forge` (Forge, branch `ultimate`), `ruslanmv/3D-Avatar-Chatbot` (branch `ultimate`)
**Status at writing (2026-11-15):** chatbot side ready (UN7, `f6a3459`); Forge has no bare mode — the reason "I want to see you naked" ends at the least lingerie today.

## Problem

At Private level 4 (Intimate) the person asks "Undress please" and then "I want to see you naked". Today:

- The first request works (the avatar changes into a lingerie set) on `ultimate`. On `master` nothing happens at all: master predates UN1 and has no undressing code.
- The second request cannot be fulfilled: Forge's base-body modes are `preserve`, `replace-outer` and `underwear-base`, and `prepare_base_body.py` states "there is no mode that outputs her with nothing on". The least the wardrobe can show is a complete lingerie set, and the chatbot now says so honestly instead of claiming she is naked.

## Goal

When the person is at level 4, adult access is on, the avatar is declared adult (`depictsAdult`), and they ask to see her naked, the avatar on screen changes to her own bare body — same avatar, same face and proportions, same pose, scene and camera — and the reply says so only after the renderer shows it. Reversible at any time ("get dressed", "go back", Fine/End).

## Facts the design must respect (verified in code)

- VRoid bodies are anatomically featureless: no anatomical detail is modelled under the clothes. "Bare" means her own smooth body.
- Some exports delete the body under clothing (AvatarSample_O: 4 triangles between waist and collar). Forge's BC1 body proxy fills such holes with a featureless patch, today only ever output under underwear.
- Clothing is often painted into the skin texture (AvatarSample A, B, C, Rinna, VRoid Female/Male). SR1 `restore_skin` fills it from the surrounding skin, in the job's working document only.
- `check_body` (body_integrity.py) samples the body band by band and reports regions that are not closed; nothing is generated to fill a gap.
- Forge replaces only the regions a garment covers: a single lingerie piece leaves her own clothes on elsewhere (seen in the real run: string briefs alone kept her cardigan).

---

## FORGE-1 — `bare` base-body mode

**As** the Private experience **I need** Forge to produce the avatar with every garment removed and her skin restored **so that** a bare look exists to show.

Acceptance criteria:

1. New `baseBody` value `"bare"` in `wardrobe/domain/jobs.py` (`base_body: Literal[..., "bare"]`), additive: existing modes, cache keys and outputs unchanged (`tests/unit/test_cache_key_stability.py` stays green, no change to `prebuilt_key_baseline.json` entries).
2. The strip plan covers every garment region (`build_strip_plan` over all detected garments); `remove_garments` removes them; hair, eyes, face and accessories that are not clothing stay.
3. `restore_skin` runs over the whole region (ankles to below the neck) so no painted clothing remains.
4. `check_body` must report every torso, hip and leg band closed **from her authored body**. If any band needs a body proxy (BC1), the job is **refused** with a reason (`body-incomplete-for-bare`), never output with the proxy exposed. (Open question Q1 below if product wants the featureless proxy allowed.)
5. Output is tagged `wardrobeForge.bare = true` and the look records `templateId: "body-bare-v1"`; no garment is generated or added.
6. Gates: the request is accepted only with `includeRestricted`/admin or the adult path already used for private templates, and only for avatars with `depictsAdult: true`. A request for a non-adult avatar is refused (`adult-ineligible`), same as private lingerie.
7. Source bytes untouched; the stripped state never stored except as this look's output.
8. Unit tests: mode accepted/refused per gate; refusal on an incomplete body; output has no garment-tagged primitives and has the `bare` tag; painted-clothing texels removed (reuse `check_painted_skin`).

## FORGE-2 — Catalogue template and prebuild

1. Catalogue entry `body-bare-v1` (name "Bare", category underwear or a new `body` category), `requiresAdult: true`, restricted (never in the public catalogue), no colours (`prebuiltColors: null`).
2. `tools/prebuild.py` builds one bare look per character that passes FORGE-1, and reports the ones refused with their reason.
3. PB7 rules hold: manual-only workflow, keep-existing merge into the dataset (`ruslanmv/3d-wardrobe-garments`), nothing overwritten without the explicit overwrite input.
4. `template_fingerprint` / `ADDED_TEMPLATE_FIELDS` so adding the template changes no existing look's cache key.

## FORGE-3 — Visual QA per character

1. For each of the 8 library characters: front, back, side and three-quarter renders of the bare look, plus the same views of the lingerie set for comparison, saved with the run.
2. Pass when: no clothing left (meshes or painted), no holes or proxy seams visible, skin colour continuous, hair/face unchanged, feet bare (shoes removed) and grounded.
3. A character that fails stays without a bare look (refusal recorded); it is never shipped with defects.
4. Results table (character → built / refused + reason) attached to the ticket.

## CHAT-1 — Private uses the bare look (implemented in UN7; verify end-to-end)

1. `OutfitDecisionEngine.isBare(look)` true for `look.bare === true` or `templateId` starting `body-bare` — **done**.
2. "I want to see you naked" / "get naked" / "strip for me" / "voglio vederti nuda" / es, fr, de, pt, ja, ko, zh → `wardrobe.undress {step:'all', naked:true}` — **done**; "are you naked?", negations, "nude heels", "strip club" are not requests — **done**.
3. With a bare look in her wardrobe: "naked" goes straight to it; one-layer-at-a-time ends on it after the last complete lingerie set — **done (unit)**; **to verify in the real browser once FORGE-2 has data**.
4. The bare look is offered only where the closet is `privateOpen` (adult avatar, Private at level 4) — existing gate; verify.
5. Pose held across the swap (UN5 `keepingPose`), same root yaw, camera unchanged — verify on desktop and 390 px.

## CHAT-2 — Truthful replies (implemented in UN7; keep as regression)

1. No action, a refusal (pace, adult) or a failure (asset not loaded): every claim of undressing — past, present or future — is removed from her reply, and the truth is said once in the app's language.
2. While loading: "I'm naked" is removed; "I'm undressing" may stay.
3. After a change to a look that is not bare: claims of nudity are removed. After the bare look: allowed.
4. Without a bare look in her wardrobe: she says once, warmly, that this is as far as her wardrobe goes.

## CHAT-3 — Reversibility and continuity

1. "Get dressed" / "rivestiti" from the bare look restores what she wore before the first layer came off.
2. "Go back" restores the previous look; repeated changes in one session never lock (pending, stale and cancelled transitions handled — existing tests).
3. Fine/End restores her original appearance.
4. No fade-to-black, no extra approval prompt beyond the existing level-4 gate, no Try-On detour.

## OPS-1 — Deployment

1. Merge chatbot `ultimate` into `master` (fast-forward; carries UN1 undressing, UN7 truthfulness). Without this the reported failure persists on any master build.
2. Deploy Forge with the bare mode to the Space; run the prebuild for the 8 characters (manual workflow, keep-existing).

## Out of scope

- Generating anatomical detail the avatar models do not have.
- Animated sexual acts.
- Any change to ConsentFlow, care mode, the adult declaration or provider policies.

## Open questions

- **Q1.** For characters whose export deleted the body under clothes (BC1), may the featureless proxy be shown in a bare look, or is that character refused? Default in FORGE-1: refused.
- **Q2.** Category: keep the template under `underwear` (no UI change) or add a `body` category (Try-On UI would list it)? Default: `underwear`, restricted, hidden from Try-On's public lists.

## Definition of done

- Forge: FORGE-1/2 merged into Forge `ultimate` with tests green; bare looks in the dataset for every character that passes FORGE-3.
- Chatbot: real-browser run at level 4 — "Undress please" → lingerie on the avatar; "I want to see you naked" → bare look on the avatar, pose kept; "get dressed" → original outfit; Fine → original appearance; reply never ahead of the renderer. Desktop and 390 px.
- `npm run validate` and Forge `pytest` green.
