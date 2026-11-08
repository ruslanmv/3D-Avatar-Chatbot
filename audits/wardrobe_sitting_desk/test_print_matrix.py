"""The picture table. No browser and no Forge."""

import csv
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from print_matrix import carry_reviews, picture_rows, regressions, volume_description, write_csv  # noqa: E402


def manifest():
    return {
        "entries": [
            {
                "name": "Basic tee",
                "folder": "screenshots/catalog/garment-00-00-basic-tee",
                "category": "Tops (13)",
                "status": "ok",
                "poses": {
                    "standing": {"clothPhase": "applied", "gate": {"ok": True, "issues": []}},
                    "sittingDesk": {
                        "clothPhase": "applied",
                        "gate": {
                            "ok": False,
                            "issues": [
                                {
                                    "garment": "Black Basic Tee [Forge_Tops_01_CLOTH]",
                                    "metric": "maxSpanDropMm",
                                    "value": 39,
                                    "limit": 8,
                                }
                            ],
                        },
                    },
                },
            },
            {
                "name": "Seamless Scrunch Leggings",
                "folder": "screenshots/catalog/garment-01-04-seamless-scrunch-leggings",
                "status": "not-captured",
                "reason": "The cloth correction on this mesh did not finish.",
                "poses": {},
            },
        ]
    }


INVENTORY = {
    "Basic tee": {
        "id": "top-tee-v1",
        "name": "Basic tee",
        "category": "Tops",
        "description": "Relaxed short-sleeved tee.",
        "hem": "mini",
        "silhouette": "straight",
    }
}


class PictureTableTest(unittest.TestCase):
    def test_volume_names_the_silhouette_and_the_frame(self):
        text = volume_description(INVENTORY["Basic tee"], "sittingWide", "front")
        self.assertIn("Relaxed short-sleeved tee", text)
        self.assertIn("silhouette straight", text)
        self.assertIn("hem mini", text)
        self.assertIn("Sitting (Wide)", text)
        self.assertIn("front camera", text)

    def test_a_clean_pose_is_not_marked_fixed_and_a_miss_is_no(self):
        rows = picture_rows(manifest(), INVENTORY, None)
        standing = [row for row in rows if row["garment_name"] == "Basic tee" and row["pose"] == "standing"]
        desk = [row for row in rows if row["garment_name"] == "Basic tee" and row["pose"] == "sittingDesk"]
        self.assertEqual(len(standing), 4)
        self.assertTrue(all(row["fixed"] == "n/a" and row["bug_found"] == "" for row in standing))
        self.assertTrue(all(row["fixed"] == "no" for row in desk))
        self.assertIn("maxSpanDropMm=39", desk[0]["bug_found"])
        self.assertIn("WARDROBE-CLIP-001", desk[0]["solution"])
        self.assertTrue(all(row["fixed"] != "yes" for row in rows))
        self.assertTrue(all(row["review_status"] == "pending" for row in rows))
        self.assertTrue(all(row["review_comment"] == "" for row in rows))
        self.assertEqual(
            desk[0]["picture_path"],
            "screenshots/catalog/garment-00-00-basic-tee/sittingDesk/front.png",
        )
        self.assertEqual(desk[0]["garment_id"], "top-tee-v1")
        self.assertEqual(desk[0]["category"], "Tops")

    def test_a_skipped_mesh_has_a_row_for_every_missing_picture(self):
        rows = [
            row
            for row in picture_rows(manifest(), INVENTORY, None)
            if row["garment_name"].startswith("Seamless")
        ]
        self.assertEqual(len(rows), 16)
        self.assertTrue(all(row["fixed"] == "no" for row in rows))
        self.assertIn("did not finish", rows[0]["bug_found"])
        self.assertIn("--cloth-timeout", rows[0]["solution"])

    def test_a_new_bug_on_a_clean_picture_is_a_regression(self):
        rows = picture_rows(manifest(), INVENTORY, None)
        clean = [dict(row) for row in rows if row["pose"] == "standing"]
        dirty = [dict(row) for row in clean]
        dirty[0]["bug_found"] = "Black Basic Tee maxPenetrationMm=4 (limit 1)"
        dirty[0]["fixed"] = "no"
        found = regressions(clean, dirty)
        self.assertEqual(len(found), 1)
        self.assertIn("was clean", found[0])
        self.assertEqual(regressions(rows, rows), [])

    def test_a_review_survives_only_while_the_bug_is_unchanged(self):
        rows = picture_rows(manifest(), INVENTORY, None)
        previous = [dict(row) for row in rows]
        previous[0]["review_status"] = "pass"
        previous[0]["review_comment"] = "Closed garment, no clip."
        kept = carry_reviews([dict(row) for row in rows], previous)
        self.assertEqual(kept[0]["review_status"], "pass")
        self.assertEqual(kept[0]["review_comment"], "Closed garment, no clip.")
        changed = [dict(row) for row in rows]
        changed[0]["bug_found"] = "Black Basic Tee maxPenetrationMm=4 (limit 1)"
        cleared = carry_reviews(changed, previous)
        self.assertEqual(cleared[0]["review_status"], "pending")
        self.assertEqual(cleared[0]["review_comment"], "")
        self.assertIn("bug_found changed", cleared[0]["notes"])

    def test_csv_round_trip_keeps_the_columns(self):
        rows = picture_rows(manifest(), INVENTORY, None)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog-matrix.csv"
            write_csv(path, rows)
            with path.open(encoding="utf-8", newline="") as handle:
                header = next(csv.reader(handle))
            self.assertEqual(
                header,
                [
                    "picture_path",
                    "garment_id",
                    "garment_name",
                    "category",
                    "pose",
                    "view",
                    "volume_description",
                    "bug_found",
                    "solution",
                    "fixed",
                    "notes",
                    "review_status",
                    "review_comment",
                ],
            )


if __name__ == "__main__":
    unittest.main()
