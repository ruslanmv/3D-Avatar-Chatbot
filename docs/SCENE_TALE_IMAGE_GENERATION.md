# Scene Tale — UI and image generation prompt pack

This document is the visual-generation contract for Together → Playground → Scene Tale.

The implementation already owns state and behavior. Generated imagery must support that product model rather than inventing a second UI or scene catalog.

## Product workflow

Scene Tale has five user-visible stages:

```text
configure → preparing → ready → playing → complete
```

The surface ownership rule is:

```text
Together      = choose/configure the experience
3D viewport   = avatar performs the experience
Conversation  = narration, choices, playback controls, completion
```

Do not create a global floating story HUD for the normal desktop/mobile page. During playback the Scene Tale interface belongs inside Conversation.

## Shared visual language

Apply this block to every UI-generation prompt:

```text
Create a high-fidelity HomePilot / Together product UI mockup.

Visual language:
- premium dark navy / near-black surfaces
- cyan / teal accent glow
- thin luminous borders, never heavy neon
- rounded 14–24 px corners
- subtle glassmorphism and depth
- clean modern sans-serif typography
- generous spacing and obvious hierarchy
- cinematic but practical product UI
- no browser-default controls
- no visual clutter
- accessible contrast
- desktop first, with a clean responsive mobile interpretation

The existing avatar/environment remains part of the experience. Do not replace the app with a generic blank page.
```

## Stage 1 — Configure

Use this as the master prompt for the setup screen:

```text
Design a polished product UI mockup for Stage 1 of a feature called “Scene Tale” inside a futuristic app called HomePilot / Together.

Create a high-fidelity desktop UI screen showing a centered setup card for an experience launcher, not a plain HTML form.

STYLE:
- premium dark-glass interface
- cinematic HomePilot visual language
- dark navy / black background
- cyan / teal accent glow
- thin borders
- rounded corners
- subtle highlights
- elegant readable sans-serif typography
- soft blur and depth
- clean modern spacing

BACKGROUND:
Keep the current avatar/environment visible and softly dimmed/blurred behind the setup card. The current place must still feel present.

MAIN CARD:
Centered dark translucent glass card, thin cyan border, soft glow, generous padding.

Hierarchy:
1. small cyan eyebrow: “TOGETHER”
2. large title: “Scene Tale”
3. subtitle: “A little story inspired by this place.”

SECTION 1 — CURRENT PLACE
Label with location icon: “Current place”.
Below it show a read-only scene preview card with a small landscape thumbnail on the left and the resolved scene label on the right, for example “Coastal Terrace · Twilight”. Never show internal copy such as “Current Scene”.

SECTION 2 — IDEA
Label with edit icon: “Give me an idea” and secondary muted text “Optional”.
Below it show a full-width premium input containing “A letter somebody never delivered”. It must not look like a browser-default textarea.

SECTION 3 — SOUNDTRACK
Label with music icon: “Soundtrack”.
Below it show two large option cards side by side:
- selected: “Let her choose”
- unselected: “No music”
The selected card gets the cyan active treatment. Do not show raw browser radio chrome.

PRIMARY ACTION:
One dominant full-width cyan gradient button: “Create story” with a right arrow.

SECONDARY ACTION:
Small subdued centered “Back”.

Rules:
- one section per row
- labels above controls
- one dominant primary action
- short and effortless
- the emotional message is “Choose how the story begins”, not “Fill in a form”.
```

## Stage 2 — Preparing

```text
Design Stage 2 of the same Scene Tale flow, preserving exactly the same HomePilot / Together visual language and card dimensions.

The setup inputs are gone. The user has already pressed Create story.

Show:
- small cyan eyebrow: “TOGETHER”
- large heading: “Creating our story…”
- supportive copy: “Using this place and your idea to prepare the story.”

Show a calm vertical progress treatment using real states:
✓ Understanding this place
● Writing the story
○ Preparing your choices
○ Choosing music · optional

Completed items use a quiet cyan check. The active item has the strongest emphasis. Future items are subdued.

If true progress events are unavailable, replace the checklist with one honest elegant loading indicator and the sentence “The story is taking shape.” Never fake progress percentages.

Only one secondary action is visible: “Cancel”. Do not show Back and Cancel at the same time.

The current avatar/environment remains softly visible behind the card. No speech or soundtrack begins during this stage.
```

