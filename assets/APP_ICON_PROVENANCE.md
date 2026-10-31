# App icon provenance (Q9)

| File                                                       | Source                                                         |
| ---------------------------------------------------------- | -------------------------------------------------------------- |
| `app-icon.svg`                                             | The HomePilot mark from `homepilot-logo.svg` (this repository) |
| `app-icon-maskable.svg`                                    | `app-icon.svg`, mark scaled into the safe zone                 |
| `app-icon-512.png`, `app-icon-192.png`, `app-icon-180.png` | Rendered from `app-icon.svg`                                   |
| `app-icon-maskable-512.png`, `app-icon-maskable-192.png`   | Rendered from `app-icon-maskable.svg`                          |
| `../favicon.ico` (16/32/48 px)                             | Rendered from `app-icon.svg`                                   |

All are this project's own artwork under the repository's Apache-2.0 licence. No
third-party images, fonts or icons are included.

Regenerate every raster file with:

```bash
node tools/brand/render-app-icons.mjs
```

Edit the SVGs, never the PNGs: the PNGs are what a Quest, an Android launcher
and a browser tab show, and the tool is how they stay the same picture as the
SVG. `tests/app-icons.test.js` checks the manifest's icons exist at their
declared sizes, that the maskable icons are their own padded pictures, and that
`favicon.ico` exists.
