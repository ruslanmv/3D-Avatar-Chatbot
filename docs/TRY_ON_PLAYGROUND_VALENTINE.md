# Try-On playground — Valentine's session (LT4)

`tools/try-on-playground.mjs` plays Try-On against a real Forge and times every
step a person sees. This is the first run, recorded so the fixes have a baseline.

## Setup

- HomePilot at `feat/forge-catalog-on-mobile-redesign` (5f0cac3), 1366×768.
- Forge at `feat/garment-catalog-previews-api` (e06589c), run locally with
  `uvicorn apps.api.main:app --port 8765`, native engine.
- Avatar VRoid Female (`fem_vroid.vrm`, pinned sha256 9836…acb8), declared adult
  in Forge's `policy.json`; private mode on.
- Scenario `valentine`: create a red satin bodycon mini dress, change it to wine,
  then ask NEXUS for a romantic look in the conversation.

```
node tools/try-on-playground.mjs OUT --forge http://127.0.0.1:8765 --private
```

## Timeline (run 3)

| Beat | What the person sees | ms after typing |
| --- | --- | --- |
| "a red satin bodycon mini dress for a Valentine's date night" | "Designing your change…" | 2 752 |
| | (no change on screen; Forge is fitting) | 2 752 → 19 375 |
| | "Almost ready…" | 19 375 |
| | Red Bodycon Mini Dress on her, Look 5 of 5 | **26 197** |
| "change the dress to wine" | "Designing…" → "Almost ready…" | 1 556 → 7 238 |
| | Wine Bodycon Mini Dress, same cut (`baseLookId`) | **8 493** |
| "Make me a romantic Valentine's look" (conversation) | could not be typed: the conversation is not on screen | — |

Server side, Forge completed the first job in 19.0 s (queued → look ready,
preview included) and the colour change in 6.4 s.

## Findings, in order of how much they cost a person

1. **Creating a look is three clicks deep.** Looks rail → More (opens the
   garment catalogue) → Advanced → composer. The sentence a person wants to type
   ("a red dress for Valentine's") has no place on the main stage.
2. **With the Try-On panel open, the conversation is gone.** The panel takes the
   whole right column; Hide did not bring the chat input back within 30 s. NEXUS
   cannot be asked anything while the panel is open.
3. **The conversation reaches Forge only through the model.** "Ask NEXUS…" sends
   text to the LLM, which must answer with a `<wardrobe …/>` tag. With no
   provider configured, the box everyone uses cannot make clothes, although
   Forge works.
4. **Progress freezes for 17 s.** Forge runs its CPU-bound pipeline inside the
   web server's event loop (`AsyncioJobQueue` workers are asyncio tasks), so a
   status poll waits until a stage yields: 4 polls answered in a 19 s job, the
   _Fitting_ step never lights, and progress jumps from Designing to Almost
   ready. The Hugging Face Space runs the same code. Fix belongs in Forge: run
   the pipeline off the event loop.
5. **"Almost ready…" is 6.8 s of VRM download and load** (12.2 MB per look).
6. **The rail fills with indistinguishable duplicates.** Generated looks persist
   in Forge's wardrobe; two runs left "Red Body…" twice and "Wine Bo…" twice,
   with nothing to tell them apart.
7. **Generated looks have a different kind of thumbnail** (Forge's small grey
   preview figure) from the built-in looks (her, rendered), so the rail reads as
   two unrelated sets.
8. **No lingerie in Customize, even when allowed.** Private mode on and an
   avatar Forge declares adult, yet the catalogue shows no Underwear & Lingerie
   tab: Forge lists restricted templates only to an admin session, and private
   mode is not one.

What worked: the change kept the dress (`baseLookId`), Undo and Compare stayed
available, the avatar kept her place and size on the stage throughout, and no
step left her without a look.
