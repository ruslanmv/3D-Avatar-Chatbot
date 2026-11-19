<!-- How Private tells the model what exists. Keep it accurate: change the pattern and this page in the same commit. -->

# What she knows, in proportion (PB2)

Private has catalogues the model must know about — her body's states, positions, shows, outfits,
rooms, personas — and each grows. Listing every one in every prompt costs tokens on every reply,
drowns the instructions that matter, and still fails when a list is cut. Not listing them makes
her vague ("Cosa puoi mostrare?" → "Tutto") or wrongly negative (a piercing asked for → "I can't",
with no alternative offered). Both were seen in a real evening, 2026-11-19.

## The pattern (every catalogue follows it)

1. **Index, always.** One line: the families and their counts ("fisting 8 · finishes 26 …").
   A few dozen tokens. She always knows what exists and can offer it.
2. **Detail, on demand.** A family's names only on the turn the person's words touch it — in any
   of the nine languages — or everything once when they ask what she can do/show.
3. **Filtered by where she is.** Position-specific items only for the position she holds; only
   what her current look really has (the skin pack, the wardrobe), never the whole catalogue.
4. **Hard budgets, enforced by a test.** Index ≤ 300 characters, one family ≤ 600, everything
   ≤ 900 (`PrivateBodyKnowledge.BUDGET`). The test runs against Forge's full state list, so adding
   states can never quietly grow the prompt.
5. **Say what is impossible, with the alternative.** Things that come with a look (piercings,
   tattoos, marks) are never added live: when asked, she is told which looks carry them so she can
   offer to change into one.
6. **Information, never an action.** Knowing a state never applies it: the pace, the person's
   words or taps, and the bridge's actions do.

## Where it lives

| What | Where |
| --- | --- |
| The body's knowledge (families, words, budgets) | `src/experiences/private/PrivateBodyKnowledge.js` |
| Where it reaches the prompt | `PrivateActionBridge` `packLines` (closest step only) |
| Tests | `tests/private-body-knowledge.test.js`, the PS2 bridge test |
| The full list of states (Forge) | `3d-wardrobe-forge/assets/body_detail/{presets,states,extras}.json` |

## Adding to it

- A new Forge state: nothing to do here if its name fits a family regex (`FAMILIES`); otherwise
  add it to the right family, or it is listed as "in a position"/"other". Run the test: the budget
  holds or it fails.
- A new family the person can ask about: a `FAMILIES` entry, a `LABEL`, and its words in `ASKS`
  for all nine languages (one regex; substrings, lower case). Check common words do not trigger it
  (the test has "ricordo" and "sincera" for `cord`/`cera`).
- A new catalogue (outfits, shows…): follow the same five steps in its own module; do not add its
  full list to the prompt.
