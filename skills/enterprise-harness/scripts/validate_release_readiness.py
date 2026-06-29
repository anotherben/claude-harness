#!/usr/bin/env python3
"""Validate release-readiness proof in enterprise verification evidence."""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from proof_utils import (
    collect_records,
    current_head,
    parse_timestamp,
    read_text_files,
    record_paths,
    record_status,
    record_timestamp,
    status_is_pass,
    unsafe_secret_or_db_labels,
)


REQUIRED_PROOF_KEYS = [
    "enterprise_release_risk",
    "enterprise_post_merge_test_kit",
    "enterprise_rollback_readiness",
    "enterprise_observability_proof",
    "enterprise_security_privacy_proof",
    "enterprise_performance_regression",
    "enterprise_intent_continuity",
    "enterprise_touched_file_srp",
    "enterprise_db_query_ownership",
    "enterprise_branch_reason_coverage",
    "enterprise_cast_index_safety",
    "enterprise_runtime_proof_parity",
    "enterprise_proof_lane_integrity",
    "enterprise_integration_fault_matrix",
    "enterprise_boundary_scope_invariants",
    "enterprise_observability_redaction_contract",
    "enterprise_public_seam_consumer_contract",
    "enterprise_architecture_ratchet",
    "enterprise_local_full_schema_proof",
    "enterprise_evidence_portability",
    "enterprise_test_integrity",
]

FAILED_PROOF_PATTERNS = [
    (re.compile(r"\bPARTIALLY\s+PROVED\b", re.IGNORECASE), "partial proof verdict"),
    (re.compile(r"\bUNPROVED\b", re.IGNORECASE), "unproved verdict"),
    (re.compile(r"\bDO\s+NOT\s+CLAIM\s+FIXED\b", re.IGNORECASE), "do-not-claim-fixed verdict"),
    (re.compile(r"\bgate[_ -]?result\s*[:=]\s*[\"']?FAIL\b", re.IGNORECASE), "failed proof gate result"),
    (re.compile(r"\bproof[_ -]?verdict\s*[:=]\s*[\"']?(?:partial|partially|unproved|failed|fail)", re.IGNORECASE), "non-proved proof verdict"),
    (re.compile(r"\bverdict\s*[:=]\s*[\"']?(?:PARTIALLY\s+PROVED|UNPROVED|DO\s+NOT\s+CLAIM\s+FIXED)", re.IGNORECASE), "failed verdict field"),
    (re.compile(r"/(?:Users|home)/[^\s`'\"<>]+", re.IGNORECASE), "machine-local absolute path in proof"),
    (re.compile(r"\b(?:PATH|NODE_PATH)\s*=", re.IGNORECASE), "machine-local environment prefix in proof"),
    (re.compile(r"\b(?:Remaining\s+Before\s+Merge|Create\s+PR\s+with\s+wrapper)\b", re.IGNORECASE), "stale PR-state checklist in proof"),
    (re.compile(r"\{STAMP\}|\bNo\s+PR\s+exists\s+yet\b", re.IGNORECASE), "stale placeholder or pre-PR text in proof"),
    (re.compile(r"\btests?\s+ran\s+against\s+production\b|\bproduction\s+database\s+url\b", re.IGNORECASE), "production database proof target"),
    (re.compile(r"\bprod(?:uction)?\s+(?:dump|backup)\s+(?:committed|checked\s+in|in\s+repo)\b", re.IGNORECASE), "production dump stored in repo"),
    (re.compile(r"\b(?:postgresql?|postgres)://[^\s`'\"<>]+", re.IGNORECASE), "raw postgres connection string in proof"),
    (re.compile(r"\bPGPASSWORD\s*=", re.IGNORECASE), "postgres password environment variable in proof"),
    (re.compile(r"\.pgpass\b", re.IGNORECASE), "postgres password file reference in proof"),
    (re.compile(r"\b(?:primary|prod|production)\s+(?:db|database|snapshot|clone|dump|backup)\b", re.IGNORECASE), "production-like database source in proof"),
]

