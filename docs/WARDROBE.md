# Wardrobe Forge / Try-On Haul

The wardrobe feature has two sources behind one UI:

- **Static source (default):** `/vendor/wardrobe/wardrobe.json`
- **Remote source (optional):** a deployed `3D-Wardrobe-Forge` API

Static looks continue to work when the remote service is unavailable. Both sources ultimately provide a normal VRM URL, so the feature uses the existing `AvatarManager.setAvatarByUrl()` path and does not modify the Three.js renderer.

## Static deployment (the default wardrobe)

The app ships a wardrobe pack in `vendor/wardrobe/` — ten everyday looks, two for each
of the five bundled avatars, made by 3D-Wardrobe-Forge and verified byte for byte. It
works with no Forge, no key and no network beyond this site. See
`docs/WARDROBE_IMPORT.md` for the contract and the reasons behind it.

Never copy files into `vendor/wardrobe/` by hand. Make a pack in the Forge and import it:

```bash
# in 3D-Wardrobe-Forge
python tools/export_default_wardrobe.py OUT --web-previews --zip homepilot-default.zip
# here
npm run wardrobe:import -- ../3D-Wardrobe-Forge/homepilot-default.zip
npm run wardrobe:check      # also run by Jest, so `npm run validate` fails on a bad pack
```

The import validates every byte (sizes, SHA-256, VRM humanoid, the avatar pins, public
ratings, no stray files) and swaps the folder in whole, or changes nothing.

## Remote generation

Set configuration before the wardrobe scripts run:

```html
<script>
window.NEXUS_WARDROBE_CONFIG = {
    enabled: true,
    staticManifest: '/vendor/wardrobe/wardrobe.json',
    // Any Forge-compatible URL: a Hugging Face Space, Cloud Run, localhost.
    forge: { enabled: true, baseUrl: 'https://YOUR-SPACE.hf.space' },
};
</script>
```

Without that, the wardrobe uses the project's Forge on Hugging Face by default (WF1), and each person can choose their own endpoint, or none, in **Settings ▸ Wardrobe Forge** (stored as `wardrobe_forge_mode` and `wardrobe_forge_url`). A page that sets `forge` decides for everyone, and Settings says so. See `docs/TRY_ON_TOGETHER.md` § Configuration.

Do not put a long-lived production API secret in browser JavaScript. For production, proxy generation through the application backend or mint short-lived tokens. The optional `token` config field is intended for short-lived credentials and controlled deployments.

## User flow

1. The wardrobe button opens the Try-On Haul drawer.
2. Looks come from the built-in pack, then Forge, keyed by source, pack and avatar —
   and only the looks made for the avatar she is are shown.
3. Selecting a look loads its VRM through `AvatarManager`.
4. When remote generation is enabled, the user can describe an outfit.
5. The browser posts `/v1/generate`, polls the existing job endpoint, and shows real pipeline states.
6. A completed `look.vrm` is loaded through the same AvatarManager path.
7. "Restore original" returns to the avatar that was active before the first wardrobe swap.

## Licensing

When VRM Manager has stored `conditionsOfUse` for the active avatar, the controller forwards them to Forge. If terms are unknown and Forge requests attestation, the drawer asks the user for confirmation. A source that explicitly forbids modification is not overridden.

## Global API

After boot:

```javascript
window.NEXUS_WARDROBE.service.listLooks();
window.NEXUS_WARDROBE.service.generate('black satin cocktail dress');
window.NEXUS_WARDROBE.service.applyLook(look);
window.NEXUS_WARDROBE.service.restore();
```

Set `window.NEXUS_WARDROBE_CONFIG.enabled = false` before page scripts load to disable the feature.
