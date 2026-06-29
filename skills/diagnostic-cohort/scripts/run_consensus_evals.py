#!/usr/bin/env python3
"""Run diagnostic cohort consensus-contract validator fixtures."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate_consensus_contract.py"
FIXTURES = ROOT / "references"

CASES = [
    ("consensus-contract.sample.json", True),
    ("bad-missing-eval-in-goal.sample.json", False),
]


def run_case(name: str, should_pass: bool) -> tuple[bool, str]:
    command = [sys.executable, str(VALIDATOR), str(FIXTURES / name)]
    result = subprocess.run(command, text=True, capture_output=True, check=False)
    passed = result.returncode == 0
    ok = passed is should_pass
    output = (result.stdout + result.stderr).strip()
    return ok, f"{name} expected={'PASS' if should_pass else 'FAIL'} actual={'PASS' if passed else 'FAIL'}\n{output}"


def main() -> int:
    failures: list[str] = []
    for name, should_pass in CASES:
        ok, message = run_case(name, should_pass)
        print(message)
        if not ok:
            failures.append(message)
    if failures:
        print(f"FAILED {len(failures)} consensus eval(s)", file=sys.stderr)
        return 1
    print("PASS: diagnostic cohort consensus evals")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
