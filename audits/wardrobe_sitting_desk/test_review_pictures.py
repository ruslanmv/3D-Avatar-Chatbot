"""The visual release gate. No browser."""

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from print_matrix import picture_rows, write_csv  # noqa: E402
from review_pictures import block_reasons, next_pictures, record_review  # noqa: E402
from test_print_matrix import INVENTORY, manifest  # noqa: E402


class ReviewPicturesTest(unittest.TestCase):
    def test_next_returns_a_pending_picture_and_record_stores_the_comment(self):
        rows = picture_rows(manifest(), INVENTORY, None)
        nxt = next_pictures(rows, None, "front", 1)
        self.assertEqual(len(nxt), 1)
        self.assertTrue(nxt[0]["picture_path"].endswith("/front.png"))
        error = record_review(rows, nxt[0]["picture_path"], "fail", "Shoulder seam is open.")
        self.assertEqual(error, "")
        self.assertEqual(rows[0]["review_status"], "fail")
        self.assertEqual(rows[0]["review_comment"], "Shoulder seam is open.")
        self.assertIn("Shoulder seam is open.", block_reasons(rows)[0])

    def test_pass_is_refused_while_the_metric_bug_is_open(self):
        rows = picture_rows(manifest(), INVENTORY, None)
        desk = next(row for row in rows if row["pose"] == "sittingDesk" and row["view"] == "front")
        error = record_review(rows, desk["picture_path"], "pass", "Looks fine to me.")
        self.assertIn("refusing pass", error)
        self.assertEqual(desk["review_status"], "pending")

    def test_a_table_of_passes_is_the_only_production_pass(self):
        rows = picture_rows(manifest(), {"Basic tee": INVENTORY["Basic tee"]}, None)
        # Drop the not-captured garment and the metric miss so a full pass is possible.
        rows = [row for row in rows if row["garment_name"] == "Basic tee" and row["pose"] == "standing"]
        self.assertTrue(block_reasons(rows))
        for row in rows:
            self.assertEqual(record_review(rows, row["picture_path"], "pass", "No clip."), "")
        self.assertEqual(block_reasons(rows), [])

    def test_check_command_blocks_until_every_picture_passes(self):
        from contextlib import redirect_stderr, redirect_stdout
        from io import StringIO

        from print_matrix import read_csv
        from review_pictures import main

        rows = picture_rows(manifest(), INVENTORY, None)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "catalog-matrix.csv"
            write_csv(path, rows)
            with redirect_stderr(StringIO()):
                self.assertEqual(main(["check", "--csv", str(path), "--limit", "2"]), 1)
            picture = rows[0]["picture_path"]
            recorded = main(
                [
                    "record",
                    "--csv",
                    str(path),
                    "--picture",
                    picture,
                    "--status",
                    "pass",
                    "--comment",
                    "Tee sits on the body.",
                ]
            )
            self.assertEqual(recorded, 0)
            saved = read_csv(path)
            self.assertEqual(saved[0]["review_status"], "pass")
            self.assertEqual(saved[0]["review_comment"], "Tee sits on the body.")
            with redirect_stdout(StringIO()) as stdout:
                self.assertEqual(main(["next", "--csv", str(path), "--count", "1"]), 0)
            listed = json.loads(stdout.getvalue())
            self.assertEqual(len(listed), 1)
            self.assertNotEqual(listed[0]["picture_path"], picture)


if __name__ == "__main__":
    unittest.main()
