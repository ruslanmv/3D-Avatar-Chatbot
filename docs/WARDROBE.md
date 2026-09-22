# Wardrobe Forge / Try-On Haul

The wardrobe feature has two sources behind one UI:

- **Static source (default):** `/vendor/wardrobe/wardrobe.json`
- **Remote source (optional):** a deployed `3D-Wardrobe-Forge` API

Static looks continue to work when the remote service is unavailable. Both sources ultimately provide a normal VRM URL, so the feature uses the existing `AvatarManager.setAvatarByUrl()` path and does not modify the Three.js renderer.

## Static deployment

Generate a bundle in 3D-Wardrobe-Forge and copy its contents into this app, for example:

```text
vendor/wardrobe/
├── wardrobe.json
├── avatars.json
├── catalog.json
├── provenance.json
└── looks/
    └── ...
```

The checked-in `vendor/wardrobe/wardrobe.json` is intentionally empty so this repository works without generated binary assets.

## Remote generation

Set configuration before the wardrobe scripts run:

```html
<script>
window.NEXUS_WARDROBE_CONFIG = {
    enabled: true,
    staticManifest: '/vendor/wardrobe/wardrobe.json',
    apiUrl: 'https://YOUR-SPACE.hf.space',
    remoteGeneration: true
};
</script>
```

For local testing, `wardrobe_forge_url` and `wardrobe_enabled` can also be placed in localStorage.

Do not put a long-lived production API secret in browser JavaScript. For production, proxy generation through the application backend or mint short-lived tokens. The optional `token` config field is intended for short-lived credentials and controlled deployments.

## User flow

1. The wardrobe button opens the Try-On Haul drawer.
2. Static and previously generated looks are merged and deduplicated.
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
