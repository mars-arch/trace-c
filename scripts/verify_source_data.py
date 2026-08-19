"""Verify retained NESO inputs against the published evidence manifest."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def verify_files(root: Path, files: dict) -> None:
    for relative, expected in files.items():
        path = root / relative
        if not path.is_file():
            raise ValueError(f"{relative} is missing")
        actual_size = path.stat().st_size
        if actual_size != expected["bytes"]:
            raise ValueError(
                f"{relative} size mismatch: expected {expected['bytes']}, received {actual_size}"
            )
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if actual_hash != expected["sha256"]:
            raise ValueError(
                f"{relative} sha256 mismatch: expected {expected['sha256']}, received {actual_hash}"
            )


def main() -> None:
    manifest = json.loads((ROOT / "data/source-checksums.json").read_text())
    if manifest.get("schema_version") != 1:
        raise SystemExit("unsupported source checksum manifest")
    try:
        verify_files(ROOT, manifest["files"])
    except ValueError as exc:
        raise SystemExit(str(exc)) from exc
    print(f"source data verified ({len(manifest['files'])} files)")


if __name__ == "__main__":
    main()