## Stage 3 — Ready

```text
Design Stage 3 of the same Scene Tale flow.

Show the prepared story as an invitation to begin, not as a diagnostics panel.

Hierarchy:
- small navigation context: Together / Scene Tale
- generated story title, e.g. “The Light That Stayed”
- subtitle: “Fictional story inspired by this scene”
- cinematic landscape hero image for the current scene
- compact metadata: “About 5 minutes · 2 choices”
- reassuring status: “Ready to begin”

Primary action:
- one dominant full-width “Start story” button with right arrow

Secondary action:
- “Edit setup”

Do not show “Create another version” before the first version has been experienced.
Do not show a long list of Story ready / Scene ready / Soundtrack ready when everything is normal. Only surface a degraded condition when needed, for example “Music unavailable · continuing without it”.
```

## Stage 4 — Playing in Conversation

```text
Design a high-fidelity widescreen HomePilot / Together screen with two clear zones.

LEFT:
The 3D avatar viewport remains the stage. Show the existing friendly avatar speaking with subtle expressive posture. Keep the stage uncluttered. A small “Speaking…” indicator is acceptable.

RIGHT:
The existing Conversation panel owns the complete Scene Tale interface. The story must not float over both columns.

Inside Conversation create one persistent Scene Tale card:
- kicker: “✨ SCENE TALE”
- large generated title, e.g. “The Magical Forest”
- subtitle: “Fictional story inspired by this scene”
- wide cinematic hero image of the current scene
- narration in a dark translucent readable panel
- compact soundtrack row such as “♫ Soft cinematic soundtrack”
- elapsed time
- Pause
- End

When a choice arrives, the same Conversation surface shows the prompt and two large accessible choice buttons. Example:
“What would you like to do?”
“Follow the light”
“Stay by the old tree”

The normal composer remains at the bottom with placeholder “Talk to the story…” and helper text “You can speak or type your reply”.

No duplicate floating HUD. No giant soundtrack video as the dominant conversation content. Background music is supporting material.
```

## Stage 5 — Complete

```text
Design the terminal Scene Tale state inside the same Conversation card.

Show:
- “✨ SCENE TALE”
- story title
- clear success state: “Story complete”
- subtitle: “Fictional story inspired by this scene”
- optional compact summary of the two choices the user made

Actions:
- “Save to Histories”
- “Another version”
- “Back to Together”

Playback is over. Do not show timer, Pause, Resume, or End. The same card transforms into completion rather than opening a second modal.
```

## Scene art contract

Scene Tale uses the same canonical ambience artwork as the current place. `assets/ambient/scene-tale-art.json` maps every registered scene to landscape, thumbnail, and portrait assets.

For a regenerated art set, create one landscape image and one portrait image per scene. Do not create different art for Stage 1 and Stage 4; the same place should be visually recognizable throughout the flow.

### Shared scene-art prompt

```text
Create a premium cinematic environmental illustration for HomePilot Scene Tale.

Requirements:
- environment only; no people, avatar, UI, typography, logos, watermark, or embedded text
- emotionally evocative but family-friendly
- realistic-fantasy / cinematic storybook treatment, not a cartoon panel
- layered depth, atmospheric light, clear focal point
- strong readability at thumbnail size
- composition remains useful when cropped inside a wide story card
- no factual-history implication; this is a fictional story setting
- consistent visual language across the entire scene library

Landscape target: 16:9.
Portrait target: 9:16 using the same location, lighting, palette, and recognizable landmarks.
```

## Registered scene prompts

The following list is exhaustive for `assets/ambient/backgrounds.json` at the time this document was added.

### ocean-sunrise — Ocean · Sunrise

```text
Calm ocean viewed from a beautiful coast at dawn, soft peach and pale-blue sunrise, gentle waves, light atmospheric haze, luminous horizon, quiet open space, fresh optimistic morning mood. Premium cinematic realistic-fantasy environmental illustration, no people, no text.
```

### ocean-moonlight — Ocean · Moonlight

```text
Calm ocean coast at night under clear moonlight, silver reflections across dark blue water, subtle clouds, quiet shoreline depth, restrained cool palette, serene and slightly mysterious mood. Premium cinematic realistic-fantasy environmental illustration, no people, no text.
```

