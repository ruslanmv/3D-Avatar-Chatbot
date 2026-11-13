"""Offline smoke tests; the browser/Forge integration is run by capture.py."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# Supports `python -m unittest discover -s audits/wardrobe_sitting_desk`.
sys.path.insert(0, str(Path(__file__).parent))
from capture import (  # noqa: E402
    CLOTH_OBSERVER_JS,
    VIEWS,
    context_init_script,
    matching_items,
    metric_findings,
    parse_args,
    report,
    slug,
)


class CaptureHelpersTest(unittest.TestCase):
    def test_stable_safe_names(self):
        self.assertEqual(slug("Black Pencil Mini Skirt"), "black-pencil-mini-skirt")
        self.assertEqual(slug("../"), "unnamed")
        self.assertLessEqual(len(slug("X" * 200)), 70)

    def test_capture_waits_without_cloth_status(self):
        script = Path(__file__).with_name("capture.py").read_text(encoding="utf-8")
        self.assertNotIn("typeof p.clothStatus !== 'function') return true", script)
        self.assertIn("__auditReadCloth", CLOTH_OBSERVER_JS)
        self.assertIn("cloth.phase = result ? 'applied' : 'skipped'", CLOTH_OBSERVER_JS)
        opts = parse_args([])
        self.assertIsNone(opts.forge_url)
        self.assertIsNone(opts.avatar)
        self.assertIn(CLOTH_OBSERVER_JS, context_init_script(opts))
        self.assertNotIn("if opts.forge_url or opts.avatar:", script)

    def test_resume_rebuilds_gate_findings_from_the_manifest(self):
        found = metric_findings(
            {
                "id": "garment-02-00-a-line-dress",
                "name": "A-line dress",
                "category": "Dresses",
                "poses": {
                    "sittingWide": {
                        "status": "ok",
                        "gate": {
                            "issues": [
                                {
                                    "code": "penetration",
                                    "severity": "P1",
                                    "garment": "Black A-Line Dress",
                                    "metric": "maxPenetrationMm",
                                    "value": 6,
                                    "limit": 1,
                                }
                            ]
                        },
                    },
                    "walking": {"status": "unsupported"},
                },
            }
        )
        self.assertEqual(len(found), 1)
        self.assertEqual(found[0]["pose"], "sittingWide")
        self.assertEqual(found[0]["actual"], "maxPenetrationMm is 6")

    def test_original_sitting_desk_capture_still_parses(self):
        opts = parse_args(["--poses", "sittingDesk", "--views", "front,side,back"])
        self.assertEqual(opts.poses, ["sittingDesk"])
        self.assertEqual(opts.views, ["front", "side", "back"])

    def test_views_have_independent_angles(self):
        self.assertEqual(VIEWS["front"], 0)
        self.assertEqual(VIEWS["right"], 90)
        self.assertEqual(VIEWS["side"], 90)
        self.assertEqual(VIEWS["back"], 180)
        self.assertEqual(VIEWS["left"], 270)
        self.assertEqual(VIEWS["opposite-side"], -90)

    def test_exact_name_beats_a_substring_and_a_look_key_is_exact(self):
        items = [
            {"name": "White Blouse + Grey Pencil Skirt", "key": "look_grey"},
            {"name": "Black Pencil Mini Skirt", "key": "look_black"},
        ]
        self.assertEqual(matching_items(items, only="Pencil")[0]["key"], "look_grey")
        self.assertEqual([item["key"] for item in matching_items(items, only="Black Pencil Mini Skirt")], ["look_black"])
        self.assertEqual(matching_items(items, key="look_grey")[0]["name"], "White Blouse + Grey Pencil Skirt")
        self.assertEqual(matching_items(items, only="missing"), [])

    def test_report_links_only_existing_captures(self):
        with tempfile.TemporaryDirectory() as directory:
            out = Path(directory)
            target = out / "looks" / "look-a"
            target.mkdir(parents=True)
            (target / "front.png").write_bytes(b"test")
            report(out, [{"name": "<Pencil|Skirt>", "source": "looks", "status": "error",
                          "folder": "looks/look-a", "error": "render failed"}], ["front", "back"])
            markdown = (out / "report.md").read_text()
            html = (out / "report.html").read_text()
            self.assertIn("front.png", markdown)
            self.assertNotIn("back.png", markdown)
            self.assertIn("&lt;Pencil|Skirt&gt;", html)
            self.assertNotIn("back.png", html)

    def test_reject_unknown_camera_view(self):
        with patch.object(sys, "argv", ["capture.py", "--views", "front,diagonal"]):
            with self.assertRaises(SystemExit):
                parse_args()

    def test_reject_unknown_pose(self):
        with patch.object(sys, "argv", ["capture.py", "--poses", "sittingDesk,floating"]):
            with self.assertRaises(SystemExit):
                parse_args()


if __name__ == "__main__":
    unittest.main()