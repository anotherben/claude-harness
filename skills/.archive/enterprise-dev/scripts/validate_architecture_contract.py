#!/usr/bin/env python3
"""Fail-closed architecture/SRP contract validator for enterprise build packets."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Optional

from agent_session import (
    ARCHITECTURE_PACKET_TERMS,
    build_packet_field_failures,
    extract_build_packet_field,
)


def resolve_repo_path(repo_root: Path, value: str) -> Path:
    candidate = Path(value)
    if candidate.is_absolute():
        return candidate.resolve()
    return (repo_root / candidate).resolve()


def validate_artifact(path: Path) -> list[str]:
    if not path.exists():
        return [f"architecture contract artifact does not exist: {path}"]
    content = path.read_text(encoding="utf-8")
    failures: list[str] = []
    if "Mechanical Build Packet" not in content:
        failures.append("architecture contract requires a Mechanical Build Packet section")

    missing = [term for term in ARCHITECTURE_PACKET_TERMS if term not in content]
    if missing:
        failures.append(
            "architecture contract is incomplete; missing required architecture fields: "
            + ", ".join(missing)
        )

    for term in ARCHITECTURE_PACKET_TERMS:
        if term in missing:
            continue
        field_value = extract_build_packet_field(content, term)
        failures.extend(build_packet_field_failures(term, field_value))

    return failures


def main(argv: Optional[list[str]] = None) -> int:
    parser = argparse.ArgumentParser(
        description="Validate enterprise architecture fields in a Mechanical Build Packet."
    )
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--artifact", required=True, help="Contract or build-packet artifact to validate.")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args(argv)

    repo_root = Path(args.repo_root).resolve()
    artifact_path = resolve_repo_path(repo_root, args.artifact)
    failures = validate_artifact(artifact_path)
    payload = {
        "ok": not failures,
        "artifact": str(artifact_path),
        "architecture_fields": list(ARCHITECTURE_PACKET_TERMS),
        "failures": failures,
    }
    if args.json:
        print(json.dumps(payload, indent=2))
    elif failures:
        print("architecture contract validation FAILED", file=sys.stderr)
        for failure in failures:
            print(f"  x {failure}", file=sys.stderr)
    else:
        print("architecture contract validation OK")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
