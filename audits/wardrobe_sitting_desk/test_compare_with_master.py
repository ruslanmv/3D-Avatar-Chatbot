import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from PIL import Image  # noqa: E402

from compare_with_master import POSES, TILE, compose, layout, main  # noqa: E402


def fake_run(root: Path, name: str, colour, missing=()) -> Path:
    """A capture.py --out directory with one garment, solid-colour frames."""
    run = root / name
    folder = "screenshots/catalog/garment-a-line"
    poses = {}
    for pose in POSES:
        if pose in missing:
            poses[pose] = {"status": "error"}
            continue
        poses[pose] = {"status": "ok"}
        for view in ("front", "right"):
            path = run / folder / pose / f"{view}.png"
            path.parent.mkdir(parents=True, exist_ok=True)
            Image.new("RGB", (1440, 900), colour).save(path)
    run.mkdir(parents=True, exist_ok=True)
    (run / "manifest.json").write_text(json.dumps({"entries": [{"name": "A-line dress", "folder": folder, "poses": poses}]}))
    return run


class CompareWithMasterTest(unittest.TestCase):
    def test_master_is_the_first_row_and_each_candidate_follows(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            master = fake_run(root, "master", (255, 0, 0))
            change = fake_run(root, "change", (0, 0, 255))
            sheet = compose([("master", master), ("change", change)])
            self.assertEqual(sheet.size, layout(2))
            # Centre of the first tile in each row.
            self.assertEqual(sheet.getpixel((150 + TILE[0] // 2, 30 + TILE[1] // 2)), (255, 0, 0))
            self.assertEqual(sheet.getpixel((150 + TILE[0] // 2, 30 + TILE[1] + TILE[1] // 2)), (0, 0, 255))

    def test_a_pose_that_was_not_captured_is_left_empty_not_borrowed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            master = fake_run(root, "master", (255, 0, 0))
            change = fake_run(root, "change", (0, 0, 255), missing=("sittingWide",))
            sheet = compose([("master", master), ("change", change)])
            column = POSES.index("sittingWide") * 2
            left = 150 + column * TILE[0]
            self.assertNotEqual(sheet.getpixel((left + TILE[0] - 5, 30 + TILE[1] + 5)), (0, 0, 255))

    def test_two_different_garments_are_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            master = fake_run(root, "master", (255, 0, 0))
            other = fake_run(root, "other", (0, 0, 255))
            manifest = json.loads((other / "manifest.json").read_text())
            manifest["entries"][0]["name"] = "Pencil skirt"
            (other / "manifest.json").write_text(json.dumps(manifest))
            with self.assertRaises(SystemExit):
                compose([("master", master), ("other", other)])

    def test_cli_writes_the_sheet(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            master = fake_run(root, "master", (255, 0, 0))
            change = fake_run(root, "change", (0, 0, 255))
            out = root / "sheet.png"
            self.assertEqual(main(["--reference", str(master), "--candidate", str(change), "--out", str(out)]), 0)
            self.assertTrue(out.exists())


if __name__ == "__main__":
    unittest.main()
