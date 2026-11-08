# Catalog matrix for a later coder

Use this when you are Claude or Grok and the task is the wardrobe pictures: debug a miss, or prove a change did not regress.

Read this file before editing `src/wardrobe/PoseClothCorrection.js`. The picture table is the regression list. A green unit test is not a closed live picture.

## Copy this task

```text
Repo: 3D-Avatar-Chatbot
Branch base: cursor/wardrobe-catalog-matrix-5f80
Read: audits/wardrobe_sitting_desk/AGENT_MATRIX.md
Table: audits/wardrobe_sitting_desk/reports/catalog-matrix-2026-11-07/catalog-matrix.csv
Sheets: audits/wardrobe_sitting_desk/reports/catalog-matrix-2026-11-07/sheets/

Do not mark fixed=yes unless you recaptured that picture_path and its bug_found is empty.
Do not record review_status=pass while bug_found is set.
Do not raise the cloth gate to hide a number.
Do not commit the screenshots/ tree.
Production ships only when review_pictures.py check prints "production: pass".
WARDROBE-CLIP-001 and the crossed-leg 39x stretch are open. The committed CSV says fixed=no and review_status=pending.
```

## What the last run already proved

61 of 62 public catalog garments were worn in Try-On. Poses: standing (`standingRelaxed`), Sitting (Desk), Sitting (Wide), Sitting (Crossed). Cameras: front 0°, right 90°, back 180°, left 270°. Walking has no still frame.

Still open, and already in the CSV as `fixed=no`:

- Every skirt and dress drops through the lap. Sitting (Wide) span drop is about 40–60 mm. Bug id `WARDROBE-CLIP-001`. The span lift closed the two-thigh unit fixture and did not close these live frames.
- Plain leggings and high-waist leggings reach about 39× edge stretch in Sitting (Crossed). An extra `relax()` after the last projection pulled other trousers back inside the body. Do not put that relax back.
- Seamless Scrunch Leggings has no pictures. Its cloth correction did not finish. The runner skipped it with `--skip` so the rest of the matrix could finish.

## Files

| File | What it is |
|---|---|
| `audits/wardrobe_sitting_desk/capture.py` | Browser runner. One Forge job per catalog garment. |
| `audits/wardrobe_sitting_desk/print_matrix.py` | Turns a finished capture into the CSV and the contact sheets. No browser. |
| `audits/wardrobe_sitting_desk/review_pictures.py` | Multimodal review. `next`, `record`, `check`. Blocks a release on one miss. |
| `audits/wardrobe_sitting_desk/quality.py` | Gate: penetration 1 mm, edge stretch 6×, span drop 8 mm. |
| `reports/catalog-matrix-2026-11-07/catalog-matrix.csv` | One row per picture from the 2026-11-07 run. |
| `reports/catalog-matrix-2026-11-07/sheets/matrix-*.jpg` | All front frames for one pose on one sheet. Red label = gate miss. |
| `src/wardrobe/PoseClothCorrection.js` | The worker that pushes cloth. Loaded by `PoseClothWorker.js`, not by the page. |

The 976 frame PNGs are not in git. They were under the capture `--out` directory. The CSV `picture_path` is relative to that directory.

## CSV columns

| Column | Meaning |
|---|---|
| `picture_path` | Path of that picture inside the capture directory. Empty only when the folder was not recorded. |
| `garment_id` | Forge template id, from the catalog inventory. |
| `garment_name` | Name on the Try-On catalog card. |
| `category` | Catalog category, without the card count. |
| `pose` | `standing`, `sittingDesk`, `sittingWide`, or `sittingCrossed`. |
| `view` | `front`, `right`, `back`, or `left`. |
| `volume_description` | Catalog description, silhouette, hem, and which pose and camera this frame is. |
| `bug_found` | Gate miss on this pose: mesh, metric, value, limit. Empty when the pose passed. The four cameras share one measurement. |
| `solution` | What to do next. It is not a claim that the change is already in the tree and working. |
| `fixed` | `no` = this picture still misses the gate, or was never taken. `n/a` = no bug on this pose. `yes` = a later recapture of this same picture came back with an empty `bug_found`. This script never writes `yes`. |
| `notes` | Cloth phase, and whether the file was on disk. |
| `review_status` | `pending` until a model looks. Then `pass` or `fail`. |
| `review_comment` | What the model saw in that picture. Required when the status is recorded. |

Filter `fixed=no` and `view=front` to see each broken outfit once. Judge the front frame. The side and back rows repeat the same bug so the path of every picture is in the table.

## Reproduce the table and the sheets

Offline. No browser. Point `--run` at a directory that already contains `manifest.json` and `screenshots/`.

