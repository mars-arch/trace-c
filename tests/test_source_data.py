import hashlib
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

from scripts.verify_source_data import verify_files


class SourceDataVerificationTest(unittest.TestCase):
    def test_rejects_a_cached_file_whose_content_changed(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            path = root / "source.csv"
            path.write_bytes(b"published bytes")
            manifest = {
                "source.csv": {
                    "bytes": len(b"published bytes"),
                    "sha256": hashlib.sha256(b"published bytes").hexdigest(),
                }
            }
            verify_files(root, manifest)

            path.write_bytes(b"altered__ bytes")
            with self.assertRaisesRegex(ValueError, "source.csv sha256 mismatch"):
                verify_files(root, manifest)

    def test_direct_trainer_fails_before_overwriting_when_raw_input_is_missing(self):
        repo = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            shutil.copytree(repo / "scripts", root / "scripts")
            shutil.copytree(repo / "src", root / "src")
            shutil.copytree(repo / "data" / "real", root / "data" / "real")
            (root / "data" / "reports").mkdir(parents=True)
            shutil.copy2(repo / "data" / "source-checksums.json", root / "data")
            shutil.copy2(repo / ".python-version", root)
            shutil.copy2(repo / "requirements-baselines.txt", root)

            scores = root / "data" / "reports" / "baseline-scores.json"
            history = root / "data" / "reports" / "ae-training-history.json"
            sentinel = b'{"sentinel":"unchanged"}\n'
            scores.write_bytes(sentinel)
            history.write_bytes(sentinel)
            (root / "data" / "real" / "neso-demand-2019.csv").unlink()

            result = subprocess.run(
                [sys.executable, "scripts/train_baselines.py", "--preflight-only"],
                cwd=root,
                capture_output=True,
                text=True,
                check=False,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("neso-demand-2019.csv", result.stdout + result.stderr)
            self.assertEqual(scores.read_bytes(), sentinel)
            self.assertEqual(history.read_bytes(), sentinel)


if __name__ == "__main__":
    unittest.main()