### mountain-lake-day — Mountain Lake · Day

```text
Pristine mountain lake in daylight, still reflective water, layered evergreen shoreline, majestic distant mountains, soft natural sunlight, open sky and peaceful depth, restorative nature mood. Premium cinematic realistic-fantasy environmental illustration, no people, no text.
```

### mountain-lake-night — Mountain Lake · Night

```text
Mountain lake at night, dark reflective water, moonlit mountain silhouettes, subtle stars, cool blue atmosphere, sparse warm distant lights if appropriate, peaceful secluded mood. Premium cinematic realistic-fantasy environmental illustration, no people, no text.
```

### meditation-garden-day — Meditation Garden · Day

```text
Quiet landscaped meditation garden in daylight, stone path, restrained greenery, gentle water or small pond, balanced natural composition, soft daylight, calm restorative mood, elegant rather than ornate. Premium cinematic realistic-fantasy environmental illustration, no people, no text.
```

### meditation-garden-night — Meditation Garden · Night

```text
Meditation garden at night with moonlit plants, stone path, small reflective water feature, subtle lantern glow, gentle mist, deep teal and blue palette, intimate calm atmosphere. Premium cinematic realistic-fantasy environmental illustration, no people, no text.
```

### coastal-terrace-day — Coastal Terrace · Day

```text
Elegant open coastal terrace in daylight, railing overlooking a blue bay or sea, distant hills, tasteful plants and architecture, soft sun, airy calm composition, inviting place to linger. Premium cinematic realistic-fantasy environmental illustration, no people, no text.
```

### coastal-terrace-twilight — Coastal Terrace · Twilight

```text
Elegant coastal terrace during blue hour, warm architectural and lantern lights, railing overlooking calm water, distant hills, blue-purple twilight sky, intimate reflective atmosphere, sophisticated cinematic lighting. Premium cinematic realistic-fantasy environmental illustration, no people, no text.
```

### open-sky-day — Open Sky · Day

```text
Expansive peaceful daytime sky with layered soft clouds and a minimal distant horizon, luminous natural blue, airy open composition, gentle sense of freedom and possibility, visually calm rather than dramatic. Premium cinematic realistic-fantasy environmental illustration, no people, no text.
```

### open-sky-starlight — Open Sky · Starlight

```text
Expansive clear night sky filled with restrained natural starlight above a minimal dark horizon, subtle atmospheric gradient, deep blue-black palette, quiet wonder and spaciousness, no exaggerated sci-fi objects. Premium cinematic realistic-fantasy environmental illustration, no people, no text.
```

## Naming and output contract

Keep production names stable:

```text
assets/ambient/light/ocean-sunrise.webp
assets/ambient/dark/ocean-moonlight.webp
assets/ambient/light/mountain-lake-day.webp
assets/ambient/dark/mountain-lake-night.webp
assets/ambient/light/meditation-garden-day.webp
assets/ambient/dark/meditation-garden-night.webp
assets/ambient/light/coastal-terrace-day.webp
assets/ambient/dark/coastal-terrace-twilight.webp
assets/ambient/light/open-sky-day.webp
assets/ambient/dark/open-sky-starlight.webp
```

Portrait companions use the same basename plus `-portrait.webp`.

Do not add a second independent Scene Tale image directory unless the product intentionally wants different fictional art from the current ambience. By default, Scene Tale should show the same place the user is actually seeing.

## API batch-generation guidance

When generating with an image API, do not embed the API key in source, prompts, commits, browser JavaScript, or PR comments. Supply it through an environment variable or secret store.

Recommended batch logic:

```text
for every scene in assets/ambient/scene-tale-art.json:
  generate landscape from shared scene-art prompt + scene-specific prompt
  generate portrait using the same location/style prompt and a portrait composition request
  validate no text/UI/people were introduced
  resize/crop to the project's production dimensions
  encode WebP
  replace only the paths declared by the manifest
  run ambience + Scene Tale tests
```

A generated asset is accepted only when:

- the location is immediately recognizable from its label;
- day/night variant is unmistakable;
- thumbnail crop remains readable;
- landscape and portrait depict the same place;
- no text, watermark, UI, or foreground person appears;
- Stage 1 thumbnail and Stage 4 hero resolve to the same canonical scene artwork.
