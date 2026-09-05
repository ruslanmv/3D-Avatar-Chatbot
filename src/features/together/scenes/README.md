# Scene assets

The three manifests here are complete and loadable. The art they point at — the
8K equirectangular KTX2 skyboxes and the ambient `.ogg` loops — is **not in the
repository**.

That is deliberate rather than unfinished. Those are licensed art assets, they
are tens of megabytes each, and choosing them is an art direction decision
rather than a code one. The loader is built for their absence: every manifest
carries a `fallbackColor`, a scene whose skybox fails to load enters anyway with
that colour as the background, and `tests/behavior/scenes.test.js` covers the
missing-asset path as a first-class case rather than an error.

To add the art, drop the files at the paths the manifests name:

```
src/features/together/scenes/assets/forest_8k.ktx2
src/features/together/scenes/assets/forest_loop.ogg
src/features/together/scenes/assets/ocean_8k.ktx2
src/features/together/scenes/assets/ocean_loop.ogg
src/features/together/scenes/assets/meditation_8k.ktx2
src/features/together/scenes/assets/meditation_loop.ogg
```

KTX2 needs `KTX2Loader` with a transcoder; the loader is injected, so wiring one
is a constructor argument rather than a change here. Equirectangular textures
must be marked `EquirectangularReflectionMapping` — the loader does that, not
the asset.