```bash
python -m pip install -r audits/wardrobe_sitting_desk/requirements.txt
python -m unittest discover -s audits/wardrobe_sitting_desk -p 'test_*.py' -q

python audits/wardrobe_sitting_desk/print_matrix.py \
  --run /tmp/wardrobe-catalog-matrix \
  --inventory audits/wardrobe_sitting_desk/reports/live-catalog-2026-11-07/inventory.json \
  --out audits/wardrobe_sitting_desk/reports/catalog-matrix-2026-11-07 \
  --baseline-csv audits/wardrobe_sitting_desk/reports/catalog-matrix-2026-11-07/catalog-matrix.csv
```

Exit 0 and the line `No regressions` means no clean picture gained a bug. Exit 1 prints each regression as `garment pose/view`.

`--no-sheets` writes only the CSV. Sheets need Pillow, which is already in `requirements.txt`.

## Capture again

The app must already be running at `http://127.0.0.1:8080/`. One catalog garment is one Forge job.

```bash
python audits/wardrobe_sitting_desk/capture.py \
  --source catalog --max-items 0 --avatar fem_vroid.vrm \
  --url http://127.0.0.1:8080/ \
  --out /tmp/wardrobe-catalog-matrix \
  --poses standing,sittingDesk,sittingWide,sittingCrossed \
  --resume \
  --skip "Seamless Scrunch Leggings"
```

`--resume` skips a garment only when its four poses and four cameras are already `ok` on disk. `--skip` is the exact catalog name. Use it only for a mesh whose cloth job does not return. After a hung job the runner reloads Try-On so the next garment is not stuck behind it.

Recapture one garment after a code change. Do not resume over the old pictures if you need the new frames: pass `--only "A-line dress"` into a new `--out`, or delete that garment's folder first.

```bash
python audits/wardrobe_sitting_desk/capture.py \
  --source catalog --only "A-line dress" --avatar fem_vroid.vrm \
  --url http://127.0.0.1:8080/ \
  --out /tmp/wardrobe-retest-aline \
  --poses sittingDesk,sittingWide,sittingCrossed
```

Then build a CSV for that directory and diff it. `fixed` may become `n/a` when the bug is gone. You still do not write `yes` until you have looked at the new front frame and the number is under the gate.

## Look at every picture

`review_pictures.py` is the production gate. The metric columns do not ship the clothes. You open each image, write the error you see, and update that row.

```bash
CSV=audits/wardrobe_sitting_desk/reports/catalog-matrix-2026-11-07/catalog-matrix.csv

python audits/wardrobe_sitting_desk/review_pictures.py next \
  --csv "$CSV" --run /tmp/wardrobe-catalog-matrix --count 1

python audits/wardrobe_sitting_desk/review_pictures.py record \
  --csv "$CSV" \
  --picture screenshots/catalog/garment-02-00-a-line-dress/sittingWide/front.png \
  --status fail \
  --comment "Hem fell through the lap. Briefs show in the opening."

python audits/wardrobe_sitting_desk/review_pictures.py check --csv "$CSV"
```

`next` prints JSON. Open `absolute_path`. Say what the cloth does: clip, hole, torn edge, or clean. Then `record`. Repeat until `next` prints `[]`.

`check` exits 1 if a single row is not `review_status=pass`. It prints the fix procedure: edit one cause, recapture that garment, rebuild the CSV, look again. A `pass` is refused while `bug_found` is still set. Rebuilding the CSV keeps a review only when `bug_found` is unchanged. A new metric miss clears the old comment back to `pending`.

Ship when `check` prints `production: pass` and exits 0.

## Verify a fix

1. Change one thing. Add or keep a unit test in `tests/wardrobe/pose-cloth-correction.test.js`.
2. Run `npx jest tests/wardrobe/pose-cloth-correction.test.js --watchman=false --no-coverage`.
3. Recapture the pictures whose CSV rows are `fixed=no` for that bug. The worker loads `PoseClothCorrection.js` on the next page load, so restart the capture process after the edit.
4. Run `print_matrix.py` on the new directory with `--baseline-csv` pointing at the committed CSV.
5. Open the new `sheets/matrix-sittingWide.jpg` and the front frame named in `picture_path`.
6. Leave `fixed=no` if the hem still parts or the stretch is still over 6×.

## Do not

- Do not set `fixed` to `yes` because the unit fixture passed. The fixture already passes for the span lift. The live hem does not.
- Do not treat a pixel diff as a defect by itself. `capture.py --baseline` records a review item with `confirmed: false`.
- Do not invent a preview URL or copy a sheet into `assets/catalog/previews`.
- Do not commit `screenshots/` or a capture `--out` directory. Commit the CSV, the four sheets, and the code.
- Do not "fix" a 2 mm brief penetration by raising `GATE.maxPenetrationMm`.
