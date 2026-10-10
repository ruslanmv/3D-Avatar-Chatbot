# Her wardrobe in the conversation (W15–W17)

Three pieces turn Try-On from a panel beside the chat into something she does
_in_ it:

| Batch | Module                             | What it does                                                                                     |
| ----- | ---------------------------------- | ------------------------------------------------------------------------------------------------ |
| W15   | `src/wardrobe/OutfitDictionary.js` | The outfit dictionary: named sets she can wear, from Forge's `GET /v1/outfits`, snapshot offline |
| W16   | `src/wardrobe/WardrobeTool.js`     | Her wardrobe as a tool: what she is told, the `<wardrobe>` tag, the one executor                 |
| W17   | `src/wardrobe/TryOnConversation.js`| The haul's host: her lines from the model, posted in the chat like any reply                     |

## The outfit dictionary (W15)

Forge publishes it (3D-Wardrobe-Forge OD1, `GET /v1/outfits`): 42 sets in nine
groups — Casual, Dressy, Smart, Cozy & home, Summer, and the private groups
Swimwear, Lingerie, Stockings & legwear and Sheer. Each entry is a title, a
group, and the exact `outfit` body a job sends (`{prompt, preset?}`); each is
**planned by Forge's own planner and rated by Forge's own adult gate**, never
labelled by hand. Forge's tests check every group's claim against the computed
rating both ways, check every entry against the gate a real job meets, and every
entry was generated on the declared-adult fit form and passed its fit checks.

Two Lingerie entries are a **collection** (Forge LC1–LC5,
`docs/LINGERIE_COLLECTION.md` there): `italian-lace-thong` and
`italian-lace-brazilian` — one triangle bralette in sheer mesh with galloon lace,
satin bows and gold hardware, and the bottom the entry names. They are private like
the rest of the group: offered only while Try-On's private gate is open for her.

The page reads Forge first and falls back to `assets/wardrobe/outfits.json` — the
same catalogue, exported from Forge — so the companion knows the vocabulary while
a Space wakes, or before the Space is redeployed with the route. Refresh it with
`node tools/wardrobe/sync-outfits.mjs [forge-url]`.

**Private is hidden, not labelled.** An entry is private if Forge rated it so
_or_ its group claims it; either hides it. Private entries are offered only while
`TryOnPrivate` says `open` for her: private mode on (the person is an adult)
**and** her avatar declared adult by Forge's operator. Closed, the companion's
prompt does not mention them at all. Forge refuses the job on its side whatever
arrives.

**Tattoos have their own section (PT1).** Try-On's Private tab is two titled
sections: _Private outfits_, then _Tattoos_. Tattoos are a row of picture tiles,
Forge's own design art (`GET /v1/body-art/designs/{id}.png`), and a design drawn
for more than one placement asks where it goes. They used to be a few “✒” chips
after the outfit chips. When the catalogue arrived after the tab was drawn, which
it always did with a Forge older than `/v1/outfits`, they were not there at all:
`OutfitDictionary.load()` now waits for them. `assets/wardrobe/body-art.json`
answers when the Forge cannot, as the outfit snapshot does. Refresh it with
`node tools/wardrobe/sync-body-art.mjs [forge-url]`.

Which tattoos are offered follows Forge's ratings. With private outfits open for
her, all of them. With private mode on but her avatar not declared adult, the
Private tab says why private outfits are off, then still offers the tattoos Forge
rates `general` at that placement. Forge needs no declaration for those, and
private mode is the person's own choice to see tattoos at all. Anything rated
above `general` waits for the avatar's declaration: private mode never stands in
for it. With private mode off there are no tattoos. A tattoo run re-checks all of
this when it runs. The companion is told about tattoos only while private
outfits are open, as before.

## The tool (W16)

`WardrobeTool.TOOLS` describes the tool the way an MCP server does — `name`,
`description`, `inputSchema` — and `WardrobeTool.call(name, args)` is the only
executor:

| Tool              | Arguments                         | Does                                                       |
| ----------------- | --------------------------------- | ---------------------------------------------------------- |
| `wardrobe_wear`   | `outfit` (dictionary id) or `look` | wears a set (made for her if she does not have it) or a saved look |
| `wardrobe_change` | `prompt`                           | changes one part of what she has on and keeps the rest (LT1)      |
| `wardrobe_create` | `prompt`                           | a new look not in the dictionary                                  |
| `wardrobe_tattoo` | `design`, `placement`              | a tattoo — private only, shown only on bare skin                  |
| `wardrobe_keep`   | —                                  | keep the look and end the haul                                    |
| `wardrobe_undo`   | —                                  | back to the previous look                                         |

