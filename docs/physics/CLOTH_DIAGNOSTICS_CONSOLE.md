# Cloth diagnostics console

Specification only. Do not build this as a general settings panel. It is a developer overlay for one question: why did this garment fail the gate or the picture.

## Entry

`?clothDebug=1` on the Try-On page. Absent the flag, the module is not imported and no overlay is constructed. `?cloth=xpbd` and `?cloth=rapier` still select the backend. Debug does not enable a backend by itself.

The overlay is a single DOM panel on top of the viewer, default collapsed to a one-line status. It is not a second scene graph and it does not change materials on the garment except while a visualisation toggle is on.

## Layout

```text
Cloth debug                                    [collapse]
Backend [ skeletal | xpbd | rapier ]   Pose [ standing | sittingDesk | sittingWide | sittingCrossed ]
<garment name>   <template id>   schema wardrobe.cloth/1
particles / triangles / lod / attachment source / missing seams / fallback reason
[ Reset pose ] [ Step one settle ] [ Pause ] [ Export JSON ]
overlays: particles, edges, pins, capsules, contacts, normals, inverted tris
telemetry: worker ms, main-thread ms, contacts, strain, pen, stretch, span
```

Backend buttons call the same worker protocol the page already uses. They do not construct a second avatar. `rapier` is disabled, not hidden, until that backend exists, and the disabled control says why.

Pose buttons call the existing pose system. They do not invent a new sit.

## Fields, and where they already come from

| Field | Source today | Gap |
|---|---|---|
| Template id, schema, profile, particle count, missing seams, attachment source | `wardrobeForge.clothAsset` on the node | Show `fallback-skinning` reason. It is the difference between "XPBD ran" and "the asset refused" |
| Active backend | worker `solver` echo | Add it to the cloth status row. Today a legacy row has no solver field, which is correct |
| Fallback reason | worker `{ ok: false, why }` | Already stored on the row when the pilot falls back. Surface it |
| Worker ms, contacts, strain, frames | XPBD result row | Keep. Do not log them per animation frame |
| Penetration, stretch, span | `PoseClothCorrection.inspect` | The reference positions must be the skinned pose, not rigid `matrixWorld`. Until that fix, label the numbers "compared with rigid bind" so a 9× reading is not mistaken for a solver explosion |
| Main-thread time | not recorded | `performance.now()` around the worker round trip, once per settle |
| Heap | not recorded | `performance.memory` when the browser exposes it. Omit the row otherwise. Do not polyfill |

## Visualisation

Drawn in a separate `THREE.Group` removed when the panel closes.

- Particles: points at the simulated positions, file order.
- Structural edges: the WCL1 stretch pairs, not every render edge.
- Pins: attachment ≥ 0.999, a different colour.
- Capsules: the two thigh segments and their radii, in the same space as the particles.
- Contacts: only the particles `collide` moved on the last iteration. Capped at a few hundred markers.
- Normals and inverted triangles: one pass over the render mesh when the toggle is turned on, not every frame.

If the geometry index prefix is not the file prefix (`0, 1, 34` for the current A-line), the panel shows a blocking line: "vertex order does not match WCL1". Overlays still draw, and they will look wrong. That line is the defect from the audit, and the console exists to make it obvious.

## Export

One JSON object, pretty-printed, downloaded as `cloth-debug-<templateId>-<pose>.json`. No screenshot is embedded (those stay in the audit capture). Suggested shape:

```json
{
  "schema": "wardrobe.cloth.debug/1",
  "templateId": "dress-a-line-v1",
  "pose": "sittingWide",
  "backend": "xpbd",
  "fallback": null,
  "asset": { "particles": 1536, "renderVertices": 1584, "missingSeams": 0, "attachmentSource": "height-fallback" },
  "vertexOrder": "file",
  "timing": { "workerMs": 0, "mainThreadMs": 0 },
  "solver": { "frames": 8, "substeps": 2, "iterations": 6, "contacts": 0, "strain": 0 },
  "gate": { "maxPenetrationMm": 0, "maxEdgeStretch": 0, "maxSpanDropMm": 0, "limits": [1, 6, 8] },
  "capsules": [{ "radius": 0, "length": 0, "lap": true }]
}
```

The export is the input to a bug report. It is not a pass certificate. `review_pictures.py` still decides pictures.

## Cost

When the flag is off, cost is one query-string check already similar to `?cloth=xpbd`. When it is on, the overlay allocates its point geometry at panel open and frees it on close. Telemetry is one record per settle, the same cadence as `clothStatus()`, not per `requestAnimationFrame`.

## Implementation boundary

One new module, imported by `PoseClothCorrector` or `VRPoseSystem` only after the flag check. It reads status. It does not fork the solver. Visualisation uses positions the worker already returns. Do not add a second simulation to feed the overlay.

Suggested PR: after M1 (vertex order), so the first thing an engineer sees is not a scrambled binding. See milestone M5 in `CONSOLIDATED_UPGRADE_PLAN.md`.
