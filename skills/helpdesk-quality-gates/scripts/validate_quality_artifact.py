#!/usr/bin/env python3
"""Validate Helpdesk quality gate artifacts.

The validator is intentionally standalone: Python 3 standard library only, no
repo imports, and deterministic text output for CI or agent workflows.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


REQUIRED_FIELDS = {
    "goal_contract": [
        "terminal_state",
        "acceptance_condition",
        "rollback_or_block_trigger",
    ],
    "ownership_ledger": [
        "authoritative_source",
        "write_owner",
        "route_or_service_seam",
        "downstream_consumers",
        "sibling_flows",
        "worktree_or_route_card_state",
    ],
    "proof_ledger": [
        "head_sha",
        "base_ref",
        "changed_files",
        "proof_commands",
        "required_checks",
        "review_threads",
        "waiters",
        "pre_merge_sweep",
        "rerun_after_last_push",
    ],
    "risk_tier": [
        "tier",
        "required_proofs",
    ],
}

ROOT_LIST_FIELDS = ["hard_gates"]

LOW_RISK_TIERS = {"low", "minor", "trivial", "none"}
PASSING_PROOF_STATUSES = {"pass", "passed", "not_applicable", "not applicable", "n/a"}
FAILING_PROOF_STATUSES = {
    "blocked",
    "fail",
    "failed",
    "missing",
    "partial",
    "pending",
    "stale",
    "unproven",
}

SUBSTANTIVE_PROOF_LEDGER_FIELDS = [
    "proof_commands",
    "required_checks",
    "review_threads",
    "waiters",
    "pre_merge_sweep",
    "rerun_after_last_push",
]


SAMPLE_ARTIFACT = {
    "goal_contract": {
        "terminal_state": "PR is ready for explicit merge authorization",
        "acceptance_condition": "All required checks pass on current head and review threads are resolved",
        "rollback_or_block_trigger": "Block if head changes, proof goes stale, or a required check fails",
    },
    "ownership_ledger": {
        "authoritative_source": "live GitHub PR state and repo route card",
        "write_owner": "domain owner or documented gatekeeper seam",
        "route_or_service_seam": "apps/api/src/domains/example/exampleService.js",
        "downstream_consumers": ["staff UI", "worker proof lane"],
        "sibling_flows": ["manual retry", "scheduled retry"],
        "worktree_or_route_card_state": "clean isolated worktree; route card allows edit",
    },
    "proof_ledger": {
        "head_sha": "0123456789abcdef0123456789abcdef01234567",
        "base_ref": "origin/dev",
        "changed_files": ["apps/api/src/domains/example/exampleService.js"],
        "proof_commands": ["npm test -- exampleService.test.js"],
        "required_checks": ["unit-tests: pass"],
        "review_threads": ["none open"],
        "waiters": ["copilot-review-wait: clean"],
        "pre_merge_sweep": ["scope-check: clean"],
        "rerun_after_last_push": ["npm test rerun after latest push"],
        "older_than_head": False,
    },
    "risk_tier": {
        "tier": "medium",
        "required_proofs": ["focused unit test", "current-head PR checks"],
    },
    "hard_gates": ["no unresolved review threads", "proof ledger current to head"],
}


def is_empty(value: Any) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return value.strip() == ""
    if isinstance(value, (list, tuple, dict, set)):
        return len(value) == 0
    return False


def format_path(parts: list[str]) -> str:
    return ".".join(parts)


def add_required_field_errors(artifact: dict[str, Any], errors: list[str]) -> None:
    for section, fields in REQUIRED_FIELDS.items():
        value = artifact.get(section)
        if section not in artifact:
            errors.append(f"Missing required section: {section}")
            continue
        if not isinstance(value, dict):
            errors.append(f"Required section must be an object: {section}")
            continue
        if is_empty(value):
            errors.append(f"Required section is empty: {section}")
            continue
        for field in fields:
            path = format_path([section, field])
            if field not in value:
                errors.append(f"Missing required field: {path}")
            elif is_empty(value[field]):
                errors.append(f"Required field is empty: {path}")

    for field in ROOT_LIST_FIELDS:
        if field not in artifact:
            errors.append(f"Missing required field: {field}")
        elif not isinstance(artifact[field], list):
            errors.append(f"Required field must be a list: {field}")
        elif is_empty(artifact[field]):
            errors.append(f"Required field is empty: {field}")


def add_type_errors(artifact: dict[str, Any], errors: list[str]) -> None:
    proof_ledger = artifact.get("proof_ledger")
    if isinstance(proof_ledger, dict):
        for field in [
            "changed_files",
            "proof_commands",
            "required_checks",
            "review_threads",
            "waiters",
            "pre_merge_sweep",
            "rerun_after_last_push",
        ]:
            if field in proof_ledger and not isinstance(proof_ledger[field], list):
                errors.append(f"Required field must be a list: proof_ledger.{field}")

    ownership_ledger = artifact.get("ownership_ledger")
    if isinstance(ownership_ledger, dict):
        for field in ["downstream_consumers", "sibling_flows"]:
            if field in ownership_ledger and not isinstance(ownership_ledger[field], list):
                errors.append(f"Required field must be a list: ownership_ledger.{field}")

    risk_tier = artifact.get("risk_tier")
    if isinstance(risk_tier, dict) and "required_proofs" in risk_tier:
        if not isinstance(risk_tier["required_proofs"], list):
            errors.append("Required field must be a list: risk_tier.required_proofs")


def add_staleness_errors(artifact: dict[str, Any], errors: list[str]) -> None:
    proof_ledger = artifact.get("proof_ledger")
    if isinstance(proof_ledger, dict) and proof_ledger.get("older_than_head") is True:
        errors.append("Proof ledger is stale: proof_ledger.older_than_head is true")


def add_substantive_tier_errors(artifact: dict[str, Any], errors: list[str]) -> None:
    risk_tier = artifact.get("risk_tier")
    proof_ledger = artifact.get("proof_ledger")
    if not isinstance(risk_tier, dict):
        return

    tier_value = risk_tier.get("tier")
    if not isinstance(tier_value, str) or tier_value.strip() == "":
        return

    normalized_tier = tier_value.strip().lower()
    if normalized_tier in LOW_RISK_TIERS:
        return

    required_proofs = risk_tier.get("required_proofs")
    if not isinstance(required_proofs, list) or is_empty(required_proofs):
        errors.append(
            "Substantive risk tier lacks required proofs: risk_tier.required_proofs"
        )
    elif any(is_empty(item) for item in required_proofs):
        errors.append(
            "Substantive risk tier has an empty proof entry: risk_tier.required_proofs"
        )

    if isinstance(proof_ledger, dict):
        for field in SUBSTANTIVE_PROOF_LEDGER_FIELDS:
            if field not in proof_ledger or is_empty(proof_ledger[field]):
                errors.append(
                    f"Substantive risk tier lacks proof ledger evidence: proof_ledger.{field}"
                )


def normalize_status(value: Any) -> str:
    if not isinstance(value, str):
        return ""
    return value.strip().lower().replace("-", "_")


def add_status_errors(artifact: dict[str, Any], errors: list[str]) -> None:
    proof_ledger = artifact.get("proof_ledger")
    if not isinstance(proof_ledger, dict):
        return

    proofs = proof_ledger.get("proofs")
    if isinstance(proofs, list):
        covered_required_proofs = set()
        for index, proof in enumerate(proofs):
            if not isinstance(proof, dict):
                errors.append(f"Proof entry must be an object: proof_ledger.proofs[{index}]")
                continue
            required_by = proof.get("required_by")
            status = normalize_status(proof.get("status"))
            if isinstance(required_by, str) and required_by.strip():
                covered_required_proofs.add(required_by.strip())
            if status in FAILING_PROOF_STATUSES:
                errors.append(
                    f"Proof entry is not passing: proof_ledger.proofs[{index}].status={proof.get('status')}"
                )
            elif "status" in proof and status not in PASSING_PROOF_STATUSES:
                errors.append(
                    f"Proof entry has unrecognized status: proof_ledger.proofs[{index}].status={proof.get('status')}"
                )

        risk_tier = artifact.get("risk_tier")
        required_proofs = (
            risk_tier.get("required_proofs") if isinstance(risk_tier, dict) else None
        )
        if isinstance(required_proofs, list):
            missing = [
                proof
                for proof in required_proofs
                if isinstance(proof, str) and proof.strip() and proof.strip() not in covered_required_proofs
            ]
            if missing:
                errors.append(
                    "Proof ledger does not cover required proofs: " + ", ".join(missing)
                )

    nested_status_paths = [
        ("proof_ledger.current_head_guard.status", proof_ledger.get("current_head_guard")),
        (
            "proof_ledger.review_thread_details.status",
            proof_ledger.get("review_thread_details"),
        ),
        ("proof_ledger.ci_details.required_checks_status", proof_ledger.get("ci_details")),
    ]
    for path, container in nested_status_paths:
        if not isinstance(container, dict):
            continue
        key = path.rsplit(".", 1)[-1]
        if key not in container:
            continue
        status = normalize_status(container.get(key))
        if status in FAILING_PROOF_STATUSES:
            errors.append(f"Nested proof status is not passing: {path}={container.get(key)}")
        elif status not in PASSING_PROOF_STATUSES:
            errors.append(f"Nested proof status is unrecognized: {path}={container.get(key)}")


def add_cross_reference_errors(artifact: dict[str, Any], errors: list[str]) -> None:
    goal_contract = artifact.get("goal_contract")
    risk_tier = artifact.get("risk_tier")
    proof_ledger = artifact.get("proof_ledger")
    if not all(isinstance(value, dict) for value in [goal_contract, risk_tier, proof_ledger]):
        return

    goal = goal_contract.get("goal")
    if isinstance(goal, dict):
        goal_risk_tier = goal.get("risk_tier")
        artifact_risk_tier = risk_tier.get("tier")
        if (
            isinstance(goal_risk_tier, str)
            and isinstance(artifact_risk_tier, str)
            and goal_risk_tier.strip().lower() != artifact_risk_tier.strip().lower()
        ):
            errors.append("Risk tier mismatch: goal_contract.goal.risk_tier != risk_tier.tier")

    required_profiles = goal_contract.get("required_proof_profiles")
    tier = risk_tier.get("tier")
    if isinstance(required_profiles, dict) and isinstance(tier, str):
        expected = required_profiles.get(tier.strip().lower())
        actual_risk = risk_tier.get("required_proofs")
        actual_ledger = proof_ledger.get("required_proofs")
        if isinstance(expected, list):
            if isinstance(actual_risk, list) and actual_risk != expected:
                errors.append(
                    "Required proofs mismatch: risk_tier.required_proofs != goal_contract profile"
                )
            if isinstance(actual_ledger, list) and actual_ledger != expected:
                errors.append(
                    "Required proofs mismatch: proof_ledger.required_proofs != goal_contract profile"
                )


def validate_artifact(artifact: Any) -> list[str]:
    errors: list[str] = []
    if not isinstance(artifact, dict):
        return ["Artifact root must be a JSON object"]

    add_required_field_errors(artifact, errors)
    add_type_errors(artifact, errors)
    add_staleness_errors(artifact, errors)
    add_substantive_tier_errors(artifact, errors)
    add_status_errors(artifact, errors)
    add_cross_reference_errors(artifact, errors)
    return errors


def load_json(path: str) -> Any:
    if path == "-":
        return json.load(sys.stdin)
    with Path(path).open("r", encoding="utf-8") as handle:
        return json.load(handle)


def print_sample() -> None:
    print(json.dumps(SAMPLE_ARTIFACT, indent=2, sort_keys=True))


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Validate a Helpdesk quality gate JSON artifact.",
    )
    parser.add_argument(
        "artifact",
        nargs="?",
        help="Path to JSON artifact. Use '-' to read from stdin.",
    )
    parser.add_argument(
        "--sample",
        action="store_true",
        help="Print a sample valid artifact and exit.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    if args.sample:
        print_sample()
        return 0
    if not args.artifact:
        print("ERROR: missing artifact path. Use --help for usage.", file=sys.stderr)
        return 2

    try:
        artifact = load_json(args.artifact)
    except FileNotFoundError:
        print(f"ERROR: artifact not found: {args.artifact}", file=sys.stderr)
        return 2
    except json.JSONDecodeError as exc:
        print(f"ERROR: invalid JSON: {exc}", file=sys.stderr)
        return 2
    except OSError as exc:
        print(f"ERROR: could not read artifact: {exc}", file=sys.stderr)
        return 2

    errors = validate_artifact(artifact)
    if errors:
        print("INVALID quality artifact:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("VALID quality artifact")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
