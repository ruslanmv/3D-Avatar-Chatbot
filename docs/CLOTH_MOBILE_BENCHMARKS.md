# Cloth runtime measurements

No phone, headset, or thermal chamber was available for this change. The
numbers below are a Node process on the cloud agent VM. They are not a mobile
frame time and they are not a production budget.

## Setup

A 14×14 hanging grid. 196 particles, 364 stretch constraints, top row pinned.
4 substeps, 4 iterations, compliance `1e-6`, gravity `-9.81`, no capsules, no
self-collision. 300 frames to settle, then 50 timed frames.

| | |
|---|---|
| Host | cloud VM CPU, not a device |
| Mean | 0.332 ms / frame |
| p50 | 0.262 ms |
| p95 | 0.317 ms |
| p99 | 0.319 ms |
| Max stretch after 300 frames | 1.028× rest |
| Process RSS | 53 MB, the whole Node process |

A skirt exported by Forge at 768 particles compiles in about 0.25 s and stores
a 200-particle mid LOD. That export cost is in the Forge doc of the same name.
Stepping 768 particles, with shear, bend, and capsules, was not timed here.

## Targets that are not yet measured

| Device | Target | Status |
|---|---|---|
| Low-end mobile | 30 FPS on skinning | unverified |
| Mid-range mobile | 30 FPS with a 200-particle garment | unverified |
| High-end mobile | 60 FPS with a 500-particle garment | unverified |
| Desktop | 60 FPS with a hero garment | unverified on a desktop GPU |

The VM step above is far under 16 ms for this one grid with no rendering, no
skinning, and no collision. That does not license a 60 FPS claim. Sustained
thermal behaviour was not measured. Worker transfer of the position buffer is
implemented and was not benchmarked against the main thread.
