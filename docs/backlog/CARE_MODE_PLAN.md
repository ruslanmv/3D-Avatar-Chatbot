# Backlog: Care Mode (app-wide emergency calm mode)

**Status:** planned, not scheduled. **Priority:** after the current focus (user acquisition and the adult experience). **Owner:** to be assigned.

## Why

Today only Private has a crisis protocol (AX6). Ordinary chat, Life and the VR panel do not. A person in
distress should get the same calm, caring response wherever they are talking to her.

## What it is

A small additive module. It does nothing until a rare, clear emergency phrase appears, and then turns
the companion into a calm, supportive friend for that moment.

## Plan

| Step | Work | Done when |
| --- | --- | --- |
| 1 | **Module.** Create `src/companion/CareMode.js` (boot list). It observes every user turn at the shared conversation seam, so all surfaces are covered | One module, no change to any other mode |
| 2 | **Inactive means unchanged.** No prompt text, no behaviour, no storage while it is not triggered | A test proves every prompt is byte-for-byte identical when inactive |
| 3 | **Rare, strict triggers.** Reuse `PrivateExperienceProfile.wellbeingConcern` (en, it), and add a distress list (panic attack, "can't breathe"). No sentiment guessing; romantic and everyday idioms never trigger it | Phrase tests, including false-positive tests |
| 4 | **Two levels.** *Distress* gets a calming friend. *Danger* gets the same, plus the fixed help notice (112 / 911, findahelpline.com) in the person's language | Both levels tested in en and it |
| 5 | **Care behaviour.** Pause whatever is running. She talks slowly and warmly: she acknowledges the feeling, offers one grounding step at a time (breathing 4-in/6-out, "five things you can see") and one small next step, and encourages reaching someone they trust. She never invents phone numbers | Real-model check on two providers |
| 6 | **Gentle exit.** "I'm okay now" or an *I'm OK* button ends it; she checks in once. Nothing resumes on its own | Exit tests |
| 7 | **Privacy.** Nothing stored or logged; Clear forgets it | Grep test plus ConversationReset test |
| 8 | **Optional.** A soft voice, warm dim light and gentle idle pose via existing owners (`setMood`, TTS rate, BehaviorRouter) | Browser check |
| 9 | **Review.** Phrase list and wording reviewed by someone trained in crisis support; help numbers verified per market | Sign-off recorded |

## Limits (state them in the product)

It cannot call or alert anyone, and it is not therapy or emergency care. It calms, stays present, and
points to real people.

## Starting point already in the code

`wellbeingConcern`, `concernLanguage` and `careLines` in
`src/features/together/PrivateExperienceProfile.js`; `care.notice` in all nine languages in
`src/features/together/PrivateLocale.js`; Private's care mode in `TogetherCapability.js` (AX6).
