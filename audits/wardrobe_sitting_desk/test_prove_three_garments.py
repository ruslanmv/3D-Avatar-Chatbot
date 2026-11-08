import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import prove_three_garments as prove  # noqa: E402


def write_run(out: Path, name: str, template: str, *, xpbd=True, status="ok"):
    out.mkdir(parents=True, exist_ok=True)
    (out / "inventory.json").write_text(json.dumps({"garments": [
        {"name": "Tube top", "preview": "http://f/v1/catalog/garments/top-tube-v1/preview?v=1"},
        {"name": name, "preview": f"http://f/v1/catalog/garments/{template}/preview?v=2"},
    ]}))
    metrics = [
        {"name": "Beige Briefs", "before": {"maxPenetrationMm": 0}, "after": {"maxPenetrationMm": 0}},
        {"name": "Main Garment", "before": None if xpbd else {"maxPenetrationMm": 9},
         "after": {"maxPenetrationMm": 3.5, "maxEdgeStretch": 1.2, "maxSpanDropMm": 4}},
    ]
    poses = {p: {"status": "ok", "clothPhase": "applied", "gate": {"ok": False}, "metrics": metrics}
             for p in prove.POSES}
    (out / "manifest.json").write_text(json.dumps({"entries": [{"name": name, "status": status, "poses": poses}]}))


class ProveThreeGarmentsTest(unittest.TestCase):
    def test_the_command_is_the_agreed_shape(self):
        cmd = prove.capture_command("python", "http://127.0.0.1:8080/?cloth=xpbd", "http://127.0.0.1:8090",
                                    "A-line dress", Path("/tmp/cloth-contract-aline"))
        pairs = dict(zip(cmd[2::2], cmd[3::2]))
        self.assertTrue(cmd[1].endswith("capture.py"))
        self.assertEqual(pairs["--url"], "http://127.0.0.1:8080/?cloth=xpbd")
        self.assertEqual(pairs["--forge-url"], "http://127.0.0.1:8090")
        self.assertEqual(pairs["--avatar"], "fem_vroid.vrm")
        self.assertEqual(pairs["--source"], "catalog")
        self.assertEqual(pairs["--only"], "A-line dress")
        self.assertEqual(pairs["--poses"], "standing,sittingDesk,sittingWide,sittingCrossed")
        self.assertEqual(pairs["--views"], "front,right,back,left")
        self.assertEqual(pairs["--out"], "/tmp/cloth-contract-aline")

    def test_the_three_pilots_and_their_templates(self):
        self.assertEqual([t for _, _, t in prove.GARMENTS],
                         ["dress-a-line-v1", "skirt-pencil-v1", "skirt-pleated-mini-v1"])

    def test_a_name_that_resolves_to_another_template_is_not_reported_as_a_result(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = Path(tmp) / "aline"
            write_run(run, "A-line dress", "dress-a-line-v2")
            item = prove.summarise(run, "aline", "A-line dress", "dress-a-line-v1")
            self.assertEqual(item["status"], "wrong-template")
            self.assertNotIn("poses", item)

    def test_the_summary_reads_the_solver_row_not_the_briefs(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = Path(tmp) / "aline"
            write_run(run, "A-line dress", "dress-a-line-v1")
            item = prove.summarise(run, "aline", "A-line dress", "dress-a-line-v1")
            self.assertEqual(item["status"], "ok")
            self.assertEqual(set(item["poses"]), set(prove.POSES))
            self.assertEqual(item["poses"]["standing"]["garment"], "Main Garment")
            self.assertEqual(item["poses"]["standing"]["after"]["maxPenetrationMm"], 3.5)
            self.assertEqual(item["poses"]["standing"]["gate"], "fail")

    def test_without_a_solver_row_the_garment_is_still_not_the_briefs(self):
        with tempfile.TemporaryDirectory() as tmp:
            run = Path(tmp) / "pleated"
            write_run(run, "Pleated mini skirt", "skirt-pleated-mini-v1", xpbd=False)
            item = prove.summarise(run, "pleated", "Pleated mini", "skirt-pleated-mini-v1")
            self.assertEqual(item["poses"]["sittingWide"]["garment"], "Main Garment")

    def test_main_runs_each_pilot_once_and_writes_a_summary(self):
        with tempfile.TemporaryDirectory() as tmp:
            prefix = Path(tmp) / "cloth-contract"
            calls = []

            def fake_run(cmd, check=False):
                calls.append(cmd)
                pairs = dict(zip(cmd[2::2], cmd[3::2]))
                template = next(t for _, n, t in prove.GARMENTS if n == pairs["--only"])
                write_run(Path(pairs["--out"]), pairs["--only"], template)

            code = prove.main(["--out-prefix", str(prefix)], run=fake_run)
            self.assertEqual(code, 0)
            self.assertEqual([dict(zip(c[2::2], c[3::2]))["--only"] for c in calls],
                             ["A-line dress", "Pencil skirt", "Pleated mini"])
            summary = json.loads(Path(f"{prefix}-summary.json").read_text())
            self.assertEqual([g["template"] for g in summary["garments"]],
                             ["dress-a-line-v1", "skirt-pencil-v1", "skirt-pleated-mini-v1"])
            self.assertIn("| A-line dress | sittingWide |", Path(f"{prefix}-summary.md").read_text())

    def test_a_failed_capture_makes_the_run_fail(self):
        with tempfile.TemporaryDirectory() as tmp:
            prefix = Path(tmp) / "c"

            def fake_run(cmd, check=False):
                pairs = dict(zip(cmd[2::2], cmd[3::2]))
                template = next(t for _, n, t in prove.GARMENTS if n == pairs["--only"])
                write_run(Path(pairs["--out"]), pairs["--only"], template, status="error")

            self.assertEqual(prove.main(["--out-prefix", str(prefix), "--only", "aline"], run=fake_run), 1)

    def test_no_metrics_is_not_measured_never_a_pass(self):
        """Master reports no metrics; capture.py then writes gate.ok = true."""
        with tempfile.TemporaryDirectory() as tmp:
            run = Path(tmp) / "aline"
            write_run(run, "A-line dress", "dress-a-line-v1")
            manifest = json.loads((run / "manifest.json").read_text())
            for pose in manifest["entries"][0]["poses"].values():
                pose["gate"] = {"ok": True, "issues": []}
                pose.pop("metrics")
            (run / "manifest.json").write_text(json.dumps(manifest))
            item = prove.summarise(run, "aline", "A-line dress", "dress-a-line-v1")
            self.assertEqual({p["gate"] for p in item["poses"].values()}, {"not measured"})
            self.assertNotIn("pass", prove.markdown({"url": "u", "forgeUrl": "f", "garments": [item]}).split("|---")[-1])

    def test_no_capture_reuses_the_runs_on_disk(self):
        with tempfile.TemporaryDirectory() as tmp:
            prefix = Path(tmp) / "c"
            write_run(Path(f"{prefix}-aline"), "A-line dress", "dress-a-line-v1")

            def must_not_run(cmd, check=False):
                raise AssertionError("captured although --no-capture")

            self.assertEqual(prove.main(["--out-prefix", str(prefix), "--only", "aline", "--no-capture"],
                                        run=must_not_run), 0)


if __name__ == "__main__":
    unittest.main()