NON_PASS_VERDICT_PATTERN = re.compile(r"^(?:FAIL|FAILED|PARTIAL|PARTIALLY PROVED|UNPROVED|DO NOT CLAIM FIXED|WARN|WARNING)$", re.IGNORECASE)
NOT_APPLICABLE_VALUES = {"N/A", "NA", "NOT_APPLICABLE", "NOT APPLICABLE", "NONE"}
DB_SENSITIVE_PATH_RE = re.compile(
    r"(^|/)(?:migrations?|schema|sql|db|database|models?|services?|routes?|workers?|api)(/|$)|"
    r"\b(?:invoice|inventory|order|payment|tenant|shopify|rex)\b",
    re.IGNORECASE,
)
LOCAL_TARGET_RE = re.compile(r"\b(?:localhost|127\.0\.0\.1|::1|local(?:host)?|unix socket)\b", re.IGNORECASE)
LOCAL_TARGET_ID_RE = re.compile(r"(?:543\d|/[A-Za-z0-9_.-]+|dbname\s*=|database\s*=|container\s*:)", re.IGNORECASE)
CLEANUP_RE = re.compile(
    r"\b(?:dropdb|createdb|drop\s+database|truncate|delete\s+from|docker\s+compose\s+down\s+-v|docker\s+volume\s+rm|reset)\b",
    re.IGNORECASE,
)
NON_PROD_SOURCE_RE = re.compile(r"\b(?:dev|development|staging|test|local|non[- ]?prod(?:uction)?)\b", re.IGNORECASE)
HEAD_FIELDS = ("head_sha", "commit_sha", "git_head", "head_ref_oid")
BASE_FIELDS = ("base_sha", "base_ref_oid")

REQUIRED_RECORD_FIELDS = {
    "enterprise_architecture_ratchet": (
        "public_seam",
        "owner_layer",
        "allowed_dependency_direction",
        "forbidden_imports",
        "architecture_test_command",
        "regression_trap",
    ),
    "enterprise_local_full_schema_proof": (
        "db_source",
        "local_db_target",
        "restore_command",
        "proof_command",
        "safety_controls",
        "cleanup_command",
    ),
    "enterprise_intent_continuity": (
        "original_user_words",
        "business_outcome",
        "operator_acceptance",
        "non_goals",
        "proof_command",
    ),
    "enterprise_touched_file_srp": (
        "changed_file",
        "owner_layer",
        "srp_classification",
        "required_action",
        "proof_command",
    ),
    "enterprise_db_query_ownership": (
        "query_path",
        "operation",
        "owner_seam",
        "current_db_schema",
        "scope_predicates",
        "affected_row_or_readback",
        "bounded_proof_command",
        "cleanup_command",
    ),
}


def read_text(path: Path) -> str:
    try:
        return path.read_text(encoding="utf-8", errors="replace")
    except OSError as error:
        raise SystemExit(f"cannot read evidence file: {path}: {error}") from error


def flatten_json(value) -> str:
    if isinstance(value, dict):
        parts: list[str] = []
        for key, item in value.items():
            parts.append(str(key))
            parts.append(flatten_json(item))
        return "\n".join(parts)
    if isinstance(value, list):
        return "\n".join(flatten_json(item) for item in value)
    return str(value)


def flattened_evidence_text(raw: str) -> str:
    try:
        return flatten_json(json.loads(raw))
    except json.JSONDecodeError:
        return raw


def field_text(record: dict, field: str) -> str:
    value = record.get(field)
    if isinstance(value, (list, dict)):
        return json.dumps(value, sort_keys=True)
    return str(value or "").strip()


def verdict_value(record: dict) -> str:
    for key in ("result", "status", "verdict", "gate_result", "proof_verdict"):
        if key in record:
            return str(record.get(key, "")).strip()
    status = record_status(record)
    return str(status or "").strip()


