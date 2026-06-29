#!/usr/bin/env python3
"""Run diagnose packet validator fixtures."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate_diagnosis_packet.py"
FIXTURES = ROOT / "evals" / "fixtures"


CASES = [
    ("valid-build-ready.json", True, []),
    ("bad-schema-version.json", False, []),
    ("bad-empty-plan.json", False, []),
    ("bad-fixed-pending.json", False, []),
    ("bad-disputed-build-ready.json", False, []),
    ("bad-missing-goal-eval.json", False, []),
    (
        "valid-build-ready.json",
        False,
        ["--changed-file", "apps/api/src/domains/foo/service.js"],
    ),
]


def run_case(name: str, should_pass: bool, extra_args: list[str]) -> tuple[bool, str]:
    command = [
        sys.executable,
        str(VALIDATOR),
        str(FIXTURES / name),
        "--diagnosis-only",
        *extra_args,
    ]
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    passed = result.returncode == 0
    ok = passed is should_pass
    output = (result.stdout + result.stderr).strip()
    return ok, f"{name} expected={'PASS' if should_pass else 'FAIL'} actual={'PASS' if passed else 'FAIL'}\n{output}"


def main() -> int:
    failures: list[str] = []
    for name, should_pass, extra_args in CASES:
        ok, message = run_case(name, should_pass, extra_args)
        print(message)
        if not ok:
            failures.append(message)
    if failures:
        print(f"FAILED {len(failures)} diagnose packet eval(s)", file=sys.stderr)
        return 1
    print("PASS: diagnose packet evals")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
