# NEXUS experience profile contract

The one place a Private style is defined, and what each of its fields is allowed to change. Source of
truth: `STYLES` in `src/features/together/PrivateExperienceProfile.js`. Each field is marked
**EXISTS** (read by running code, tested), **PARTIAL** (read, with a stated gap) or **DECLARED**
(present in data, applied by nothing — never described to the person as working).

## 1. A style

```js
sensual: {
    id: 'sensual',
    maxLevel: 3,          // the style's own ceiling
    needs: 'sensual',     // the content tier it cannot exist without
    presentation: { voiceRate: 0.92, gaze: 'held', mood: 'cabaret-gold' },
}
```

| Style | `maxLevel` | `needs` | voiceRate | gaze | mood |
| --- | --- | --- | --- | --- | --- |
| affectionate | 1 | romantic | 0.97 | soft | romantic-evening |
| romantic | 2 | romantic | 0.95 | held | romantic-evening |
| sensual | 3 | sensual | 0.92 | held | cabaret-gold |
| mature | 4 | mature | 0.90 | held | cabaret-gold |

## 2. Field by field

| Dimension | Field / input | Read by | Status |
| --- | --- | --- | --- |
| Style | `id` | the Private picker, `PrivateBeats` pools, prompt register | EXISTS |
| Consent ceiling | `maxLevel` ∧ capability | `Intimate._installCeiling` → ConsentFlow `maxLevel` | EXISTS |
| Model capability | `needs` vs `resolveCapability()` | style offered only where reached | EXISTS |
| Tone | `registerLines(style, level)` | Private prompt | EXISTS |
| Pacing | `lengthLines` / `lengthReminder` (1 / 3 / 4 sentences by turn) | Private prompt, repeated last | EXISTS |
| Story themes | `PrivateBeats.POOLS[style]` (openings, playful, tender, middle, closing, texture) | fallback plan; planner gets the style | EXISTS — every style has its own pool |
| Voice | `presentation.voiceRate` + step | `PrivatePresentation.adjustVoice` in both speech paths and lip-sync | EXISTS |
| Expression | resting `happy`, 0.10 + 0.04 per step | `vrmLoader.setEmotion`; BehaviorEngine, AnimationManager and companion actuators settle to it | EXISTS |
| Gaze | `presentation.gaze` | nothing | DECLARED — BehaviorEngine/FaceTracker own gaze |
| Avatar actions | `presentationFor(...).intents` from adult.profile's ceiling table | ranker (advisory; it enforces its own per-level ceiling) | PARTIAL |
| Lighting | `presentation.mood` | `runtime.setMood`, once at start, only with a room up | EXISTS |
| Music | preset soundtrack query | Private preflight | EXISTS (not a profile field) |
| Privacy | — | Private turns live in the card only, never `chatHistory`; Clear forgets | EXISTS (not configurable) |
| Session boundaries | `stop`, `adult:exit`, soft-exit word, End | `afterActivityStop` → `PrivatePresentation.reset()` | EXISTS |
| Care | `wellbeingConcern` | overrides every field above | EXISTS (not configurable) |

## 3. Invariants

1. **Narrow, never widen.** Ceiling = min(style.maxLevel, capability.maxLevel). No field of a style,
   no deployment tier and no consent step raises another owner's limit.
2. **Only the person moves the level.** A style sets where the ladder ends, never where it is.
3. **Presentation is bounded.** Voice ≥ 0.8 × the person's own rate and ≤ it; face intensity ≤ 0.32;
   the light is set once and never overrides a light the person chose in the room.
4. **Applied means applied.** `PrivatePresentation.state().applied` is `false` for a channel whose
   owner was missing or threw.
5. **Off is unchanged.** With no Private session `adjustVoice` is the identity and
   `restingExpression()` is `null`; every other reply in the app sounds and looks as before.
6. **Stop gives everything back.** Neutral face, the person's voice; the room's light leaves with the
   room.
7. **Care wins.** Calm rate 0.95, neutral face, no light, care-only prompt — no style, tier or
   capability turns it off.
8. **Proactive stays non-explicit** whatever the style or tier (§3 of the architecture).

## 4. Adding a style or a field

- A style: add it to `STYLES`, a pool to `PrivateBeats.POOLS` (all lines must pass `Beats.line`),
  labels in all nine `PrivateLocale` packs. `presentation.test.js` checks every style at every level
  stays within the bounds above.
- A presentation field: apply it through the channel's existing owner, record it in `applied`, reset
  it in `reset()`, and add it to this table as EXISTS only once a test and a browser measurement show
  it. Until then it is DECLARED.
