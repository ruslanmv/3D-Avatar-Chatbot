# Motion on Forge-dressed avatars

Four prebuilt Forge looks on `fem-vroid`, loaded into the app, driven by typed commands. Hips height and root position after each step; one screenshot per step in this folder.

| Look | sit down | stand up | dance | stop | come with me (root z) | stop | Page errors | Garment notes |
| ---- | -------: | -------: | ----: | ---: | --------------------: | ---: | ----------: | ------------- |
| skirt-pleated-mini-v1 (black) | 0.526 | 0.891 | 0.327 | 0.879 | 3.27 m | 0.892 | 0 | Beige foundation briefs show as a band at the waist and poke through the pleats (stop, follow frames). |
| dress-a-line-v1 (black) | 0.526 | 0.895 | 0.832 | 0.882 | 3.36 m | 0.891 | 0 | Seated, the skirt forms a floating hoop (known cloth issue, Forge #22); dancing deforms the skirt. |
| jeans-straight-v1 (black) | 0.526 | 0.891 | 0.893 | 0.886 | 3.33 m | 0.892 | 0 | Beige briefs show through the jeans at the hips (dance, follow frames). |
| under-bodysuit-v1 (black) | 0.526 | 0.891 | 0.926 | 0.886 | 3.35 m | 0.891 | 0 | No garment defect visible in these frames. |

Standing height is about 0.89 m and seated 0.53 m. Before MO6 three of the four looks stayed at 0.52 m after "stand up": the BVH retargeter had built the standing idle around her seated hips. Cloth defects belong to the Forge cloth pipeline (Forge issue #22), not to motion.
