# Premium behaviour authoring

How to write what she does and says in a premium room so that it feels alive
and stays true. This is about **authoring**: the tone, the labels, the words
that ask for things, and the spots she stands at. The gate and the plumbing are
in `PRIVATE_WORLD_ENGINE.md`.

## 1. What makes it feel premium here

The walkthroughs showed what lands and what does not.

**What lands:**

- **She is somewhere specific.** "We're right by the heavy curtain, the stage
  lights casting a soft glow behind us. The lounge and footlights are just a
  few steps away." That came from a real model reading the measured spot's
  `sees` and the list of other spots. Write `sees` as what a person standing
  there would notice first, in one line.
- **The thing asked for happens, and she says so once.** The person asked for
  warmer light; the light changed; she answered "Sure, I'll turn the light
  warmer for us." No ceremony is needed.
- **A move is a small journey.** While the renderer fades, the prompt says the
  move is under way, and she says "we're on our way". She does not say "we're
  there".
- **She stays in the room.** Asked for a bedroom the cabaret does not have, she
  said: "I'm really enjoying our time right here in the cabaret." Nothing
  moved.

**What does not land:**

- She described a warm glow nobody had made. This was before PW5, when the room
  could not hear Private's turns. The cure was plumbing, not wording.
- Replies cut off by the response budget leave half a tag (`[[emote:`). These
  are now stripped. Keep labels and tone short so the budget goes to what she
  says.

## 2. Writing an interaction

```json
{
    "id": "light-gold",
    "kind": "light",
    "preset": "cabaret-gold",
    "label": { "en": "golden stage light", "it": "luce dorata del palco" },
    "words": {
        "en": ["golden light", "stage light"],
        "it": ["luce dorata", "luce del palco"]
    }
}
```

- **`label`** is what the prompt calls it. She will often say it back, so write
  it as she would: "golden stage light", not "LIGHT_PRESET_GOLD".
- **`words`** are what the person says to ask for it, matched as whole phrases
  in either language. Prefer two or three natural phrasings over one exact
  one. Avoid a phrase that is also a spot word or another interaction's word:
  the first match wins.
- **One interaction does one thing an owner can confirm.** "Dance and dim the
  lights" is two interactions. Two confirmations cannot be narrated as one.
- **Pair every start with a stop.** A dance has `stop-dance`; a light preset
  has `light-own`. Revocation also undoes them, but the person must be able to
  undo them in their own words.

## 3. Writing the tone

One sentence, at most 240 characters, in en and it. It sets the register; it
does not grant anything. The shipped one is:

> Warm, playful and unhurried; follow their lead, keep replies short, and let a
> quiet moment be quiet.

Things the tone must never do:

- **Escalate.** Levels and ceilings are Private's, set by the person.
- **Encourage dependence.** No "don't leave", no guilt about ending, no
  pressure to continue. The person's End is always one tap and always works.
- **Describe her body or age.** The avatar is whoever Forge declared adult;
  the tone describes the mood, not her.

## 4. Writing a spot

In `tools/vr/spot-targets.json`:

- **`near`** is the thing she stands by. If the thing is the whole floor (a
  stage deck), pick what bounds it: the cabaret's center-stage targets the
  backdrop.
- **`sees`** is one line, concrete, and true of the model. "The heavy house
  curtain, drawn open", not "a romantic atmosphere".
- **`can`** is `stand-near` and `look-at` until seating and holding exist.

Measure; do not place. A spot that fails measurement does not exist.

## 5. Offers, not initiative

She may offer one thing per reply with `<act id="…"/>`. The person's next-turn
yes runs it. Good offers follow from what was just said ("Would you like the
golden stage light?").

Two things are guidance for what you write, **not** rules the code enforces:

- not offering again when the first offer was not taken
- not offering on arrival (arrival belongs to her opening line)

What the code does enforce:

- an offer expires after one turn
- only the person's yes runs it
- nothing in a premium room starts by itself (the deterministic scenario S2
  holds that four turns of small talk change nothing)

## 6. Checking your work

```bash
npx jest tests/private-world
```

Then walk it with a real model, in the page, with non-explicit lines (the
harness in `docs/qa/PRIVATE_WORLD_EXPERIENCE_EVALUATION.md`), and score it on
that page's rubric. A reply that claims something the trace does not show
fails, whatever it sounds like.
