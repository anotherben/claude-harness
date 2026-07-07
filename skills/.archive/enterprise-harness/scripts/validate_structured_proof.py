#!/usr/bin/env python3
"""Validate structured proof blocks inside enterprise artifacts."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
HARNESS_SCRIPT_DIR = HERE.parents[0] / "enterprise-harness" / "scripts"
if not (HARNESS_SCRIPT_DIR / "proof_utils.py").is_file():
    HARNESS_SCRIPT_DIR = HERE
sys.path.insert(0, str(HARNESS_SCRIPT_DIR))

from proof_utils import (  # noqa: E402
    collect_records,
    has_query_or_schema_readback,
    has_source_grounding,
    non_migration_source_read_paths,
    proof_type,
    record_output,
    record_paths,
    record_receipt_ids,
    record_status,
    status_is_pass,
)


PREVENTION_STATUSES = {
    "implemented",
    "tracked-follow-up",
    "gate-added",
    "eval-added",
    "blocked-with-reason",
}

ATTACK_LENSES = {
    "spec-contract",
    "schema-data",
    "code-execution",
    "e2e-workflow",
    "security-tenant",
    "headless-ui",
}

FAILED_PROOF_TERMS = (
    "PARTIALLY PROVED",
    "UNPROVED",
    "DO NOT CLAIM FIXED",
    "Gate Result: FAIL",
    "gate_result: FAIL",
    "proof_verdict: PARTIALLY",
    "proof_verdict: UNPROVED",
)


def is_data_path(path: str) -> bool:
    lowered = path.lower()
    return (
        lowered.endswith(".sql")
        or "migration" in lowered
        or "database" in lowered
        or "/db" in lowered
        or "query" in lowered
        or "schema" in lowered
    )


def requires_schema_query_grounding(record: dict[str, Any]) -> bool:
    ptype = proof_type(record)
    if ptype in {"live_db", "integration"} and any(is_data_path(path) for path in record_paths(record)):
        return True
    text = json.dumps(record, sort_keys=True).lower()
    return (
        ptype in {"live_db", "integration"}
        and any(term in text for term in ("schema", "query", "sql", "database", "migration"))
    )


def validate_schema_query_grounding(record: dict[str, Any], label: str, kind: str, errors: list[str]) -> None:
    if not requires_schema_query_grounding(record):
        return
    if not non_migration_source_read_paths(record):
        errors.append(
            f"{kind} {label}: missing current runtime source_read_paths/code_read_paths for schema/query/data proof"
        )
    if not has_source_grounding(record):
        errors.append(
            f"{kind} {label}: missing cortex freshness/source-grounding proof or explicit fallback reason"
        )
    if not has_query_or_schema_readback(record):
        errors.append(
            f"{kind} {label}: missing query/schema readback proof against runtime path; migration-only proof is insufficient"
        )


def validate_pc_trace(text: str, errors: list[str]) -> None:
    records = collect_records(text, ("enterprise_pc_trace", "pc_trace", "postcondition_trace"))
    if not records:
        errors.append("missing structured enterprise_pc_trace records")
        return
    for index, record in enumerate(records):
        label = str(record.get("id") or record.get("pc_id") or f"record-{index}")
        for field in ("command", "head_sha", "test_file", "test_name"):
            if not str(record.get(field, "")).strip():
                errors.append(f"enterprise_pc_trace {label}: missing {field}")
        if not record_receipt_ids(record):
            errors.append(f"enterprise_pc_trace {label}: missing receipt_id")
        if not status_is_pass(record_status(record)):
            errors.append(f"enterprise_pc_trace {label}: command_status/result is not PASS")
        if not proof_type(record):
            errors.append(f"enterprise_pc_trace {label}: missing proof_type")
        if not record_output(record):
            errors.append(f"enterprise_pc_trace {label}: missing pass_output/output_excerpt")
        validate_schema_query_grounding(record, label, "enterprise_pc_trace", errors)


def validate_changed_file_proof(text: str, errors: list[str]) -> None:
    records = collect_records(text, ("enterprise_changed_file_proof", "changed_file_proof"))
    if not records:
        errors.append("missing structured enterprise_changed_file_proof records")
        return
    if not any(record.get("changed_runtime_paths") or record.get("runtime_paths") for record in records):
        errors.append("changed-file proof records do not name changed_runtime_paths/runtime_paths")
    for index, record in enumerate(records):
        label = str(record.get("id") or record.get("pc_id") or f"record-{index}")
        if not record_receipt_ids(record):
            errors.append(f"enterprise_changed_file_proof {label}: missing receipt_id")
        validate_schema_query_grounding(record, label, "enterprise_changed_file_proof", errors)


def validate_pr_readiness(text: str, errors: list[str]) -> None:
    records = collect_records(text, ("enterprise_pr_readiness", "pr_readiness"))
    if not records:
        errors.append("missing structured enterprise_pr_readiness record")
        return
    record = records[0]
    if str(record.get("mode", "")).strip() not in {
        "normal-open",
        "high-risk-draft",
        "advisory-harvest",
        "not-applicable",
    }:
        errors.append("enterprise_pr_readiness: invalid or missing mode")
    if not str(record.get("head_sha", "")).strip():
        errors.append("enterprise_pr_readiness: missing head_sha")
    if "advisory" in text.lower() and not str(record.get("advisory_disposition", "")).strip():
        errors.append("enterprise_pr_readiness: missing advisory_disposition")


def validate_prevention_records(text: str, errors: list[str]) -> None:
    records = collect_records(text, ("enterprise_prevention_records", "prevention_records"))
    if not records:
        errors.append("missing structured enterprise_prevention_records")
        return
    for index, record in enumerate(records):
        label = str(record.get("id") or record.get("finding") or f"record-{index}")
        for field in ("finding", "root_cause", "should_have_caught_at", "prevention_upgrade"):
            if not str(record.get(field, "")).strip():
                errors.append(f"enterprise_prevention_records {label}: missing {field}")
        status = str(record.get("status", "")).strip()
        if status not in PREVENTION_STATUSES:
            errors.append(
                f"enterprise_prevention_records {label}: status must be one of {sorted(PREVENTION_STATUSES)}"
            )
        if status == "blocked-with-reason" and not str(record.get("blocked_reason", "")).strip():
            errors.append(f"enterprise_prevention_records {label}: blocked-with-reason needs blocked_reason")


def validate_attack_lenses(text: str, errors: list[str]) -> None:
    records = collect_records(text, ("enterprise_attack_lens_packet", "attack_lens_packet"))
    if not records:
        errors.append("missing structured enterprise_attack_lens_packet")
        return
    present = {str(record.get("lens", "")).strip() for record in records}
    missing_lenses = sorted(ATTACK_LENSES - present)
    if missing_lenses:
        errors.append(f"enterprise_attack_lens_packet missing lenses: {', '.join(missing_lenses)}")
    for record in records:
        lens = str(record.get("lens", "<missing-lens>")).strip()
        status = str(record.get("status", "")).strip().upper()
        if status not in {"PASS", "FAIL", "N/A", "BLOCKED"}:
            errors.append(f"enterprise_attack_lens_packet {lens}: invalid status")
        if not any(
            str(record.get(field, "")).strip()
            for field in ("agent", "session_id", "worker_id", "receipt_id")
        ):
            errors.append(f"enterprise_attack_lens_packet {lens}: missing agent/session/receipt proof")
        if not str(record.get("evidence", "")).strip() and status != "N/A":
            errors.append(f"enterprise_attack_lens_packet {lens}: missing evidence")
        if status == "N/A" and not str(record.get("not_applicable_reason", "")).strip():
            errors.append(f"enterprise_attack_lens_packet {lens}: N/A needs not_applicable_reason")


def artifact_requires_verification_structure(rel: str, text: str) -> bool:
    lowered = text.lower()
    return rel.startswith("docs/reviews/") and (
        "verification report" in lowered or "harness" in lowered or "verify" in lowered
    )


def artifact_requires_attack_lenses(rel: str, text: str) -> bool:
    lowered = text.lower()
    return (
        rel.startswith("docs/reviews/")
        and "verification" not in rel.lower()
        and "verification report" not in lowered
    )


def validate_artifact(path: Path, rel: str) -> list[str]:
    text = path.read_text(encoding="utf-8")
    errors: list[str] = []
    lowered = text.lower()

    for term in FAILED_PROOF_TERMS:
        if term.lower() in lowered:
            errors.append(f"failed proof state is not allowed in final artifacts: {term}")

    if artifact_requires_verification_structure(rel, text):
        validate_pc_trace(text, errors)
        validate_changed_file_proof(text, errors)
    if rel.startswith("docs/reviews/") and (
        "pr readiness" in lowered or "advisory" in lowered or "copilot" in lowered
    ):
        validate_pr_readiness(text, errors)
    if artifact_requires_attack_lenses(rel, text):
        validate_attack_lenses(text, errors)
    if rel.startswith("docs/solutions/") and "review failure prevention" in lowered:
        validate_prevention_records(text, errors)

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate structured proof in enterprise artifacts.")
    parser.add_argument("--artifact", type=Path, required=True)
    parser.add_argument("--path", required=True, help="Repo-relative path for artifact type detection.")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    errors = validate_artifact(args.artifact, args.path)
    result = {"result": "FAIL" if errors else "PASS", "path": args.path, "errors": errors}
    if args.json:
        print(json.dumps(result, indent=2))
    elif errors:
        for error in errors:
            print(f"{args.path}: {error}", file=sys.stderr)
    else:
        print(f"structured proof OK: {args.path}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
