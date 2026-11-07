"""Offline checks for issue ids, failure classes, pixel deltas and the release rollup."""

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from PIL import Image  # noqa: E402

from capture import catalog_garments, inventory_rows  # noqa: E402
from quality import (  # noqa: E402
    assess_metrics,
    classify_failure,
    image_delta,
    issue_id,
    known_issue_record,
    known_issue_records,
    summarize,
)


class QualityTest(unittest.TestCase):
    def test_issue_ids_stay_put(self):
        self.assertEqual(issue_id("penetration", "skirt-pencil-v1", "sittingDesk"), issue_id("penetration", "skirt-pencil-v1", "sittingDesk"))
        self.assertNotEqual(issue_id("penetration", "skirt-pencil-v1", "sittingDesk"), issue_id("penetration", "skirt-pencil-v1", "standing"))
        self.assertTrue(issue_id("span-drop", "dress", "sittingWide").startswith("WARDROBE-SPAN-"))
        self.assertEqual(known_issue_record()["id"], "WARDROBE-CLIP-001")
        self.assertEqual(known_issue_record()["status"], "mechanism-corrected")
        self.assertEqual([item["id"] for item in known_issue_records()], ["WARDROBE-CLIP-001", "WARDROBE-DEFORM-002"])
        self.assertEqual(known_issue_records()[1]["status"], "open")

    def test_failure_classes(self):
        self.assertEqual(classify_failure("Forge catalog unavailable: timeout", "apply"), "generation")
        self.assertEqual(classify_failure("sittingDesk did not apply", "pose"), "pose")
        self.assertEqual(classify_failure("Page.goto: net::ERR_CONNECTION_REFUSED", "startup"), "infrastructure")
        self.assertEqual(classify_failure("Look disappeared from rail: Navy", "apply"), "capture")

    def test_pixel_delta_is_zero_for_the_same_image_and_a_review_when_it_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            before = folder / "a.png"
            after = folder / "b.png"
            Image.new("RGB", (4, 4), (10, 20, 30)).save(before)
            Image.new("RGB", (4, 4), (10, 20, 30)).save(after)
            same = image_delta(before, after)
            self.assertEqual(same["meanAbs"], 0)
            Image.new("RGB", (4, 4), (200, 20, 30)).save(after)
            changed = image_delta(before, after)
            self.assertGreater(changed["meanAbs"], 0.02)
            self.assertEqual(changed["changedFraction"], 1)

    def test_every_catalog_garment_gets_an_explicit_status_and_walking_is_unsupported(self):
        payload = {
            "categories": [
                {
                    "id": "skirt",
                    "label": "Skirts",
                    "garments": [
                        {"id": "skirt-glam-pencil-mini-v1", "name": "Pencil Mini Skirt", "previewStatus": "ready", "previewUrl": "/preview"},
                        {"id": "trousers-leggings-v1", "name": "Leggings", "previewStatus": "pending", "previewUrl": ""},
                    ],
                }
            ]
        }
        garments = catalog_garments(payload)
        rows, issues = inventory_rows(garments)
        self.assertEqual([row["status"] for row in rows], ["not-captured", "not-captured"])
        self.assertEqual(rows[0]["poses"]["sittingDesk"]["status"], "not-captured")
        self.assertEqual(rows[0]["poses"]["walking"]["status"], "unsupported")
        ids = [issue["id"] for issue in issues]
        self.assertIn("WARDROBE-CLIP-001", ids)
        self.assertIn("WARDROBE-DEFORM-002", ids)
        self.assertTrue(any(issue["garmentId"] == "trousers-leggings-v1" for issue in issues))

    def test_release_is_not_ready_while_a_p1_is_only_mechanism_corrected(self):
        summary = summarize(
            [
                {
                    "status": "ok",
                    "poses": {
                        "standing": {"status": "ok"},
                        "walking": {"status": "unsupported"},
                    },
                }
            ],
            [known_issue_record()],
        )
        self.assertFalse(summary["releaseReady"])
        self.assertIn("WARDROBE-CLIP-001", summary["releaseBlockers"])
        self.assertEqual(summary["poseSlotsAccounted"], 2)
        self.assertEqual(summary["poseSlotsCaptured"], 1)

    def test_assess_metrics_reads_worker_numbers_without_the_page_global(self):
        gate = assess_metrics(
            [
                {"name": "briefs", "after": {"maxPenetrationMm": 2, "maxEdgeStretch": 2.02, "maxSpanDropMm": 0}},
                {"name": "jeans", "after": {"maxPenetrationMm": 0, "maxEdgeStretch": 2.77, "maxSpanDropMm": 0}},
            ]
        )
        self.assertFalse(gate["ok"])
        self.assertEqual(len(gate["issues"]), 1)
        self.assertEqual(gate["issues"][0]["garment"], "briefs")
        self.assertEqual(gate["issues"][0]["metric"], "maxPenetrationMm")
        self.assertEqual(gate["issues"][0]["severity"], "P1")


if __name__ == "__main__":
    unittest.main()