def first_field(record: dict, fields: tuple[str, ...]) -> str:
    for field in fields:
        value = field_text(record, field)
        if value:
            return value
    return ""


def is_not_applicable(record: dict) -> bool:
    verdict = verdict_value(record).upper().replace("-", "_")
    return verdict in NOT_APPLICABLE_VALUES


def not_applicable_failures(key: str, record: dict) -> list[str]:
    failures: list[str] = []
    for field in ("not_applicable_reason", "source_evidence", "applicability_predicate"):
        if not field_text(record, field):
            failures.append(f"{key} not-applicable record missing field {field}")
    if key == "enterprise_local_full_schema_proof":
        scope = field_text(record, "scope_classification").lower()
        if scope not in {"doc-only", "no-runtime-change", "no-db-change", "non-db-change"}:
            failures.append("enterprise_local_full_schema_proof N/A requires doc-only/no-runtime-change/no-db-change scope_classification")
        paths = record_paths(record)
        if not paths:
            failures.append("enterprise_local_full_schema_proof N/A requires changed_runtime_paths/changed_files")
        elif any(DB_SENSITIVE_PATH_RE.search(path) for path in paths):
            failures.append("enterprise_local_full_schema_proof cannot be N/A for schema/query/data-sensitive paths")
    if key == "enterprise_db_query_ownership":
        scope = field_text(record, "scope_classification").lower()
        if scope not in {"doc-only", "no-runtime-change", "no-db-change", "non-db-change", "no-query-change"}:
            failures.append("enterprise_db_query_ownership N/A requires doc-only/no-runtime-change/no-db-change/no-query-change scope_classification")
        paths = record_paths(record)
        if not paths:
            failures.append("enterprise_db_query_ownership N/A requires changed_runtime_paths/changed_files")
        elif any(DB_SENSITIVE_PATH_RE.search(path) for path in paths):
            failures.append("enterprise_db_query_ownership cannot be N/A for schema/query/data-sensitive paths")
    return failures


def record_passes(record: dict) -> bool:
    verdict = verdict_value(record)
    return status_is_pass(verdict) or verdict.upper() == "PROVED"


def record_freshness_failures(
    key: str,
    record: dict,
    expected_head: str | None,
    expected_base_sha: str | None,
    max_age_hours: float | None,
) -> list[str]:
    failures: list[str] = []
    record_head = first_field(record, HEAD_FIELDS)
    if not record_head:
        failures.append(f"{key} record missing head_sha")
    elif expected_head and record_head != expected_head:
        failures.append(f"{key} record head_sha {record_head} does not match current head {expected_head}")

    if expected_base_sha:
        record_base = first_field(record, BASE_FIELDS)
        if not record_base:
            failures.append(f"{key} record missing base_sha")
        elif record_base != expected_base_sha:
            failures.append(f"{key} record base_sha {record_base} does not match PR base {expected_base_sha}")

    timestamp = parse_timestamp(record_timestamp(record))
    if timestamp is None:
        failures.append(f"{key} record missing valid verified_at/timestamp")
    elif max_age_hours is not None:
        now = datetime.now(timezone.utc)
        if timestamp > now + timedelta(minutes=5):
            failures.append(f"{key} record timestamp is in the future")
        elif now - timestamp > timedelta(hours=max_age_hours):
            failures.append(f"{key} record is older than {max_age_hours:g} hours")
    return failures


def local_full_schema_failures(record: dict) -> list[str]:
    failures: list[str] = []
    source = field_text(record, "db_source")
    if not NON_PROD_SOURCE_RE.search(source):
        failures.append("enterprise_local_full_schema_proof db_source is not explicitly dev/staging/test/local/non-production")
    target = " ".join(
        field_text(record, field)
        for field in ("local_db_target", "db_target", "target_database", "target_environment")
    )
    if not LOCAL_TARGET_RE.search(target) or not LOCAL_TARGET_ID_RE.search(target):
        failures.append("enterprise_local_full_schema_proof target must name local host/socket plus a concrete database/container identity")
    safety = field_text(record, "safety_controls").lower()
    for phrase in ("no production writes", "no printed secrets", "no repo dumps"):
        if phrase not in safety:
            failures.append(f"enterprise_local_full_schema_proof safety_controls missing {phrase!r}")
    cleanup = field_text(record, "cleanup_command")
    if not CLEANUP_RE.search(cleanup):
        failures.append("enterprise_local_full_schema_proof cleanup_command must reset/drop/truncate the local target")
    return failures