The chat reaches `call` through a tag, because this app's rule for model-driven
actions is a tag rather than provider tool-calling (only some of the five
providers expose tools through this client):

```text
Ooh yes — let me try the little black dress!
<wardrobe action="wear" outfit="little-black-dress"/>
```

It follows every rule of the capability pattern (CLAUDE.md): the suffix is `''`
when the switch is off or nothing could run; the tag is stripped once at the
`displayText` seam (bubble, transcript, VR forward and voice together); at most
one per reply; assistant replies only; the switch, Try-On and the private gate
are re-checked when the tag runs. A malformed tag — an unknown attribute, a
value that is not an id, markup inside a value — is stripped and refused. A
future MCP endpoint would publish `TOOLS` and route to the same `call`.

The switch is **on** by default — asking her to put something on is the request
— and lives in Settings ▸ Wardrobe Forge ("Let her change her outfit when you
ask in the chat", `nexus_wardrobe_ai_enabled`).

A tool call opens Try-On through the Together panel when it is closed, waits for
her looks and the private gate, then runs. A dictionary set she already has is
worn, not made twice, and keeps the name the person asked for. "Already has"
survives a reload: Forge names a look itself ("Black Evening" for "Evening
gown") but keeps the request's prompt verbatim, so a set made on an earlier
visit is matched by its prompt — for entries without a preset only, because
Forge does not record the preset and the same words planned without it are a
different outfit. A shared Forge (the public Space) lists one look per name.

## The hosted haul (W17)

The haul has the shape of a YouTube try-on haul, and each beat is **her** line
from the model — in her voice, with the conversation behind it:

| Beat   | When                                     | She…                                                                     |
| ------ | ---------------------------------------- | ------------------------------------------------------------------------ |
| open   | Try-On opens and her looks are listed     | welcomes you, says what she has, suggests where to start                 |
| reveal | a look arrives                            | first impression, one concrete detail, then a rating out of 10 or "keep or return?" (alternating) |
| spin   | every third reveal                        | turns to show the back, then round again                                  |
| outro  | the haul ends                             | recaps her favourites and what she kept, signs off                        |

The app tells the model what happened in a short hidden instruction (never
stored, never shown); her answer is drawn in the chat, added to the history the
model reads, saved and spoken — the same three steps every reply takes, and how
Private and the playground keep their scripted lines. While a haul is open her
ordinary replies are told to host it too ("TRY-ON HAUL IS ON").

Rules, each a failure it prevents:

- **Never over somebody** — a beat waits for an idle conversation and is
  dropped if the person is mid-message; a newer beat replaces an older one.
- **Not after every tap** — a made look always gets a reveal; browsing saved
  looks gets one at most every nine seconds.
- **CLEAR wins** — the epoch is checked before anything is written.
- **Nothing executes** — her beat lines are scrubbed of every directive.
- **Private stays off the record** — a private look or any tattoo gets no beat in
  the chat, and the outro does not name them; they keep Try-On's own ephemeral
  reaction. (OD2: until then they did not — the host's empty answer counted as
  "handled", so with a model configured a private look got no word at all. The
  activity now hands private looks straight to `TryOnReactions`.)
- **Private looks always get her word** (OD2) — the payoff in private mode's loop
  (`docs/PRIVATE_LIVE_SCENE.md` §14: choose → she answers at once → something to
  see next). `TryOnReactions.PRIVATE_LINES` is its own register — made, from the
  shelf, a tattoo — warm and teasing, never explicit, with “Show me the back”
  first. Ephemeral like every reaction: never in the chat, the history or the
  prompt.
- **No model, no host** — without a provider the haul works as before. `callLLM`
  _answers_ "Provider not configured." rather than throwing, so that sentence is
  recognised and never posted as her line.

Checked in the real app against the live Space with a scripted model at the
provider boundary: "what can you wear?" was answered from the dictionary (the
prompt listed it, and nothing private); "put on the little black dress" became a
tag, the tag opened Try-On and was never shown, the Space made the dress, she
wore it, and the open, reveal and outro lines were posted and kept in the
history.
