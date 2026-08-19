"""Validate the exact runtime used to build TRACE-C baseline artifacts.

The Python patch release is pinned by ``.python-version``; numerical/model
library versions are pinned by ``requirements-baselines.txt``.  Keeping this
logic separate lets tests and the trainer enforce the same contract.
"""
from __future__ import annotations

import platform
import re
from importlib import metadata
from pathlib import Path
from typing import Mapping


_DISTRIBUTIONS = {
    "numpy": "numpy",
    "torch": "torch",
    "scikit-learn": "scikit_learn",
}


def _canonical_distribution(name: str) -> str:
    return re.sub(r"[-_.]+", "-", name).lower()


def load_pinned_runtime_versions(project_root: Path) -> dict[str, str]:
    """Read the required runtime versions from tracked project metadata."""
    python_version = (project_root / ".python-version").read_text().strip()
    if not re.fullmatch(r"\d+\.\d+\.\d+", python_version):
        raise ValueError(".python-version must contain one exact X.Y.Z version")

    requirements_path = project_root / "requirements-baselines.txt"
    dependency_pins: dict[str, str] = {}
    invalid_or_missing: set[str] = set()
    required = set(_DISTRIBUTIONS)

    for raw_line in requirements_path.read_text().splitlines():
        line = raw_line.split("#", 1)[0].strip()
        if not line:
            continue
        package_match = re.match(r"([A-Za-z0-9_.-]+)", line)
        if package_match is None:
            continue
        package = _canonical_distribution(package_match.group(1))
        if package not in required:
            continue
        exact_match = re.fullmatch(
            r"[A-Za-z0-9_.-]+\s*==\s*([^\s;]+)", line
        )
        if exact_match is None:
            invalid_or_missing.add(package)
            continue
        dependency_pins[_DISTRIBUTIONS[package]] = exact_match.group(1)

    pinned_packages = {
        package
        for package, runtime_key in _DISTRIBUTIONS.items()
        if runtime_key in dependency_pins
    }
    invalid_or_missing.update(required - pinned_packages)
    if invalid_or_missing:
        ordered = [name for name in _DISTRIBUTIONS if name in invalid_or_missing]
        raise ValueError(
            "requirements-baselines.txt must contain exact pins for "
            + ", ".join(ordered)
        )

    return {
        "python": python_version,
        "numpy": dependency_pins["numpy"],
        "torch": dependency_pins["torch"],
        "scikit_learn": dependency_pins["scikit_learn"],
    }


def installed_runtime_versions() -> dict[str, str]:
    """Return installed versions without importing the heavyweight libraries."""
    versions = {"python": platform.python_version()}
    for distribution, runtime_key in _DISTRIBUTIONS.items():
        try:
            versions[runtime_key] = metadata.version(distribution)
        except metadata.PackageNotFoundError:
            versions[runtime_key] = "<not installed>"
    return versions


def validate_runtime_environment(
    project_root: Path,
    *,
    actual_versions: Mapping[str, str] | None = None,
) -> dict[str, str]:
    """Raise before training unless every runtime component matches its pin."""
    expected = load_pinned_runtime_versions(project_root)
    actual = dict(
        installed_runtime_versions() if actual_versions is None else actual_versions
    )
    mismatches = [
        f"{name} expected {version}, found {actual.get(name, '<not installed>')}"
        for name, version in expected.items()
        if actual.get(name) != version
    ]
    if mismatches:
        raise RuntimeError(
            "Baseline runtime does not match pinned project metadata: "
            + "; ".join(mismatches)
            + ". Activate the Python in .python-version and install "
            "requirements-baselines.txt."
        )
    return {name: actual[name] for name in expected}
