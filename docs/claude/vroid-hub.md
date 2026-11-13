<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# VRoid Hub in the Avatar Library

`vrm-manager.html` / `vrm-manager.js` is the Avatar Library. Its VRoid Hub
sign-in (OAuth + PKCE, registered redirect origins), keyword search and
download-licence install predate this note and are unchanged.

- **A pasted model link is a lookup, not a keyword search (V1).**
  `src/avatar-library/VroidLinks.js` finds model ids in whatever was typed — one
  link, a pasted list with names between the links, links glued together by an
  `<input>` dropping newlines, or nothing but bare ids. The Library then matches
  those ids, fetches the missing models and _appends_ them; nothing is removed,
  and the text is never sent to VRoid Hub's keyword search.
- **Model details are public; downloading is not.** `action=detail` works signed
  out in both proxies (`nexus-proxy/server.js` had no `detail` at all until V1 —
  keep the two proxies' action lists in step). Every other action still needs
  the user's token, and installing says "sign in" when there is none.
- **VRoid Hub nests a detail answer in `data.character_model`**, and a VRM 1.0
  model keeps its conditions of use in
  `latest_character_model_version.vrm_meta`, not in `license` (whose fields are
  null for VRM 1.0). `unwrapDetail` and `conditionsFromVrmMeta` read both.
- **A thumbnail shows on its card as soon as it is made (V5).** The first visit
  renders every core avatar's thumbnail in turn (each a 10–15 MB VRM) and used
  to redraw the grid only when all were done, so the page sat on emoji
  placeholders until reloaded. `generateAndSaveThumbnail` now calls
  `showCardPreview`, which swaps the placeholder on every card carrying that
  `data-avatar-id`; one avatar that fails no longer ends the run.
