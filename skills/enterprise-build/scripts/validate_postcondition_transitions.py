#!/usr/bin/env python3
"""Validate enterprise-build postcondition state transitions.

This validator is intentionally fail-closed. Build is allowed to record RED and
GREEN evidence, blockers, and recycle reasons, but it is not allowed to mint a
downstream VERIFIED state or count planned/staged commands as proof.
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from pathlib import Path
from typing import Any


BUILD_SCHEMA = "enterprise-build-postconditions.v3"
RECEIPT_SCHEMA = "enterprise_command_receipt.v1"
PASS_VALUES = {"PASS", "PASSED", "GREEN", "OK", "0"}
FAIL_VALUES = {"FAIL", "FAILED", "RED", "ERROR", "1", "124"}
PROOF_TYPES = {
    "unit",
    "integration",
    "live_db",
    "headless_browser",
    "e2e",
    "code_execution",
    "repo_gate",
}
REQUIRED_RECEIPT_FIELDS = (
    "receipt_id",
    "command",
    "command_status",
    "proof_type",
    "test_file",
    "test_name",
    "exit_code",
    "started_at",
    "finished_at",
    "head_sha",
    "head_sha_after",
    "output_sha256",
)
NOT_RUN_FLAGS = (
    "staged",
    "queued",
    "planned",
    "headless_ready",
    "ci_expected",
    "delegated_only",
)


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"missing JSON file: {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid JSON in {path}: {exc}")


def load_receipts(path: Path) -> dict[str, dict[str, Any]]:
    try:
        text = path.read_text(encoding="utf-8")
    except FileNotFoundError:
        raise SystemExit(f"missing receipt log: {path}")

    candidates: list[Any] = []
    stripped = text.strip()
    if not stripped:
        return {}
    try:
        parsed = json.loads(stripped)
        if isinstance(parsed, dict) and isinstance(parsed.get("receipts"), list):
            candidates.extend(parsed["receipts"])
        elif isinstance(parsed, list):
            candidates.extend(parsed)
        elif isinstance(parsed, dict):
            candidates.append(parsed)
    except json.JSONDecodeError:
        for line_no, line in enumerate(text.splitlines(), start=1):
            if not line.strip():
                continue
            try:
                candidates.append(json.loads(line))
            except json.JSONDecodeError as exc:
                raise SystemExit(f"invalid receipt JSONL in {path}:{line_no}: {exc}")

    receipts: dict[str, dict[str, Any]] = {}
    for item in candidates:
        if not isinstance(item, dict):
            continue
        receipt_id = str(item.get("receipt_id", "")).strip()
        if receipt_id:
            receipts[receipt_id] = item
    return receipts


def text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def list_text(value: Any) -> list[str]:
    if isinstance(value, list):
        return [text(item) for item in value if text(item)]
    if text(value):
        return [text(value)]
    return []


def status_is_pass(receipt: dict[str, Any]) -> bool:
    value = receipt.get("command_status", receipt.get("status", receipt.get("result", receipt.get("exit_code"))))
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value == 0
    return text(value).upper() in PASS_VALUES


def status_is_fail(receipt: dict[str, Any]) -> bool:
    value = receipt.get("command_status", receipt.get("status", receipt.get("result", receipt.get("exit_code"))))
    if isinstance(value, bool):
        return not value
    if isinstance(value, int):
        return value != 0
    upper = text(value).upper()
    return upper in FAIL_VALUES or (upper.isdigit() and upper != "0")


def receipt_id_for(pc: dict[str, Any], phase: str) -> str:
    direct = text(pc.get(f"{phase}_receipt_id"))
    if direct:
        return direct
    receipt_ids = list_text(pc.get("receipt_ids"))
    if phase == "red" and receipt_ids:
        return receipt_ids[0]
    if phase == "green" and len(receipt_ids) > 1:
        return receipt_ids[-1]
    return ""


def receipt_blob(receipt: dict[str, Any]) -> str:
    keys = (
        "contracted_reason",
        "signal",
        "output_excerpt",
        "pass_output",
        "command_output",
        "evidence_excerpt",
        "status_reason",
        "red_signal",
    )
    return "\n".join(text(receipt.get(key)) for key in keys).lower()


def validates_contracted_reason(pc: dict[str, Any], receipt: dict[str, Any]) -> bool:
    reason = text(pc.get("contracted_reason"))
    if not reason:
        return False
    if receipt.get("contracted_reason_match") is True:
        return True
    if text(receipt.get("contracted_reason")).lower() == reason.lower():
        return True
    return reason.lower() in receipt_blob(receipt)


def validate_receipt_common(
    label: str,
    receipt: dict[str, Any] | None,
    errors: list[str],
    *,
    expected_id: str,
    status_file: dict[str, Any],
) -> None:
    if receipt is None:
        errors.append(f"{label}: missing receipt log entry")
        return
    if text(receipt.get("schema")) and text(receipt.get("schema")) != RECEIPT_SCHEMA:
        errors.append(f"{label}: receipt schema must be {RECEIPT_SCHEMA}")
    for field in REQUIRED_RECEIPT_FIELDS:
        if not text(receipt.get(field)):
            errors.append(f"{label}: receipt missing {field}")
    if not text(receipt.get("artifact_path")) and not text(receipt.get("log_path")):
        errors.append(f"{label}: receipt needs artifact_path or log_path")
    if text(receipt.get("proof_type")).lower() not in PROOF_TYPES:
        errors.append(f"{label}: receipt proof_type must be one of {sorted(PROOF_TYPES)}")
    if text(receipt.get("id") or receipt.get("postcondition_id")) != expected_id:
        errors.append(f"{label}: receipt id/postcondition_id must match {expected_id}")
    if any(receipt.get(flag) is True for flag in NOT_RUN_FLAGS):
        errors.append(f"{label}: staged/planned/headless-ready commands cannot be proof receipts")
    if receipt.get("actual_run") is False:
        errors.append(f"{label}: actual_run=false cannot be proof")
    if status_file.get("base_sha") and not text(receipt.get("base_sha") or receipt.get("base_ref")):
        errors.append(f"{label}: PR-scoped status requires receipt base_sha or base_ref")


def validate_postcondition(pc: dict[str, Any], receipts: dict[str, dict[str, Any]], status_file: dict[str, Any], errors: list[str]) -> None:
    pc_id = text(pc.get("id"))
    label = pc_id or "<missing-id>"
    status = text(pc.get("status"))
    if not pc_id:
        errors.append("postcondition missing id")
        return
    if status not in {"pending", "red", "green", "blocked", "recycled", "verified"}:
        errors.append(f"{label}: invalid status {status!r}")
        return
    if status == "verified":
        errors.append(f"{label}: build cannot produce verified; downstream verification owns that state")
    if status == "blocked" and not (text(pc.get("blocker_reason")) or text(pc.get("status_reason"))):
        errors.append(f"{label}: blocked requires blocker_reason or status_reason")
    if status == "recycled" and not (text(pc.get("recycle_reason")) or text(pc.get("status_reason"))):
        errors.append(f"{label}: recycled requires recycle_reason or status_reason")

    red_id = receipt_id_for(pc, "red")
    green_id = receipt_id_for(pc, "green")
    red_receipt = receipts.get(red_id) if red_id else None
    green_receipt = receipts.get(green_id) if green_id else None

    if status in {"red", "green"}:
        if not red_id:
            errors.append(f"{label}: {status} requires red_receipt_id")
        validate_receipt_common(f"{label} red", red_receipt, errors, expected_id=pc_id, status_file=status_file)
        if red_receipt is not None:
            if not status_is_fail(red_receipt):
                errors.append(f"{label}: red receipt must be FAIL/non-zero")
            if not validates_contracted_reason(pc, red_receipt):
                errors.append(f"{label}: red receipt must prove the contracted reason")

    if status == "green":
        if not green_id:
            errors.append(f"{label}: green requires green_receipt_id")
        if red_id and green_id and red_id == green_id:
            errors.append(f"{label}: red and green receipts must be distinct")
        validate_receipt_common(f"{label} green", green_receipt, errors, expected_id=pc_id, status_file=status_file)
        if green_receipt is not None and not status_is_pass(green_receipt):
            errors.append(f"{label}: green receipt must be PASS/zero")


def validate_status(status_file: dict[str, Any], receipts: dict[str, dict[str, Any]]) -> list[str]:
    errors: list[str] = []
    if status_file.get("schema") != BUILD_SCHEMA:
        errors.append(f"status file schema must be {BUILD_SCHEMA}")
    for field in ("agent_id", "slug", "contract_file", "build_packet_file", "command_receipt_log", "head_sha"):
        if not text(status_file.get(field)):
            errors.append(f"status file missing {field}")
    postconditions = status_file.get("postconditions")
    if not isinstance(postconditions, list) or not postconditions:
        errors.append("status file needs non-empty postconditions")
        return errors
    seen: set[str] = set()
    for pc in postconditions:
        if not isinstance(pc, dict):
            errors.append("postcondition entries must be objects")
            continue
        pc_id = text(pc.get("id"))
        if pc_id in seen:
            errors.append(f"{pc_id}: duplicate postcondition id")
        seen.add(pc_id)
        for field in ("contracted_reason", "expected_red", "expected_green"):
            if not text(pc.get(field)):
                errors.append(f"{pc_id or '<missing-id>'}: missing {field}")
        validate_postcondition(pc, receipts, status_file, errors)
    return errors


def validate_files(status_path: Path, receipt_path: Path) -> list[str]:
    status_file = load_json(status_path)
    if not isinstance(status_file, dict):
        raise SystemExit(f"status file must be an object: {status_path}")
    receipts = load_receipts(receipt_path)
    return validate_status(status_file, receipts)


def sample_receipt(receipt_id: str, pc_id: str, status: str, exit_code: int) -> dict[str, Any]:
    return {
        "schema": RECEIPT_SCHEMA,
        "receipt_id": receipt_id,
        "id": pc_id,
        "proof_type": "unit",
        "command": "node --test tests/example.test.js",
        "argv": ["node", "--test", "tests/example.test.js"],
        "shell": False,
        "started_at": "2026-05-26T00:00:00Z",
        "finished_at": "2026-05-26T00:00:01Z",
        "duration_ms": 1000,
        "repo_root": "/tmp/repo",
        "base_ref": "origin/dev",
        "head_sha": "abc123",
        "head_sha_after": "abc123",
        "head_unchanged": True,
        "exit_code": exit_code,
        "command_status": status,
        "timed_out": False,
        "test_file": "tests/example.test.js",
        "test_name": "PC-1 behavior",
        "changed_runtime_paths": ["src/example.js"],
        "artifact_path": ".codex/enterprise-state/agent-sessions/receipt.json",
        "log_path": ".codex/enterprise-state/agent-sessions/receipt.log",
        "output_excerpt": "fails for missing validation",
        "output_sha256": "0" * 64,
        "contracted_reason_match": status == "FAIL",
    }


def run_self_test() -> int:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        receipt_path = root / "receipts.jsonl"
        red = sample_receipt("red-1", "PC-1", "FAIL", 1)
        green = sample_receipt("green-1", "PC-1", "PASS", 0)
        receipt_path.write_text("\n".join(json.dumps(item) for item in (red, green)) + "\n", encoding="utf-8")

        valid = {
            "schema": BUILD_SCHEMA,
            "agent_id": "agent",
            "slug": "sample",
            "contract_file": "docs/contracts/sample.md",
            "build_packet_file": ".codex/enterprise-state/sample.json",
            "command_receipt_log": str(receipt_path),
            "base_ref": "origin/dev",
            "head_sha": "abc123",
            "head_sha_after": "abc123",
            "postconditions": [
                {
                    "id": "PC-1",
                    "status": "green",
                    "contracted_reason": "missing validation",
                    "expected_red": "test fails for missing validation",
                    "expected_green": "test passes",
                    "red_receipt_id": "red-1",
                    "green_receipt_id": "green-1",
                }
            ],
        }
        valid_path = root / "valid.json"
        valid_path.write_text(json.dumps(valid), encoding="utf-8")
        valid_errors = validate_files(valid_path, receipt_path)
        if valid_errors:
            print(json.dumps({"self_test": "FAIL", "case": "valid", "errors": valid_errors}, indent=2))
            return 1

        invalid = dict(valid)
        invalid["postconditions"] = [
            {
                "id": "PC-1",
                "status": "verified",
                "contracted_reason": "missing validation",
                "expected_red": "test fails",
                "expected_green": "test passes",
                "green_receipt_id": "green-1",
            }
        ]
        invalid_path = root / "invalid.json"
        invalid_path.write_text(json.dumps(invalid), encoding="utf-8")
        invalid_errors = validate_files(invalid_path, receipt_path)
        required = [
            "build cannot produce verified",
        ]
        if not all(any(term in error for error in invalid_errors) for term in required):
            print(json.dumps({"self_test": "FAIL", "case": "invalid", "errors": invalid_errors}, indent=2))
            return 1

    print("postcondition transition validator self-test OK")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate enterprise-build postcondition transitions.")
    parser.add_argument("--status-file", type=Path)
    parser.add_argument("--receipt-log", type=Path)
    parser.add_argument("--schema", type=Path, help="Validate that the transition schema file is parseable JSON.")
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        return run_self_test()
    if args.schema:
        schema = load_json(args.schema)
        if not isinstance(schema, dict) or not schema.get("$schema"):
            print(f"invalid schema JSON: {args.schema}", file=sys.stderr)
            return 1
        print(f"schema JSON OK: {args.schema}")
        return 0
    if not args.status_file or not args.receipt_log:
        parser.error("--status-file and --receipt-log are required unless --schema or --self-test is used")

    errors = validate_files(args.status_file, args.receipt_log)
    result = {"result": "FAIL" if errors else "PASS", "errors": errors}
    if args.json:
        print(json.dumps(result, indent=2))
    elif errors:
        for error in errors:
            print(error, file=sys.stderr)
    else:
        print(f"postcondition transitions OK: {args.status_file}")
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main())
