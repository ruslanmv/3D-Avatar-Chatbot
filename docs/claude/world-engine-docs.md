<!-- Moved verbatim from CLAUDE.md on 2026-11-08 so sessions load it only when working on this feature. Keep it accurate: if something here is wrong, fix it in the same change. -->

# NEXUS World Engine documentation

**An agent adding a world, spot, object, behaviour or story starts at
`docs/engine/AI_CODER_START_HERE.md`.** `docs/engine/` covers:

- the AI turn end to end (`NEXUS_AI_ARCHITECTURE.md`)
- coordinates and the measuring tool (`NEXUS_SPATIAL_COORDINATES.md`)
- the asset pipeline
- the engine contracts, each marked EXISTS, PARTIAL or PROPOSED
- the authoring guides, the templates, three tutorials and the roadmap

`tests/engine-docs.test.js` holds those docs to the code. Change a cited
function, path or measured spot and update the doc in the same commit.