def record_failures(
    key: str,
    record: dict,
    expected_head: str | None,
    expected_base_sha: str | None,
    max_age_hours: float | None,
) -> list[str]:
    failures: list[str] = []
    verdict = verdict_value(record)
    failures.extend(record_freshness_failures(key, record, expected_head, expected_base_sha, max_age_hours))
    if NON_PASS_VERDICT_PATTERN.match(verdict):
        failures.append(f"{key} record has non-passing verdict {verdict!r}")
    if is_not_applicable(record):
        failures.extend(not_applicable_failures(key, record))
        return failures
    if not record_passes(record):
        failures.append(f"{key} record is not PASS/PROVED")
    for field in REQUIRED_RECORD_FIELDS.get(key, ()):  # extra structure for high-risk records
        if not field_text(record, field):
            failures.append(f"{key} record missing field {field}")
    if key == "enterprise_local_full_schema_proof":
        failures.extend(local_full_schema_failures(record))
    return failures


def validate_text(
    raw: str,
    evidence_label: str,
    *,
    expected_head: str | None = None,
    expected_base_sha: str | None = None,
    max_age_hours: float | None = 168,
) -> dict:
    if expected_head is None:
        expected_head = current_head(Path.cwd())
    flattened = flattened_evidence_text(raw)
    missing: list[str] = []
    failed_proof = [label for pattern, label in FAILED_PROOF_PATTERNS if pattern.search(flattened)]
    failed_proof.extend(unsafe_secret_or_db_labels(flattened))
    failed_proof = sorted(set(failed_proof))
    if failed_proof:
        missing.extend(f"failed proof state: {label}" for label in failed_proof)

    for key in REQUIRED_PROOF_KEYS:
        records = collect_records(raw, (key,))
        if not records:
            missing.append(key)
            continue
        key_errors: list[str] = []
        for record in records:
            errors = record_failures(key, record, expected_head, expected_base_sha, max_age_hours)
            key_errors.extend(errors)
        if key_errors:
            missing.extend(key_errors or [f"{key} has no passing structured record"])
    return {
        "result": "PASS" if not missing else "FAIL",
        "evidence": evidence_label,
        "expected_head": expected_head,
        "expected_base_sha": expected_base_sha,
        "max_age_hours": max_age_hours,
        "required": REQUIRED_PROOF_KEYS,
        "missing": missing,
    }


def validate(path: Path, expected_head: str | None, expected_base_sha: str | None, max_age_hours: float | None) -> dict:
    return validate_text(
        read_text(path),
        str(path),
        expected_head=expected_head,
        expected_base_sha=expected_base_sha,
        max_age_hours=max_age_hours,
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--head-sha", help="Expected current git head for every release-readiness record. Defaults to repo HEAD.")
    parser.add_argument("--base-sha", help="Expected PR base SHA for every release-readiness record when PR-scoped evidence is checked.")
    parser.add_argument("--max-age-hours", type=float, default=168, help="Maximum age for record timestamps. Use 0 to disable.")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    max_age_hours = None if args.max_age_hours == 0 else args.max_age_hours
    result = validate(Path(args.evidence), args.head_sha, args.base_sha, max_age_hours)
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"release readiness: {result['result']}")
        for key in result["missing"]:
            print(f"missing: {key}")
    return 0 if result["result"] == "PASS" else 1


if __name__ == "__main__":
    raise SystemExit(main())
