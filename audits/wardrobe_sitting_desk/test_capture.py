"""Offline smoke tests; the browser/Forge integration is run by capture.py."""

import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

# Supports `python -m unittest discover -s audits/wardrobe_sitting_desk`.
sys.path.insert(0, str(Path(__file__).parent))
from capture import VIEWS, parse_args, report, slug  # noqa: E402


class CaptureHelpersTest(unittest.TestCase):
    def test_stable_safe_names(self):
        self.assertEqual(slug("Black Pencil Mini Skirt"), "black-pencil-mini-skirt")
        self.assertEqual(slug("../"), "unnamed")
        self.assertLessEqual(len(slug("X" * 200)), 70)

    def test_views_have_independent_angles(self):
        self.assertEqual(VIEWS["front"], 0)
        self.assertEqual(VIEWS["side"], 90)
        self.assertEqual(VIEWS["back"], 180)
        self.assertEqual(VIEWS["opposite-side"], -90)

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


if __name__ == "__main__":
    unittest.main()