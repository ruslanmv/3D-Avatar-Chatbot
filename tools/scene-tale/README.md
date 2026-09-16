# Scene Tale art generator

This directory contains the machine-readable prompt pack and the batch generator for the complete Scene Tale scene-art library.

The runtime source of truth remains `assets/ambient/scene-tale-art.json`. Every registered ambience scene gets two independent compositions:

- landscape master: **1920×1080 WebP**
- portrait master: **1080×1920 WebP**

Stage 1 thumbnails intentionally reuse the landscape master, so setup and playback always show the same place and the project does not maintain a second drifting thumbnail library.

## Generate every scene

Use an environment variable. Never put a key in the repository, command history, prompt JSON, PR body, or browser code.

```bash
export OPENAI_API_KEY='...'
python tools/scene-tale/generate-scene-tale-art.py --all --overwrite
```

Default model: `gpt-image-2.5-sunburst`

Default quality: `high`

Override either without editing source:

```bash
SCENE_TALE_IMAGE_MODEL=gpt-image-2.5-flare \
SCENE_TALE_IMAGE_QUALITY=high \
OPENAI_API_KEY='...' \
python tools/scene-tale/generate-scene-tale-art.py --all --overwrite
```

Generate only one scene:

```bash
OPENAI_API_KEY='...' \
python tools/scene-tale/generate-scene-tale-art.py \
  --scene coastal-terrace-twilight \
  --overwrite
```

Inspect the exact 20-job plan without making API calls:

```bash
python tools/scene-tale/generate-scene-tale-art.py --all --dry-run
```

## Safety and consistency rules

The key is read only from `OPENAI_API_KEY` and is never accepted as a CLI argument or written to disk. The generator validates that `scene-art-prompts.json`, `scene-tale-art.json`, and `backgrounds.json` cover the same scene set before making any API call.

Landscape and portrait are generated independently; portrait is not a crop of the desktop image. The request asks for the same recognizable location, palette, landmarks, and time of day in both compositions. The final files are center-cover cropped/resized to the production dimensions and encoded as WebP.

The generator writes only the canonical ambience paths declared by `scene-tale-art.json`. It does not add a parallel Scene Tale image directory.

After generation run the repository validation suite before committing images:

```bash
npm run validate
```

At minimum, verify visually that every image has no text/UI/watermark/person, the day/night variant is obvious, the avatar has a believable grounding zone, and the landscape remains readable at the small Stage 1 thumbnail size.
