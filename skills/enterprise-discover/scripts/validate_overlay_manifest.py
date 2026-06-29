#!/usr/bin/env python3
"""Validate repo-local enterprise overlay manifest freshness."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from generate_repo_overlay import GENERATOR_VERSION, generic_source_hashes, sha256_file, sha256_tree


def load_manifest(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"missing overlay manifest: {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid overlay manifest JSON: {path}: {exc}")
    if not isinstance(data, dict):
        raise SystemExit(f"overlay manifest must be a JSON object: {path}")
    return data


def main() -> int:
    parser = argparse.ArgumentParser(description="Check generated repo overlays still match their manifest hashes.")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--manifest", default=".codex/repo-skills/helpdesk-enterprise-manifest.json")
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    manifest_path = repo_root / args.manifest
    manifest = load_manifest(manifest_path)
    errors: list[str] = []

    if not manifest.get("generated_at"):
        errors.append("manifest missing generated_at")
    if manifest.get("generator_version") != GENERATOR_VERSION:
        errors.append(
            f"generator_version mismatch: manifest={manifest.get('generator_version')!r} current={GENERATOR_VERSION!r}"
        )

    source_hashes = manifest.get("source_hashes", {})
    if not isinstance(source_hashes, dict):
        errors.append("manifest source_hashes must be an object")
        source_hashes = {}

    for key, rel_key in (
        ("profile", "profile_path"),
        ("traps", "traps_path"),
        ("best_practices", "best_practices_path"),
    ):
        rel = manifest.get(rel_key)
        expected = source_hashes.get(key)
        actual = sha256_file(repo_root / rel) if isinstance(rel, str) else None
        if expected != actual:
            errors.append(f"{key} hash mismatch: manifest={expected} current={actual}")

    expected_generic = source_hashes.get("generic_sources")
    actual_generic = generic_source_hashes()
    if expected_generic != actual_generic:
        errors.append("generic enterprise source hashes are stale; rerun enterprise-discover")

    output_root = manifest_path.parent
    generated_hashes = manifest.get("generated_skill_hashes")
    if not isinstance(generated_hashes, dict):
        errors.append("manifest missing generated_skill_hashes")
        generated_hashes = {}
    generated_skills = manifest.get("generated_skills", [])
    if not isinstance(generated_skills, list) or not generated_skills:
        errors.append("manifest missing generated_skills")
        generated_skills = []
    for skill in generated_skills:
        if not isinstance(skill, str):
            errors.append("generated_skills contains a non-string entry")
            continue
        expected = generated_hashes.get(skill)
        actual = sha256_tree(output_root / skill)
        if expected != actual:
            errors.append(f"{skill} generated hash mismatch: manifest={expected} current={actual}")

    print(json.dumps({"result": "FAIL" if errors else "PASS", "manifest": str(manifest_path), "errors": errors}, indent=2))
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
