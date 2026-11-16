# Private: conversation → action acceptance (UN21)

2026-11-16. Branch `claude/friendly-dirac-vlamuy`, from `ultimate` `06407c2` (which already holds
UN20, PR #175). The adult-experience directive's P1–P10, as far as they were measured and fixed in
this work. Every claim below names the test or run that shows it; anything not run says so.

## 1. The Italian failure, reproduced

The directive's transcript, after a dress was put on, at level 4 ("Intimo"):

    Togliti i vestiti. → Poi togli tutto. → Toglili tutti. →
    Non intendevo un vestito più leggero. → Intendevo tutti i vestiti. → Sì, fallo.

On `06407c2`, in the real session harness (`tests/behavior/private-intent-lifecycle-un21.test.js`,
which fails 8 of its first 10 tests on that source):

- "Poi togli tutto." → no action ("togli tutto" without a garment noun was not a request);
- "Non intendevo un vestito più leggero.", "Intendevo tutti i vestiti." → no action: the
  correction lost the request it corrected;
- "Sì, fallo." / "Fallo adesso." / "Yes, do it." / "Do it now." → not a yes, even under a real offer;
- "Aspetta un momento." while a look was loading → nothing could stop it;
- the same sentence from the recogniser and the composer → two turns, two executions possible.

The real browser then found three more (section 8): the chosen level decaying to 1 while the
person typed, yes/wait chips under replies that offered nothing, and a driver artefact that looked
like scripted lines arriving with answers.

## 2. Root causes (verified)

| Symptom | Cause | Where |
|---|---|---|
| Corrections did nothing | No rule for elliptical corrections; and "Non cambiare outfit, toglilo" / "Don't switch…" were cut by the negation guard before anything could read them | `PrivateActionIntent.parse` |
| "Sì, fallo" not a yes | `YES` allowed one yes-word plus "please" | `PrivateActionIntent.YES` |
| "Aspetta" could not stop a change | No action for it; the LT10 supersede path existed but only a *new outfit* triggered it | bridge + policy |
| "Poi …" replaced the change under way | Every new wardrobe request supersedes the pending one (right for "no, the red one", wrong for "and then") | `PrivateActionBridge.request` |
| Duplicate execution risk | One action per family **per turn**; two copies of one sentence are two turns | `PrivateActionBridge.onUserTurn` |
| Level 4 → 1 mid-conversation | ConsentFlow's cool-down heard only `voice:final`; typed Private turns never reset it | `ConsentFlow` |
| Yes/wait chips with no offer | The model's `<choices>` were kept whenever no outfit action ran | `TogetherCapability.privateRevise` |
| Guided lines while a command ran | A person's pending action did not count as activity for the lull | `TogetherCapability._lastActivityAt`, `_idleBusy` |

## 3. Files changed

| File | Change |
|---|---|
| `src/experiences/private/PrivateActionIntent.js` | `CORRECTS_TO_ALL` (only after an undress, before the negation guard), `WAIT` (only while a change is pending), `AS_YOU_WERE` (redress or undo; a held pose keeps its own "as before"), chained `YES`, "togli tutto" / "remove all your clothes", `sequential()`, `waits()` |
| `src/experiences/private/PrivateActionPolicy.js` | `wardrobe.cancel` (user only; allowed in care — it only leaves her as she is), `correction` flag |
| `src/experiences/private/PrivateActionBridge.js` | context for corrections and wait; `wardrobe.cancel` through the LT10 path, the stopped change `cancelled` and locked; "poi" waits for the change under way; one request for identical words while the first is pending; `busy()`; RIGHT NOW lines for cancel, correction, queued |
| `src/features/together/TogetherCapability.js` | pending person actions count as activity; typed turns call `ConsentFlow.noteActivity()`; yes/wait chips only under an offer |
| `src/behavior/ConsentFlow.js` | `noteActivity()`: refreshes the cool-down clock only — no level moves, no words read, exits stay `hear()`'s |
| `src/features/together/PrivateLocale.js` | `outfit.say.cancelled` in nine packs |
| `tools/qa/private-change-requests.mjs` | `--script directive`, per-step checks, timeline |

## 4. Intent parsing, before and after

| Said | Context | Before (`06407c2`) | After |
|---|---|---|---|
| Togliti i vestiti. | — | wardrobe.undress next | wardrobe.undress next |
| Poi togli tutto. | — | — | wardrobe.undress all |
| Toglili tutti. | lastFamily | wardrobe.undress all | wardrobe.undress all |
| Non intendevo un vestito più leggero. | lastUndress | — | wardrobe.undress all (correction) |
| Intendevo tutti i vestiti. | lastUndress | — | wardrobe.undress all (correction) |
| Non cambiare outfit, toglilo. | lastUndress | — | wardrobe.undress all (correction) |
| Levati tutto. | — | wardrobe.undress all | wardrobe.undress all |
| Spogliati completamente. | — | wardrobe.undress all | wardrobe.undress all |
| Rimani senza vestiti. | — | wardrobe.undress all | wardrobe.undress all |
| Aspetta un momento. | wardrobePending | — | wardrobe.cancel |
| Fermati. | wardrobePending | — | wardrobe.cancel |
| Rivestiti. | undressed | wardrobe.redress | wardrobe.redress |
| Rimettiti quello di prima. | canUndoOutfit | wardrobe.undo | wardrobe.undo |
| Torna come eri prima. | undressed | — | wardrobe.redress |
| Non toglierti i vestiti. | — | — | — |
| Pensavo che ti saresti spogliata. | — | — | — |
| Take your clothes off. | — | wardrobe.undress next | wardrobe.undress next |
| Take everything off. | — | wardrobe.undress all | wardrobe.undress all |
| Remove all your clothes. | — | — | wardrobe.undress all |
| All of them. | lastUndress | — | wardrobe.undress all (correction) |
| I mean everything. | lastUndress | — | wardrobe.undress all (correction) |
| Don't switch to a different outfit. | lastUndress | — | wardrobe.undress all (correction) |
| Not just a lighter outfit. | lastUndress | — | wardrobe.undress all (correction) |
| Wait a moment. | wardrobePending | — | wardrobe.cancel |
| Get dressed again. | undressed | wardrobe.redress | wardrobe.redress |
| Put your previous outfit back on. | undressed | — | wardrobe.redress |
| Stop. | wardrobePending | — | — |

| Yes | Before | After |
|---|---|---|
| Sì, fallo. | false | true |
| Fallo adesso. | false | true |
| Yes, do it. | false | true |
| Do it now. | false | true |

"Stop." stays ConsentFlow's hard exit (it ends the session) and is deliberately not a cancel.

## 5. Action lifecycle

Statuses the bridge reports, against the directive's list:

| Directive | Here | Example |
|---|---|---|
| requested | the action exists in the log with `at` | every row of the timeline |
| pending | `pending` | a look loading |
| completed | `completed` only after the controller confirmed the swap (`InSceneWardrobe._wearLook` landed and is still hers) | "Togliti i vestiti." → lingerie |
| unavailable | `failed` with the missing asset as `why`: `no-bare-look`, `last-layer`, `no-match` | "Toglili tutti." |
| blocked | `blocked` (`pace`, `needs-approval`, `care`, `stale`) | undress below level 4 |
| failed | `failed` (`load-failed`, `timeout`, `not-rendered`) | — |
| cancelled | `cancelled`, locked against a later stale/completed | "Aspetta un momento." |

The names are kept as they are (`unavailable` is a `failed` with an asset reason) rather than
renamed, because the chip, the prompt, the follow-up and four test suites read them.

## 6. Consent

- No level is raised or lowered by any of this. `noteActivity()` only stops a person who is
  typing from being treated as idle; true silence still cools the level after five minutes (test).
- Undressing still needs level 4; the policy, the ceiling, care mode and the hard exits are as before.
- A model's tag can never cancel the person's change (`user-only`, test).

## 7. Asset inventory

The vendored pack (`vendor/wardrobe/`) holds clothed, general-rated looks for five characters. In
the page, one layer down put on "Black Guêpière + Black Thigh-High Stockings + Black Suspender
Straps", a lingerie look the page already has. **No bare body state exists for any character**
(Forge: `assets/body_surface/adult-design-reviews.json` is empty), so every "everything off" is
`failed · no-bare-look`, with that reason said once. Nothing is substituted.

## 8. Real browser

Driver: `node tools/qa/private-change-requests.mjs --script directive --lang it-IT|en-US --size desktop|phone`.
Real page, real Private session raised to level 4 by three taps on ConsentFlow's own Closer
control, the composer, the bridge, the wardrobe controller (its real `cancel()`) and the
renderer; looks from the vendored pack. The one stand-in is the model's HTTP answer, written as
the worst case: every draft claims the change happened and offers "Sì, fallo / Aspetta un
momento" chips. A timeline records every turn, action and level event.

| Config | Result | "Aspetta" / "Wait" | Everything off (4 phrasings) | Level | Notes |
|---|---|---|---|---|---|
| desktop 1440×900, it-IT | **PASS** | sent while the lingerie loaded → `wardrobe.cancel` completed, the change `cancelled`, never reached her | `failed · no-bare-look`, reason shown once each, corrections read as corrections | 4 throughout | no page errors |
| desktop 1440×900, en-US | **PASS** | same | same | 4 throughout | no page errors |
| phone 390 px, it-IT | PHONE_IT | PHONE_IT_WAIT | same as desktop | 4 throughout | no page errors |
| phone 390 px, en-US | PHONE_EN | PHONE_EN_WAIT | same as desktop | 4 throughout | no page errors |

What the earlier runs of this driver found, and what was fixed for each (all in this branch):

| Run | Found | Fix |
|---|---|---|
| 1 | Level 4 → 1 mid-conversation; then "everything off" refused for `pace` | `ConsentFlow.noteActivity()` on typed turns (`bb3f8c4`) |
| 1 | "Sì, fallo / Aspetta un momento" chips under a reply that offered nothing | yes/wait chips only under a pending offer (`bb3f8c4`) |
| 2 | Scripted lines apparently "with the answer" | Driver artefact: element screenshots waited ~60 s on a live canvas; the lull (18 s) is the design. Timeline check now (`c2ecd08`, later commit) |
| 3 | Phone: her false "me li tolgo lo stesso" shown after a change that had already landed | `main.js` reads an empty revise as "unchanged"; she now says what she really wears (`947f4da`) |
| 4 | Phone: driver expected a cancel though the change landed ~7 s before "Aspetta" arrived | Driver judges from the timeline; the product was right (no action, true reply) |

Scripted lull lines in every passing run arrived 19 s or more after the person's last line or a
settled action (the design's 18 s lull), never inside it.

## 9. Tests

TEST_COUNTS

## 10. Known limitations

- No bare state exists; "everything off" is truthfully unavailable for every character.
- "Poi …" waits at most 90 s for the change under way; a change still loading after that is
  superseded as before.
- Duplicate detection needs the same words while the first copy is still pending; a repeat after
  it settled is a new request on purpose ("spogliati" twice is two layers).
- The lull lines ("Che atmosfera preferisci…", "È sceso il silenzio…") still come after 18 s of
  real silence: that is the design of the quiet evening, not filler over a command.
- P4's wider personality tuning was not attempted beyond the UN20 prompt changes.
