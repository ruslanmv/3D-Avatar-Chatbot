# Clothed wardrobe acceptance: four more characters, scenes, and what the runs found

2026-11-16. Chatbot `claude/busy-hamilton-m2vq2f` on `ultimate` @ `dd0cf1f`. Real Chromium
(SwiftShader), the real renderer, real VRM files. No Forge was contacted and nothing was deployed.

The first acceptance run (`docs/qa/BODY_STATE_ACCEPTANCE.md`) covered AvatarSample A, in Private,
with one imported state. This extends the same checks to the other four characters that ship with
looks of their own, with **clothed, general-rated** looks only: the two per character in the
verified pack (`vendor/wardrobe`, W11), which Forge fitted to each character's exact bytes.

## 1. The matrix: 4 characters x 2 viewports x 2 languages

`node tools/qa/wardrobe-clothed-acceptance.mjs --matrix` — **16 runs, 16 pass**. The full table is
`docs/qa/wardrobe-clothed/matrix.md` (and `matrix.json`, with every file hash and every
screenshot's SHA-256).

| Check | What is compared | B | C | VRoid Female | VRoid Male |
|---|---|---|---|---|---|
| File integrity (SHA-256) | her file = `AvatarIdentity` pin = pack `sourceSha256`; each look = pack `sha256` and size; and in the page, the bytes the renderer loaded hash to the same values (original, look 1, look 2, restored) | pass | pass | pass | pass |
| Correct asset selection | the page loaded her file; Try-On offers her two looks and no other character's; the look worn is the one tapped, fitted to her | pass | pass | pass | pass |
| Actual loaded renderer root | the manager's file is the controller's verified `blob:`; the root changed, is in the scene and visible; the picture changed | pass | pass | pass | pass |
| Skeleton retention | 54 humanoid bones on the same node names as her own file | pass | pass | pass | pass |
| Expression retention | the same expression names (15 for B, 14 for the others) | pass | pass | pass | pass |
| Face and hair preservation | every face and hair mesh: same name, vertex count, morph count and position hash (87 / 128 / 7 / 7 meshes) | pass | pass | pass | pass |
| Original outfit restoration | End: her own file is the renderer's root, no look recorded, same character, same bytes | pass | pass | pass | pass |
| Cancellation | End while look 1 is held in the network: it never reaches the renderer; she is on her own file | pass | pass | pass | pass |
| Stale request handling | look 1 held, then look 2 asked for again, then look 1 released: look 1 never reaches the renderer | pass | pass | pass | pass |
| Failed download rollback | 503 for look 1 while she wears look 2: nothing loaded, look 2 stays, same root | pass | pass | pass | pass |
| Tampered bytes | one byte changed in transit: refused before the loader, look 2 stays | pass | pass | pass | pass |
| Camera unmoved | camera position identical across every wear and the restore | pass | pass | pass | pass |
| Desktop 1440x900 / 390 px | no horizontal overflow at any step; the phone viewport is 390 px wide | pass | pass | pass | pass |
| English / Italian | the stage's strings are the locale's (`+ More` / `+ Altro`, `Try …` / `Prova …`) | pass | pass | pass | pass |
| No Forge request, no page errors | no request to any Forge; no uncaught error | pass | pass | pass | pass |

Each cell is all four runs of that character (desktop EN, desktop IT, phone EN, phone IT).

Looks worn: B and VRoid Female, `crop-top-jeans` and `maxi-sundress`; C and VRoid Male,
`tee-trousers` and `tee-jeans`.

### What the driver does as a person, and what it does not

- Wearing a look is a real tap on its card in the look rail.
- Opening Try-On is `panel.startActivity('try-on-haul')`, what the Together tile calls.
- Ending the haul was `panel.stopActivity('user')`, what Together's Stop calls, in all 16 runs
  (`endedBy: together-stop`): Try-On's own End button is inside the folded panel and was not
  reached by the driver.
- The stale request is forced. The rail disables itself while a look loads (seen in all 16
  runs), so a person cannot tap a second look there; the driver re-enables that one button and
  clicks it, standing in for the typed box and her wardrobe tool, which can still ask.
- Screenshots are at device scale 1 (SwiftShader renders 16 runs in about 45 minutes that way).

### Evidence

- `docs/qa/wardrobe-clothed/<character>.jpg`: for each character, desktop EN then phone IT:
  look 1, look 2, look 2 kept after the failed download, look 2 kept after the stale request.
- The QA output directory, `audits/wardrobe/runs/2026-11-16-clothed-matrix/` (128 PNGs, 22 MB,
  not committed): every step of every run, with `report.json` per run. `matrix.json` lists each
  screenshot by SHA-256. The frames of her own outfit are there and not in the committed sheets:
  VRoid Female and VRoid Male are the VRoid base bodies, whose authored outfit is their default
  underwear, and the committed evidence is kept to the clothed looks.

## 2. Scenes: the wardrobe across a Private evening's places

`node tools/qa/wardrobe-scene-acceptance.mjs` — AvatarSample A, the `romantic` style, the pace
never touched, clothed pack looks, **every action through `PrivateActionBridge`** (her words).

| Check | Desktop IT | Phone EN |
|---|---|---|
| Session start: her pinned file, nothing worn | pass | pass |
| Wear through the bridge: "Mettiti i jeans" / "Put on the jeans" → her clothed pack look (`crop-top-jeans`), verified bytes, renderer root; the pace did not move | pass | pass |
| Scene navigation: invited, yes, `nexus-world-shown` for the destination, requested through the Private channel | pass (cabaret → apartment) | pass (cabaret → hotel suite) |
| Outfit travels with her: same look, same renderer root, no model load during the trip | pass | pass |
| Existing destinations: the destination the outline names is the same before and after an outfit | pass | pass |
| Stale request: the other look held and asked for, then the jeans again: the held look never reaches the renderer | pass | pass |
| Pending load cancelled: the session ends while a look is held: it never reaches the renderer | pass | pass |
| Session end restores her: her own file, nothing recorded | pass | pass |
| Place handed back; no horizontal overflow; no page errors | pass | pass |

Evidence: `docs/qa/wardrobe-clothed/scenes-avatar-sample-a.jpg` (desktop IT above, phone EN
below: opening, jeans, arrived in the next place in jeans, the stale request, the session ended).
Reports and full-size frames: `audits/wardrobe/runs/2026-11-16-scenes/` (not committed).

The places themselves were not touched by any of this work. Their own audit,
`tools/qa/una-notte-travel-audit.mjs --size desktop --lang it-IT`, run unchanged on this branch:
**0 failed checks**.

## 3. What the runs found, and what changed

Three defects, each reproduced in the browser before it was fixed, each with Jest tests.

**LT10a. A superseded look still reached the renderer (Try-On).** `TryOnSession` let the load
in flight finish before turning to the newest target: tap one look and then another and the
first still downloaded its 15 MB, appeared, and was replaced by a second full load. `_go` now
cancels the wear in flight (BI3's `controller.cancel()`); the loop already reads a cancelled wear
as "she kept what she had on". First matrix run, before the fix: *"Stale request handling: the
superseded look reached the renderer (1 loads)"*.

**LT10b. Ending the haul waited for the look it should have stopped (Try-On).** `_end` awaited
the pending wear, so a look landed after the person had closed Try-On and only then was her own
outfit loaded back over it. It now cancels first. Before the fix: *"Cancellation: the cancelled
look reached the renderer (1 loads)"*.

**LT10c. In Private, a replaced look was shown and then undone.** `InSceneWardrobe` took a late
result off again after it had landed. In Private the look in flight can be a state the person
has just asked to leave. The bridge now stops the earlier wardrobe action's wear when a newer
one takes over (`InSceneWardrobe.cancelPending()`), and that call ends `stale`, not `failed`.
First scene run, before the fix: *"Stale request handling: the superseded look reached the
renderer (1 loads)"*.

**LT10d. Back to a look the session had just cancelled (found in review of LT10a).** One look,
then another, then the first again before the first cancellation had settled: the rejection of
the cancelled wear arrived when that look was the target once more, the loop read it as
somebody else stopping the look and gave up: her own outfit on stage, the session naming the
look, no error. The session now notes which wear it cancelled itself and starts that look again
when it is still the one wanted; a wear somebody else cancels is still given up. Reproduced in
Jest with the real controller before the fix (not in the browser matrix, which was not re-run).

Tests: `tests/wardrobe/try-on-session-cancel-lt10.test.js` (8, with the real controller),
`tests/private-world/wardrobe-supersede-lt10.test.js` (4).

## 4. Account-scoped access, the app's half (BI5)

Forge AC1 (`docs/ACCOUNT_ACCESS.md` there) issues a signed-in account a capability: the BI2 read
grant bound to that account and its avatars, at most 15 minutes. In this repository:

- **No long-lived grant from public configuration.** `NEXUS_WARDROBE_CONFIG.forge.grant` is
  served to every visitor. `WardrobeConfig.siteGrant` honours it only when its own claims say it
  lives at most 15 minutes; a longer one (an operator grant lasts up to 30 days) or an unreadable
  one is refused, once, in the console, without logging the grant. The grant a person pastes into
  Settings on their own device is not judged by this rule.
- **`forge.capabilityUrl`**: an endpoint of the site's own server. `WardrobeClient.currentGrant()`
  asks it for a capability for the avatar on stage (`POST {avatars: [slug]}`, same-origin
  cookies, `no-store`), keeps it in memory only, renews it a minute before it expires, and sends
  it as `X-Wardrobe-Grant` to the configured Forge and to look downloads on that origin only. A
  capability that cannot be had is not an error: private looks are simply not listed.

Tests: `tests/wardrobe/wardrobe-capability-bi5.test.js` (11). **Outstanding:** the site's
server endpoint, and the identity provider behind it, do not exist in either repository; with
no `capabilityUrl` configured the app behaves exactly as before.

## 5. This app's clients against a Forge built from the same session's branch

`node tools/qa/forge-contract-check.mjs --forge http://127.0.0.1:8093 --admin-password-file … --identity-secret-file …`
runs the page's own `WardrobeClient` and `ForgeLibraryClient` (the same files, in Node) against
a local Forge started from Forge `claude/busy-hamilton-m2vq2f` (WD1 withdrawal, AC1
capabilities, KL3 fitting): **18 checks, 18 pass.**

| Check | Result |
|---|---|
| `GET /v1/library` lists her with her pinned hash; `GET /v1/wardrobes/{slug}` answers `looks[]`; no private look to a public caller | pass |
| A clothed look made on the library route as `TryOnGenerator` asks (`blue straight jeans`, `ensureFoundation`) for AvatarSample B: completed, valid VRM, rig, weights, skeleton, clipping passed | pass |
| Her kept top: the fit report's `keptTopTuck` is the current rules (`version 3`, `noRoom 0`) | pass |
| The look downloads as a GLB (16.1 MB); her wardrobe then lists it | pass |
| `GET /v1/access` says whether capabilities are issued; a made-up grant changes nothing; no identity, no capability (401) | pass |
| An operator grant is accepted; it goes to a download on that Forge and to no other origin | pass |
| Through a stand-in for the site's `forge.capabilityUrl`: the client is issued a capability for the avatar on stage, bound to the account, 300 s; Forge accepts it; the site is asked once for two requests | pass |
| The account is revoked: it is issued nothing, and the wardrobe still answers | pass |

In checks 6 to 8 the script plays the operator and the site's server (it holds the admin
password and the identity secret of a local Forge); the page never does. Not run against the
deployed Space.

## 6. The gate

`npm run validate` on this branch (Node 24): exit 0. Lint clean, format clean, **6743 tests in
315 suites, all passing**.

## How to run

```bash
node tools/qa/wardrobe-clothed-acceptance.mjs --character avatar-sample-b --size phone --lang it-IT
node tools/qa/wardrobe-clothed-acceptance.mjs --matrix            # 16 runs, about 45 minutes
node tools/qa/wardrobe-scene-acceptance.mjs --size desktop --lang it-IT
node tools/qa/look-turntable.mjs --vrm look.vrm --out <dir>       # a file, from four sides
```

## Not covered

- A device other than software-rendered Chromium: no Quest, no real phone, no Safari.
- AvatarSample A in the clothed matrix (it has the earlier Private run, and section 2 here).
- Movement: every check is at rest. Nothing here poses her or plays a clip in a look.
- Looks made by a live Forge: these are the pack's files. The cross-repository run against a
  Forge built from this session's branch is in Forge `docs/qa/KEPT_TOP_KL3.md`.
- A bare or lingerie state on any of these characters: not attempted, by design of this run.
