<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# The page in Meta Quest Browser (Q8)

The 2D page looks **exactly** like desktop Chrome at the same window size — the
person asked for that, and a Playwright check compared every toolbar icon and
the chat row pixel for pixel. Headset-only CSS in `styles/main.css` may add
invisible hit area for controller rays (`::after` with `inset: -5px`) and size
ENTER VR/AR, nothing else; the old headset block that resized icons and text
also hid the ☰ menu, so its drawer could not be opened in the headset.

**The app's icon is the HomePilot mark (Q9).** `assets/app-icon.svg` and its
padded `app-icon-maskable.svg` are the sources; every PNG and `favicon.ico` is
rendered from them by `node tools/brand/render-app-icons.mjs` — edit the SVGs,
never the PNGs. A Quest shows these (and `short_name`, "HomePilot") for an
installed PWA; the headset's own loading transition for a browser tab is drawn
by the system and no page can change it. `tests/app-icons.test.js` guards the
favicon (it used to 404) and the maskable safe zone.
