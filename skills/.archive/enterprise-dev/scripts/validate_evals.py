#!/usr/bin/env python3
"""Validate enterprise skill eval suites.

This is intentionally simple and fail-closed. The goal is not to run LLM
benchmarks here; it is to make sure every enterprise skill has a mechanical
eval contract that covers the failure classes the skill is supposed to prevent.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]

REQUIRED_COVERAGE: dict[str, list[str]] = {
    "enterprise": ["path", "proof scope", "verify", "codex headless", "pr-readiness", "intent continuity", "srp", "db/query ownership", "github issue"],
    "enterprise-brainstorm": ["source", "design", "quality", "proof ledger", "build packet seed", "intent continuity", "alternatives", "srp", "db/query ownership"],
    "enterprise-build": ["red", "live db", "headless", "subagent", "lead", "codex headless", "build_packet", "receipt", "transition", "quick", "intent continuity", "srp", "db/query ownership", "github issue"],
    "enterprise-compound": ["proof boundary", "prevention", "machine-readable"],
    "enterprise-contract": ["source", "live db", "trace", "contract-manager", "plan 360", "build packet", "intent continuity", "srp", "db/query ownership", "github issue"],
    "enterprise-debug": ["root cause", "blast radius", "reproduction"],
    "enterprise-dev": ["path", "proof scope", "verify", "codex headless", "pr-readiness", "intent continuity", "srp", "db/query ownership", "github issue"],
    "enterprise-discover": ["profile", "overlay", "hash"],
    "enterprise-forge": [
        "adversarial",
        "runtime",
        "copilot",
        "codex headless",
        "contract clause",
        "proof subject",
        "runtime surface",
        "intent continuity",
        "srp",
        "db/query ownership",
    ],
    "enterprise-harness": ["pc trace", "changed file", "pr readiness", "receipt", "codex headless", "intent", "srp", "db/query ownership"],
    "enterprise-next": ["read_only", "controller", "blocked", "recommended skill", "does not advance"],
    "enterprise-plan": ["architecture", "live db", "headless", "plan 360", "intent continuity", "alternatives", "srp", "db/query ownership", "github issue"],
    "enterprise-pr-review": ["blocking", "advisory", "high-risk"],
    "enterprise-review": ["stale", "live db", "pr mode", "codex headless", "intent continuity", "srp", "db/query ownership"],
    "enterprise-stack-review": ["incumbent", "decision", "lock"],
    "enterprise-verify": [
        "fresh",
        "e2e",
        "pr readiness",
        "receipt",
        "codex headless",
        "contract clause",
        "proof subject",
        "runtime surface",
        "intent continuity",
        "srp",
        "db/query ownership",
    ],
}

ENTERPRISE_BUILD_REQUIRED_TERMS = [
    "canonical_body_loaded",
    "shim-only",
    "enterprise-precheck --skill enterprise-build",
    "receipt_id",
    "command_status",
    "proof_type",
    "test_file",
    "test_name",
    "output_sha256",
    "head_sha",
    "head_sha_after",
    "base_sha",
    "artifact_path",
    "log_path",
    "validate_postcondition_transitions",
    "red status to have a fail receipt",
    "green status to have paired red and green receipts",
    "blocked and recycled statuses to include reasons",
    "verified as a build-produced state",
    "headless-ready",
    "enterprise-containment --path",
    "--artifact build_packet",
    "--artifact postconditions",
    "--artifact command_receipts",
    "path_classification=quick",
]

ID_RE = re.compile(r"^[a-z][a-z0-9]+(?:-[a-z0-9]+)*$")


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"missing eval file: {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON in {path}: {exc}")
    if not isinstance(data, dict):
        raise SystemExit(f"eval file must be a JSON object: {path}")
    return data


def skill_dirs(root: Path) -> list[Path]:
    return sorted(
        path
        for path in root.iterdir()
        if path.is_dir()
        and path.name.startswith("enterprise")
        and (path / "SKILL.md").is_file()
    )


def text_blob(data: Any) -> str:
    return json.dumps(data, sort_keys=True).lower()


def validate_skill(skill_dir: Path) -> list[str]:
    errors: list[str] = []
    skill_name = skill_dir.name
    eval_path = skill_dir / "evals" / "evals.json"
    if not eval_path.is_file():
        return [f"{skill_name}: missing evals/evals.json"]

    data = load_json(eval_path)
    if data.get("skill_name") != skill_name:
        errors.append(
            f"{skill_name}: skill_name must be {skill_name!r}, got {data.get('skill_name')!r}"
        )

    definition = data.get("definition_of_100_percent")
    if not isinstance(definition, list) or len(definition) < 3:
        errors.append(f"{skill_name}: definition_of_100_percent needs at least 3 entries")

    evals = data.get("evals")
    if not isinstance(evals, list) or len(evals) < 2:
        errors.append(f"{skill_name}: needs at least 2 eval cases")
        evals = [] if not isinstance(evals, list) else evals

    seen_ids: set[str] = set()
    for index, item in enumerate(evals):
        if not isinstance(item, dict):
            errors.append(f"{skill_name}: eval {index} must be an object")
            continue
        eval_id = item.get("id")
        if not isinstance(eval_id, str) or not ID_RE.match(eval_id):
            errors.append(f"{skill_name}: eval {index} id must be a named kebab-case string")
        elif eval_id in seen_ids:
            errors.append(f"{skill_name}: duplicate eval id {eval_id}")
        else:
            seen_ids.add(eval_id)

        for field in ("prompt", "expected_output"):
            if not isinstance(item.get(field), str) or len(item.get(field, "").strip()) < 20:
                errors.append(f"{skill_name}: eval {eval_id or index} missing useful {field}")
        assertions = item.get("assertions")
        if not isinstance(assertions, list) or len(assertions) < 2:
            errors.append(f"{skill_name}: eval {eval_id or index} needs at least 2 assertions")
        elif any(not isinstance(assertion, str) or len(assertion.strip()) < 10 for assertion in assertions):
            errors.append(f"{skill_name}: eval {eval_id or index} has weak assertion text")

    blob = text_blob(data)
    for term in REQUIRED_COVERAGE.get(skill_name, []):
        if term.lower() not in blob:
            errors.append(f"{skill_name}: missing required coverage term {term!r}")
    if skill_name == "enterprise-build":
        for term in ENTERPRISE_BUILD_REQUIRED_TERMS:
            if term.lower() not in blob:
                errors.append(f"{skill_name}: missing enterprise-build safety coverage term {term!r}")

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate all enterprise skill eval contracts.")
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--json", action="store_true", help="Emit machine-readable results.")
    args = parser.parse_args()

    results: dict[str, list[str]] = {}
    for skill_dir in skill_dirs(args.root):
        errors = validate_skill(skill_dir)
        results[skill_dir.name] = errors

    failed = {skill: errors for skill, errors in results.items() if errors}
    if args.json:
        print(json.dumps({"result": "FAIL" if failed else "PASS", "skills": results}, indent=2))
    elif failed:
        print("enterprise eval validation FAILED", file=sys.stderr)
        for skill, errors in failed.items():
            for error in errors:
                print(f"  x {error}", file=sys.stderr)
    else:
        print(f"enterprise eval validation OK ({len(results)} skills)")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
