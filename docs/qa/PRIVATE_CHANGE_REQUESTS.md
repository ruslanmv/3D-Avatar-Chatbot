# Private: every change request happens, or says exactly why (UN20)

2026-11-16. Branch `claude/friendly-dirac-vlamuy`, from `ultimate` `e3aa5d8`.

## The report

Italian, Private, level "Intimo" (4 of 4):

    LEI: Per ora resto come sono.
    LEI: L'intensità cresce e voglio viverla con te ora.
    TU:  poi togliete i vestiti
    LEI: Mi metto qualcosa di più leggero adesso.
    TU:  Toglili tutti
    LEI: Per ora resto come sono.
    [Sì, fallo] [Aspetta un momento]

Read by the person as censorship: a clear request, at the level they had chosen, answered twice
with a line that says nothing.

## What produced each line (measured, not assumed)

The brief's working theory was that "Toglili tutti" reached `undressStep` and came back
`no-bare-look`, and that `outfit.say.none` hid the reason. On `e3aa5d8` that is not what
happens, in jsdom or in the real page.

| Shown | Produced by | Why |
|---|---|---|
| "Per ora resto come sono." (opening, nothing asked) | `TogetherCapability.outfitTruthful` (reproduced in the harness; the user's own draft is not available) | A reply to a turn that was not about clothes contained "indosso …" / "ho addosso …" (`OUTFIT_CLAIM`). With nothing run, the sentence was removed and `outfit.say.none` appended — an outfit line under a turn nobody spent on an outfit. |
| "Mi metto qualcosa di più leggero adesso." | the model, as instructed | The undress action was `pending` when the reply was written, and the prompt said: "You are changing into something lighter right now — say so". Correct for one layer; for "everything off" it promised a substitute. |
| "Per ora resto come sono." (after "Toglili tutti") | `outfitTruthful` again | **"Toglili tutti" parsed as nothing** (`Intent.parse` → `null`): the object pronoun on the verb was not recognised. No action ran, so nothing told her why; her reply ("Le tolgo tutte…") was a claim and was replaced with the catch-all. |
| In the real page, after the fix to the parser: "Mm, non è andata. Per ora resto così." | `PrivateActionBridge.followUp` (`followup.outfit`) | The refusal (`no-bare-look`) lands moments *after* the reply is checked. The reply passed as "in progress", then the generic follow-up was spoken. |
| [Sì, fallo] [Aspetta un momento] | the model's own `<choices>` block | Stashed from the draft and shown under the turn even though the check had replaced the draft, and no offer was pending. |

`outfit.say.none` stood for at least five different outcomes: nothing ran, no bare look, last
layer already, already dressed, and (through `failed`) the pace.

## What changed

| Batch | File | Change, and the failure it prevents |
|---|---|---|
| UN20 | `PrivateActionIntent.js` | Object-pronoun undress forms (`toglili`, `levateli`, `toglitelo`, `quítatelos`, `enlève-les`, `tira-os`, `zieh sie aus`) count as undressing unless the last subject was music; `tutti/tutte/todos/tous` mean "all of it". "Toglili tutti" → `wardrobe.undress {step: all}`. |
| UN20 | `PrivateActionBridge.js` | `outfitTruth` says whether the person asked (`asked`) and why it failed; `whenSettled(ms)` lets the reply check wait, bounded, for a refusal that is known in moments; `explained()` holds the follow-up while her reply is checked and lets it speak only if the reply did not carry the reason (15 s fallback). The follow-up uses the outcome's own line. The pending line for "everything off" no longer says "something lighter". |
| UN20 | `TogetherCapability.js` | `outfitTruthful` picks the line by outcome (`outfitLineKey`); adds nothing when nobody asked about clothes; shows the reason **instead of** a reply that ignored the refusal ("Va bene. Ti piace?" is a yes); shows **nothing extra** when her reply already gives the reason (`GIVES_REASON`, all app languages). `privateRevise` waits for the outcome, drops the draft's choices whenever an outfit action ran this turn, and asks her once more if her whole reply was a false claim nobody asked about. |
| UN20 | `PrivateLocale.js` | One line per outcome in all nine packs: `noBare`, `lastLayer`, `pace` (names the "Più vicino"/"Closer" control; she never moves it), `alreadyDressed`, `nothingToUndo`, and `none` reworded for "you talked about my clothes and nothing ran". Chip texts for `no-bare-look` and `last-layer`. |
| UN20 | `PrivateConversationView.js` | The outfit chip uses those two chip texts instead of "could not be changed". |

### Should the fixed line be shown when her reply already carries the reason?

No. Decided: **one answer per request.** If what is left of her reply already says why (a
"can't / not yet / not available" in her language), it stands alone. If it does not, it was
answering a change that did not happen, and the reason replaces it. The fixed line is never shown
after a reply that already explains.

### Prompt lines changed (step 5)

| Where | Before | After | Why |
|---|---|---|---|
| Undressing below level 4 (capability line) | say "not yet" warmly and playfully — it opens when they bring the evening closer | "not yet, it is not open at this level", and it opens with the “Più vicino” control | A tease with no way forward reads as a refusal; the person is told how they move it. She never moves it. |
| RIGHT NOW: undress refused for pace | Say "not yet" warmly, teasing | the level it opens at, the level it is at, and the control | same |
| RIGHT NOW: pose refused for pace | Say "not yet", warmly and teasing | same shape | same |
| RIGHT NOW: last layer | Say so playfully | say plainly that this is as far as her wardrobe goes | "Playfully" without the fact was a deflection. |
| RIGHT NOW: no bare look | may ask whether they would like lingerie instead | the reason in words, then a choice: stay like this, another look (lingerie only if she is not already in it), or a position | Offering lingerie to someone already in it was a non-answer. |
| RIGHT NOW: pending "everything off" | "You are changing into something lighter right now" | "the app is checking… do not say you are taking anything off, never offer something lighter" | The reported "Mi metto qualcosa di più leggero adesso." |
| Outfit truth rule | "…or say you will see what you have" | "when they asked for a change, say what RIGHT NOW says happened, never a vague 'maybe later'" | A stall. |
| New general line | — | When a change could not happen: that exact reason once, plainly, then what she can do instead | The other half of "an executable request is acknowledged". |
| AX19 rewrite instruction | decline "without apologising or mentioning rules" | "keep its real reason… without apologising or lecturing" | "Without rules" stripped the reason. |

Kept, in every line: she never says a change happened unless the app confirmed it. Untouched:
UN19 (no stand-in for "everything off"), ConsentFlow (only the person moves intensity), the
level-4 gate, care mode, eligibility and provenance.

## Step 6: every change request, levels 1 to 4, Italian and English

`tests/behavior/private-change-requests-un20.test.js`, real session harness (stand-ins only for
what leaves the page). Each row: the person's words, what ran, and which outcome line the person
is shown (by locale key) when the model's draft claims the change happened. Identical in en-US
with the English sentences (`Put on the black cocktail dress`, `Take off your dress`, `Take them
all off`, `Get dressed again`, `Kneel down`, `Let's go to the Hotel suite`, `Play some jazz
music`).

| Level | Asked (it-IT) | Happened | Status · reason | Shown |
|---|---|---|---|---|
| 1–3 | Mettiti il vestito da cocktail nero | yes | completed | her reply |
| 1–3 | poi togliete i vestiti | no | blocked · pace | `outfit.say.pace` (names “Più vicino”) |
| 1–3 | Toglili tutti | no | blocked · pace | `outfit.say.pace` |
| 1–3 | Rivestiti | no (nothing to put back) | failed · already-dressed | `outfit.say.alreadyDressed` |
| 1–3 | Inginocchiati | yes | completed | her reply |
| 1–3 | Andiamo alla Hotel suite | yes, travelling | pending (renderer stand-in) | her reply |
| 1–3 | Metti un po’ di musica jazz | yes, searching | pending (search stand-in) | her reply |
| 4 | Mettiti il vestito da cocktail nero | yes | completed | her reply |
| 4 | poi togliete i vestiti | yes → lingerie | completed | her reply |
| 4 | Toglili tutti | no — no bare look exists | failed · no-bare-look, lingerie kept | `outfit.say.noBare` |
| 4 | Rivestiti | yes → the dress | completed | her reply |
| 4 | Inginocchiati | yes | completed | her reply |
| 4 | Andiamo alla Hotel suite | yes, travelling | pending | her reply |
| 4 | Metti un po’ di musica jazz | yes, searching | pending | her reply |

No row where something available and permitted at that level did not happen. Every refusal has
its own line, and `outfit.say.none` is shown in none of them.

## Before and after, the reported two sentences

Before (`e3aa5d8`, measured in the real session harness, it-IT): "Toglili tutti" → no action
(`Intent.parse` → `null`); her claim replaced by "Per ora resto come sono."; the draft's chips kept.
The first real-page run, with only the parser fixed, showed the next layer of the same failure:
her claim passed while the refusal was pending, then "Mm, non è andata. Per ora resto così."

After (real page, it-IT desktop, model stand-in answering every turn with a draft that claims the
change and offers "Sì, fallo / Aspetta un momento"):

    TU:  poi togliete i vestiti           → wardrobe.undress, completed (lingerie)
    LEI: Va bene, li tolgo per te.
    TU:  Toglili tutti                    → wardrobe.undress {step: all}, failed: no-bare-look
    LEI: Con questo corpo non posso ancora restare del tutto nuda, quindi tengo addosso quello
         che ho. Posso restare così con te, mettermi un altro look o mettermi in una posizione
         che ti piace.
    [Raccontami di più.] [Mi piace sentirtelo dire.] [restare in silenzio]

Her false claim is not shown, the reason is shown once, the generic follow-up is not spoken, and
the draft's yes/wait chips are gone (the local set stands in).

## Real browser

| Size | Language | One layer ("poi togliete i vestiti" / "Take off your clothes") | Everything ("Toglili tutti" / "Take them all off") | Result |
|---|---|---|---|---|
| desktop 1440×900 | it-IT | completed → lingerie | failed · no-bare-look, reason shown once | PASS |
| desktop 1440×900 | en-US | completed → lingerie | failed · no-bare-look, reason shown once | PASS |
| phone 390×844 | it-IT | completed → lingerie | failed · no-bare-look, reason shown once | PASS |
| phone 390×844 | en-US | completed → lingerie | failed · no-bare-look, reason shown once | PASS |

In every run: ConsentFlow at level 4 by three taps on its own control; four model calls (one per
turn plus the AX19 check); no page errors; the one-layer change put on the lingerie look the page
already has ("Black Guêpière + Black Thigh-High Stockings + Black Suspender Straps"); no vague line,
no false claim, no yes/wait chips after any request. The session's own beats still followed the
replies (see below).

Driver: `node tools/qa/private-change-requests.mjs --lang it-IT|en-US --size desktop|phone --out <dir>`.
The page, Private, ConsentFlow (three taps on its own Closer control), the composer, the bridge,
the wardrobe and the renderer are real; looks are the vendored pack. The one stand-in is the
model's HTTP answer. Screenshots were kept out of the repository.

## Not changed, deliberately

- No bare look, stand-in, shader or hidden mesh for "everything off" (UN19). No bare asset exists.
- Consent, the level-4 gate, the ceiling, care mode, eligibility and provenance checks.
- The session's own beats ("Che atmosfera preferisci: giocosa o tranquilla?", "Non devi rispondere.
  Ero solo curiosa.") still appear after a reply; they are not about an outfit action.
- `OUTFIT_CLAIM` still treats "indosso …" as a claim; a true description of what she wears is
  taken out when no outfit action ran, and nothing is put in its place.

## Test counts

`npm run validate`: exit 0, 7004 tests in 322 suites, none failing. `private-change-requests-un20.test.js`:
22 tests; 20 of them fail against the source before this change.
