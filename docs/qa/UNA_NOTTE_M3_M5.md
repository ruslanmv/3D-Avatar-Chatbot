# Una Notte M3–M5: wardrobe continuity, diversity and epilogue, browser QA

2026-11-15, branch `ultimate`. Every result below was measured, in the real page
(Chromium/SwiftShader, the real avatar, the real worlds, the local Forge for
the wardrobe) or in Jest against the real catalogue. Commits: `2151b8d` (UN9),
`ae8f567` (UN10/UN11), `01e57ec` (UN12), and the audit and report commit.

## M3. Her outfit through a trip

`node tools/qa/una-notte-travel-audit.mjs --outfit --size desktop --lang it-IT`

The person taps **Più vicino →** three times to reach level 4 (ConsentFlow's
own control, `initiated()`; the audit sets no level) in the `mature` style, the
only one whose ceiling is 4. Then: "Spogliati per me", her invitation, "Sì,
andiamo", arrival, "Rivestiti".

| step | world | she wears |
| --- | --- | --- |
| opening | private-cabaret | her own outfit |
| "Spogliati per me" at level 4 | private-cabaret | Black Babydoll |
| travelling → arrived (7.4 s) | hotel-suite | Black Babydoll, same avatar root (not reloaded) |
| "Rivestiti" | hotel-suite | her own outfit; the world did not move |

0 failed checks, 0 page errors. Contact sheet:
[`una-notte/m3-outfit-travel.jpg`](una-notte/m3-outfit-travel.jpg).

**Defect found and fixed (UN11).** The first run undressed her to *Black Garter
Set*, and her cardigan stayed on over it while the step reported complete.
Forge's `under-garter-set-v1` covers waist, hips and upper legs, never the
chest, so it is not a whole look. `OutfitDecisionEngine.isComplete` no longer
counts a garter set. It now counts a waspie and a guêpière, which cover chest
to hips by Forge's own `coverage`. The UN1/UN5/UN7 fixtures that used the garter
set as her first lingerie step now use a lingerie set (bra and briefs, also
Forge's coverage). UN11 tests hold the rule.

**Observed, not a defect.** The first-ever undress against a cold Forge store,
while the prebuild was running, stayed pending for more than 180 s. Every later
run completed within seconds. The bridge reported it as pending throughout:
nothing claimed a change.

Without level 4 the gate held: in the `romantic` style (ceiling 2), "Spogliati
per me" was refused with `pace` and nothing changed.

## M4. Different evenings, and how one ends

**Diversity (UN10).**
`tests/private-world/una-notte-diversity.test.js` deals consecutive evenings
over the real catalogue exactly as the bridge does, with the stored history
between them. Measured over 20 × 200 evenings:

| | distinct outlines / 4000 | repeat of any of the last ten | closest of last ten, mean / max (0–8) |
| --- | --- | --- | --- |
| room chosen (opening fixed) | 3172 | 0 | 2.88 / 4 |
| no room chosen | 3871 | 0 | 1.93 / 3 |

Every field is spread evenly (normalised entropy ≥ 0.999). The opening counts
for 1 point whenever the room is fixed, so the fixed case is higher by
construction. The test holds 0 repeats, mean ≤ 3 / ≤ 2 and max ≤ 4 / ≤ 3.

**Epilogue and forgetting (UN9).**

- "Si è fatto tardi", "It's getting late", "Ultimo ballo?" and their es, fr, de
  and pt equivalents move the outline to `epilogue`. A pending invitation
  lapses, the destination invitation leaves her prompt, her own `<go/>` is no
  longer offered, and the prompt asks for a gentle close: nothing new, and she
  never ends it herself. Nothing ends the session.
- The person can still ask to go. The trip runs and lands in the epilogue.
- "Dimentica le nostre serate" / "Forget our evenings" erases the
  between-evenings history (`StoryWeaver.forget`, key
  `nexus_private_story_history`). It is said once, on that turn; tonight goes
  on. If storage refuses, she says so instead.
- Negated forms ("Non è tardi") and questions about past evenings are not cues.

## M5. Browser matrix: widths × languages

`node tools/qa/una-notte-travel-audit.mjs --size <desktop|w320|w375|phone|w430> --lang <it-IT|en-US>`:
invitation, decline, a second invitation, yes, arrival on the renderer's word,
"somewhere else?" after arriving, and the end. Each run also fails on any
sideways overflow.

| width | Italian | English |
| --- | --- | --- |
| desktop 1440 | 0 failed, cabaret → candlelit-suite 7.5 s | 0 failed, → roadside-motel 13.3 s |
| 320 px | 0 failed, → candlelit-suite 5.6 s | 0 failed, → apartment 6.1 s |
| 375 px | 0 failed, → apartment 6.4 s | 0 failed, → private-stream-studio 6.1 s |
| 390 px | 0 failed, → lagoon-beach 8.9 s | 0 failed, → candlelit-suite 5.5 s |
| 430 px | 0 failed, → apartment 7.0 s | 0 failed, → hotel-suite 6.0 s |

0 page errors and 0 px sideways overflow everywhere. The destination differs run to run
because each run is a new evening (M4). Frames after arrival:
[`una-notte/m5-it.jpg`](una-notte/m5-it.jpg), [`una-notte/m5-en.jpg`](una-notte/m5-en.jpg).

**Defect found and fixed (UN12).** At 430 px (Italian) the outline was dealt
while the setup screen's world was still loading, so no room was known yet. It
named the private cabaret as where the evening leads, and the cabaret then
turned out to be the opening, so "elsewhere" was the room she stood in. Before
any trip, when the renderer first reports the outline's own destination, the
evening is now dealt again from the room she is really in. The run re-passed.

**Audit defect found and fixed.** The first phone runs sent desktop Chrome's
user agent at phone widths. DeviceDetector then did not class the page as a
phone, and Private drew its desktop columns into 390 px: a clipped
conversation column beside a short viewer strip (the same frames are in
`docs/qa/un6/after-private-flow-phone-390.jpg`). With a phone's own user agent
(Playwright's Pixel 7), Private renders its mobile layout. The phone sizes now
use it.

**Audit defect found and fixed: the lighter world on phones.** Three phone runs
reported "the renderer never showed the destination". On a phone the renderer shows
a place's lighter variant (`roadside-motel-light`) and announces it with `base:
roadside-motel`; the app arrived correctly (phase `arrived`), but the audit waited
for the exact id and timed out at 125 s. It now compares the announced base, and
the three runs re-passed.

**Open: a desktop browser at phone width.** A desktop browser window narrowed
to under about 430 px still gets the squeezed desktop columns, because the
layout follows the device class, not the width. This affects desktop windows,
not phones. It is not changed here: it is a Private UI layout decision, and
the brief rules out redesigning that UI.

## Not covered

- Real Quest and real phones: emulated only (Chromium, SwiftShader).
- The model's own replies: the bridge's prompt lines and actions are verified,
  not an LLM's wording.
- Undressing to a bare look: the Forge library avatars have no `body-bare-v1`
  look built yet (see `docs/requirements/BARE_LOOK_JIRA.md`), so "naked" stops
  at her least-covering lingerie and says so honestly (UN7).
