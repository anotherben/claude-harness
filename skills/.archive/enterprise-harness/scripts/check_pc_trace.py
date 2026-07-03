#!/usr/bin/env python3
"""Fail-closed postcondition trace checker for enterprise harness evidence."""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from proof_utils import (
    as_list,
    collect_records,
    current_head,
    load_receipts,
    parse_timestamp,
    proof_type,
    read_text_files,
    record_id,
    record_output,
    record_paths,
    record_status,
    record_timestamp,
    receipt_errors,
    status_is_pass,
)


ALLOWED_PROOF_TYPES = {
    "unit",
    "integration",
    "live_db",
    "headless_browser",
    "e2e",
    "code_execution",
    "repo_gate",
}

FAILED_PROOF_TERMS = (
    "PARTIALLY PROVED",
    "UNPROVED",
    "DO NOT CLAIM FIXED",
    "Gate Result: FAIL",
)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"missing postcondition registry: {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid postcondition registry JSON: {path}: {exc}")
    if not isinstance(data, dict):
        raise SystemExit(f"postcondition registry must be a JSON object: {path}")
    return data


def registry_items(registry: dict[str, Any]) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    for key in ("postconditions", "invariants"):
        raw = registry.get(key, [])
        if raw is None:
            continue
        if not isinstance(raw, list):
            raise SystemExit(f"{key} must be a list in postcondition registry")
        for item in raw:
            if isinstance(item, dict):
                entry = dict(item)
                entry["_kind"] = key
                items.append(entry)
    return items


def by_id(records: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for record in records:
        rid = record_id(record)
        if rid:
            grouped.setdefault(rid, []).append(record)
    return grouped


def check_record(
    item: dict[str, Any],
    record: dict[str, Any] | None,
    expected_head: str | None,
    max_age_hours: float,
    receipts: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    item_id = str(item.get("id", "")).strip()
    required_test_file = str(item.get("test_file", "")).strip()
    required_test_name = str(item.get("test_name", "")).strip()
    missing: list[str] = []

    if not item_id:
        missing.append("registry id")
    if record is None:
        missing.append(f"structured proof record for {item_id or '<missing-id>'}")
        return {
            "id": item_id or "<missing-id>",
            "kind": item.get("_kind", "postconditions"),
            "status": "FAIL",
            "missing": missing,
        }

    command = str(record.get("command", "")).strip()
    if not command:
        missing.append("command")
    if not status_is_pass(record_status(record)):
        missing.append("PASS command_status/result")

    record_text = json.dumps(record, sort_keys=True)
    for term in FAILED_PROOF_TERMS:
        if term.lower() in record_text.lower():
            missing.append(f"no failed proof state: {term}")

    timestamp_value = record_timestamp(record)
    parsed_timestamp = parse_timestamp(timestamp_value)
    if parsed_timestamp is None:
        missing.append("valid verified_at/command_timestamp")
    elif max_age_hours > 0:
        age_hours = (datetime.now(timezone.utc) - parsed_timestamp).total_seconds() / 3600
        if age_hours > max_age_hours:
            missing.append(f"fresh timestamp <= {max_age_hours:g}h")

    head_sha = str(record.get("head_sha", "")).strip()
    if expected_head:
        if not head_sha:
            missing.append("head_sha")
        elif head_sha != expected_head:
            missing.append(f"current head_sha {expected_head}")

    test_file = str(record.get("test_file", "")).strip()
    test_name = str(record.get("test_name", "")).strip()
    if not test_file:
        missing.append("test_file")
    if not test_name:
        missing.append("test_name")
    if required_test_file and test_file and required_test_file != test_file:
        missing.append(f"registry test_file {required_test_file}")
    if required_test_name and test_name and required_test_name != test_name:
        missing.append(f"registry test_name {required_test_name}")

    paths = record_paths(record)
    non_runtime_reason = str(record.get("non_runtime_reason", "")).strip()
    if not paths and not non_runtime_reason:
        missing.append("changed_runtime_paths or non_runtime_reason")

    ptype = proof_type(record)
    if ptype not in ALLOWED_PROOF_TYPES:
        missing.append(f"proof_type in {sorted(ALLOWED_PROOF_TYPES)}")

    output = record_output(record)
    if not output:
        missing.append("pass_output/output_excerpt")

    edge_cases = as_list(record.get("edge_cases"))
    edge_case_reason = str(record.get("edge_case_reason", "")).strip()
    if not edge_cases and not edge_case_reason:
        missing.append("edge_cases or edge_case_reason")

    command_and_output = f"{command}\n{output}".lower()
    if ptype == "headless_browser" and not any(
        term in command_and_output for term in ("playwright", "browser", "chromium", "headless")
    ):
        missing.append("headless browser command/output marker")
    if ptype == "live_db" and not any(
        term in command_and_output
        for term in ("postgres", "psql", "database_url", "live db", "integration db", "real postgres")
    ):
        missing.append("live/integration DB command/output marker")

    missing.extend(receipt_errors(record, receipts, expected_head))

    return {
        "id": item_id or "<missing-id>",
        "kind": item.get("_kind", "postconditions"),
        "proof_type": ptype,
        "test_file": test_file,
        "test_name": test_name,
        "changed_runtime_paths": paths,
        "status": "PASS" if not missing else "FAIL",
        "missing": missing,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Verify every contract PC/invariant is explicitly traced to structured current evidence."
    )
    parser.add_argument("--postconditions", required=True, type=Path)
    parser.add_argument("--evidence", action="append", type=Path, default=[])
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--head-sha")
    parser.add_argument("--max-age-hours", type=float, default=24)
    parser.add_argument(
        "--receipt-log",
        action="append",
        type=Path,
        required=True,
        help="JSONL receipts written by run_with_receipt.py. Required so proof is not hand-written markdown.",
    )
    args = parser.parse_args()

    registry = load_json(args.postconditions)
    items = registry_items(registry)
    if not items:
        raise SystemExit("postcondition registry has no postconditions or invariants")
    if not args.evidence:
        raise SystemExit("at least one --evidence file is required")

    evidence = read_text_files(args.evidence)
    records = collect_records(evidence, ("enterprise_pc_trace", "pc_trace", "postcondition_trace"))
    if not records:
        raise SystemExit(
            "evidence lacks structured enterprise_pc_trace JSON records; "
            "test counts and headings are not PC trace proof"
        )

    expected_head = args.head_sha or current_head(args.repo_root)
    receipts = load_receipts(args.receipt_log)
    if not receipts:
        raise SystemExit("receipt log has no enterprise command receipts")
    grouped = by_id(records)
    results = [
        check_record(
            item,
            (grouped.get(str(item.get("id", "")).strip()) or [None])[0],
            expected_head,
            args.max_age_hours,
            receipts,
        )
        for item in items
    ]
    failed = [result for result in results if result["status"] != "PASS"]
    print(json.dumps({"result": "FAIL" if failed else "PASS", "items": results}, indent=2))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
