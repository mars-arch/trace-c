import tempfile
import unittest
from pathlib import Path

from scripts.runtime_environment import (
    load_pinned_runtime_versions,
    validate_runtime_environment,
)


class RuntimeEnvironmentTest(unittest.TestCase):
    def write_project_metadata(
        self,
        root: Path,
        *,
        python: str = "3.13.1",
        requirements: str = (
            "numpy==2.2.6\n"
            "scikit-learn==1.6.1\n"
            "torch==2.12.0\n"
            "tensorboard==2.21.0\n"
        ),
    ) -> None:
        (root / ".python-version").write_text(f"{python}\n")
        (root / "requirements-baselines.txt").write_text(requirements)

    def test_loads_python_and_model_library_pins_from_project_metadata(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_project_metadata(root)

            self.assertEqual(
                load_pinned_runtime_versions(root),
                {
                    "python": "3.13.1",
                    "numpy": "2.2.6",
                    "torch": "2.12.0",
                    "scikit_learn": "1.6.1",
                },
            )

    def test_rejects_a_runtime_that_differs_from_any_exact_pin(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_project_metadata(root)

            with self.assertRaisesRegex(
                RuntimeError,
                r"python expected 3\.13\.1, found 3\.13\.2.*"
                r"numpy expected 2\.2\.6, found 2\.4\.1",
            ):
                validate_runtime_environment(
                    root,
                    actual_versions={
                        "python": "3.13.2",
                        "numpy": "2.4.1",
                        "torch": "2.12.0",
                        "scikit_learn": "1.6.1",
                    },
                )

    def test_accepts_and_returns_the_exact_pinned_runtime(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_project_metadata(root)
            exact = {
                "python": "3.13.1",
                "numpy": "2.2.6",
                "torch": "2.12.0",
                "scikit_learn": "1.6.1",
            }

            self.assertEqual(
                validate_runtime_environment(root, actual_versions=exact), exact
            )

    def test_an_explicitly_empty_runtime_is_reported_as_missing(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_project_metadata(root)

            with self.assertRaisesRegex(
                RuntimeError,
                r"python expected 3\.13\.1, found <not installed>",
            ):
                validate_runtime_environment(root, actual_versions={})

    def test_rejects_non_exact_or_missing_dependency_pins(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            self.write_project_metadata(
                root,
                requirements="numpy>=2.2.6\ntorch==2.12.0\n",
            )

            with self.assertRaisesRegex(
                ValueError, "exact pins for numpy, scikit-learn"
            ):
                load_pinned_runtime_versions(root)

    def test_test_process_matches_the_repository_runtime_pins(self):
        root = Path(__file__).resolve().parents[1]

        self.assertEqual(
            validate_runtime_environment(root),
            load_pinned_runtime_versions(root),
        )


if __name__ == "__main__":
    unittest.main()
