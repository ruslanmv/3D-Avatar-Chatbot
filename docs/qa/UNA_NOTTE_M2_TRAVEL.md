# Una Notte M2 — a two-place evening, verified in the real renderer

`node tools/qa/una-notte-travel-audit.mjs --size desktop|phone --lang it-IT|en-US` drives one Private
evening through the app's own seams (her reply through `PrivateActionBridge.consumeTravel`, the
person's words through the conversation surface) and judges it by the renderer (`nexus-world-shown`,
`vrWorlds.activeId`), not by anything she says.

| Run | Opening | Destination (from the outline) | Invite | Not-a-yes | Yes → shown | Arrived | Page errors |
|---|---|---|---|---|---|---|---|
| desktop, it-IT | private-cabaret | apartment | offer only, `<go>` stripped, nothing moved | offer closed, nothing moved | requested via `nexus-world-request` (owner intimate) | renderer showed it in 5.4 s; story `arrived`; prompt "you came here together" | 0 |
| 390 px, en-US | private-cabaret | bedroom | same | same (after the fix below) | same | 4.5 s; same | 0 |

## Defect found and fixed

In English, "Let's stay here a little longer" was read as a yes and she went to the bedroom: the
yes-to-going pattern accepted a bare "let's". "No, non andiamo", "Aspetta, andiamo dopo" and
"Not yet, let's wait" would have gone too (a refusal after a comma escaped the negation check).
`affirmsGoing` now refuses any answer with a refusal or delay word in it (it, en, es, fr, de, pt),
keeps "why not / perché no" as yeses, and no longer takes a bare "let's". Tests in
`tests/private-world/una-notte.test.js`.

## Behaviour to know

After arriving, "Possiamo andare altrove? / Can we go somewhere else?" answers `no-destination`:
an evening's outline has one destination, and she is in it. She says so; no room is invented.
