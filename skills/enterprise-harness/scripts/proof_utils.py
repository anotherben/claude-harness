#!/usr/bin/env python3
"""Shared structured-proof helpers for enterprise harness scripts."""

from __future__ import annotations

import json
import re
import subprocess
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


JSON_FENCE_RE = re.compile(r"```(?:json)?\s*(\{.*?\})\s*```", re.DOTALL | re.IGNORECASE)
UNSAFE_SECRET_OR_DB_PATTERNS = (
    (
        re.compile(
            r"\b(?:postgresql?|postgres|mysql|mariadb|mongodb(?:\+srv)?|redis|rediss|amqp|amqps|mssql|sqlserver)://[^\s`'\"<>]+",
            re.IGNORECASE,
        ),
        "raw database or service connection string",
    ),
    (
        re.compile(
            r"\b(?:DATABASE_URL|DB_URL|DB_URI|DATABASE_URI|PGPASSWORD|MYSQL_PWD|PASSWORD|PASSWD|API_KEY|SECRET_KEY|PRIVATE_KEY|ACCESS_TOKEN|AUTH_TOKEN|SHOPIFY_ACCESS_TOKEN|REX_API_KEY)\s*[:=]\s*[\"']?(?!<redacted>|redacted\b|\*\*\*|x{4,}\b)[^\s`'\"<>]+",
            re.IGNORECASE,
        ),
        "secret-bearing environment variable or field",
    ),
    (re.compile(r"\.pgpass\b", re.IGNORECASE), "postgres password file reference"),
    (
        re.compile(r"\b(?:primary|prod|production|live)\s+(?:db|database|snapshot|clone|dump|backup)\b", re.IGNORECASE),
        "production-like database source",
    ),
    (re.compile(r"\brds\s+snapshot\b", re.IGNORECASE), "ambiguous remote database snapshot source"),
    (
        re.compile(
            r"(?:^|[\s`'\"<>])(?:\./)?(?:\.codex|\.Codex|apps|database|docs|migrations|scripts|tmp)[^\s`'\"<>]*\.(?:dump|backup|bak|tar|tgz|gz|zip)\b",
            re.IGNORECASE,
        ),
        "database dump or backup stored under a repo path",
    ),
)


def read_text_files(paths: list[Path]) -> str:
    chunks: list[str] = []
    for path in paths:
        try:
            chunks.append(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            raise SystemExit(f"missing evidence file: {path}")
    return "\n".join(chunks)


def unsafe_secret_or_db_labels(value: Any) -> list[str]:
    if isinstance(value, str):
        text = value
    else:
        text = json.dumps(value, sort_keys=True, default=str)
    labels = [label for pattern, label in UNSAFE_SECRET_OR_DB_PATTERNS if pattern.search(text)]
    return sorted(set(labels))


def _json_objects(text: str) -> list[dict[str, Any]]:
    objects: list[dict[str, Any]] = []
    stripped = text.strip()
    if stripped.startswith("{") and stripped.endswith("}"):
        try:
            parsed = json.loads(stripped)
            if isinstance(parsed, dict):
                objects.append(parsed)
        except json.JSONDecodeError:
            pass
    for match in JSON_FENCE_RE.finditer(text):
        try:
            parsed = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue
        if isinstance(parsed, dict):
            objects.append(parsed)
    return objects


def collect_records(text: str, keys: tuple[str, ...]) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    for obj in _json_objects(text):
        for key in keys:
            raw = obj.get(key)
            if isinstance(raw, list):
                records.extend(item for item in raw if isinstance(item, dict))
            elif isinstance(raw, dict):
                nested = raw.get("records")
                if isinstance(nested, list):
                    records.extend(item for item in nested if isinstance(item, dict))
                else:
                    records.append(raw)
    return records


def current_head(repo_root: Path) -> str | None:
    try:
        return subprocess.check_output(
            ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def parse_timestamp(value: str) -> datetime | None:
    if not value:
        return None
    candidate = value.strip()
    if candidate.endswith("Z"):
        candidate = candidate[:-1] + "+00:00"
    try:
        parsed = datetime.fromisoformat(candidate)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def status_is_pass(value: Any) -> bool:
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return value == 0
    if not isinstance(value, str):
        return False
    return value.strip().upper() in {"PASS", "PASSED", "GREEN", "OK", "0"}


def as_list(value: Any) -> list[str]:
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    if isinstance(value, str) and value.strip():
        return [value.strip()]
    return []


def record_id(record: dict[str, Any]) -> str:
    for key in ("id", "pc_id", "contract_item", "postcondition_id", "invariant_id"):
        value = str(record.get(key, "")).strip()
        if value:
            return value
    return ""


def proof_type(record: dict[str, Any]) -> str:
    return str(record.get("proof_type") or record.get("type") or "").strip().lower()


def record_paths(record: dict[str, Any]) -> list[str]:
    paths: list[str] = []
    for key in ("changed_runtime_paths", "runtime_paths", "changed_files", "files"):
        paths.extend(as_list(record.get(key)))
    return sorted(set(paths))


def is_migration_path(path: str) -> bool:
    lowered = path.lower()
    return (
        "/migrations/" in lowered
        or "/migration/" in lowered
        or lowered.endswith(("_migration.sql", "-migration.sql"))
        or "database/migrations" in lowered
    )


def record_source_read_paths(record: dict[str, Any]) -> list[str]:
    paths: list[str] = []
    for key in (
        "source_read_paths",
        "code_read_paths",
        "runtime_source_paths",
        "source_truth_paths",
        "runtime_query_paths",
    ):
        paths.extend(as_list(record.get(key)))
    return sorted(set(paths))


def non_migration_source_read_paths(record: dict[str, Any]) -> list[str]:
    return [path for path in record_source_read_paths(record) if not is_migration_path(path)]


def has_query_or_schema_readback(record: dict[str, Any]) -> bool:
    for key in (
        "query_under_test",
        "runtime_query",
        "schema_readback",
        "db_readback",
        "readback_sql",
        "query_command",
        "query_proof",
    ):
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return True
        if isinstance(value, (list, dict)) and value:
            return True
    return False


def has_value(record: dict[str, Any], keys: tuple[str, ...]) -> bool:
    for key in keys:
        value = record.get(key)
        if isinstance(value, str) and value.strip():
            return True
        if isinstance(value, (list, dict)) and value:
            return True
    return False


def has_cortex_source_grounding(record: dict[str, Any]) -> bool:
    if has_value(
        record,
        (
            "cortex_status",
            "cortex_diagnostic",
            "cortex_freshness",
            "cortex_query",
            "cortex_symbols",
            "cortex_outline",
            "cortex_read_symbol",
            "cortex_probe",
            "source_index_status",
        ),
    ):
        return True
    for key in ("source_read_tools", "source_tools", "source_grounding_tools"):
        value = record.get(key)
        if isinstance(value, (list, dict, str)) and "cortex" in json.dumps(value).lower():
            return True
    return False


def has_explicit_cortex_fallback(record: dict[str, Any]) -> bool:
    return has_value(
        record,
        (
            "cortex_fallback_reason",
            "source_read_fallback_reason",
            "source_index_fallback_reason",
        ),
    )


def has_source_grounding(record: dict[str, Any]) -> bool:
    return has_cortex_source_grounding(record) or has_explicit_cortex_fallback(record)


def record_output(record: dict[str, Any]) -> str:
    for key in ("pass_output", "output_excerpt", "command_output", "evidence_excerpt"):
        value = str(record.get(key, "")).strip()
        if value:
            return value
    return ""


def record_status(record: dict[str, Any]) -> Any:
    for key in ("command_status", "status", "result"):
        if key in record:
            return record[key]
    return None


def record_timestamp(record: dict[str, Any]) -> str:
    for key in ("verified_at", "command_timestamp", "timestamp"):
        value = str(record.get(key, "")).strip()
        if value:
            return value
    return ""


def record_receipt_ids(record: dict[str, Any]) -> list[str]:
    ids: list[str] = []
    for key in ("receipt_id", "receipt_ids", "command_receipt_id", "command_receipt_ids"):
        ids.extend(as_list(record.get(key)))
    return sorted(set(ids))


def load_receipts(paths: list[Path]) -> dict[str, dict[str, Any]]:
    receipts: dict[str, dict[str, Any]] = {}
    for path in paths:
        try:
            text = path.read_text(encoding="utf-8")
        except FileNotFoundError:
            raise SystemExit(f"missing receipt log: {path}")

        candidates: list[Any] = []
        stripped = text.strip()
        if not stripped:
            continue
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

        for item in candidates:
            if not isinstance(item, dict):
                continue
            receipt_id = str(item.get("receipt_id", "")).strip()
            if receipt_id:
                receipts[receipt_id] = item
    return receipts


def receipt_output(receipt: dict[str, Any]) -> str:
    for key in ("output_excerpt", "pass_output", "command_output"):
        value = str(receipt.get(key, "")).strip()
        if value:
            return value
    return ""


def receipt_timestamp(receipt: dict[str, Any]) -> str:
    for key in ("finished_at", "verified_at", "command_timestamp", "timestamp"):
        value = str(receipt.get(key, "")).strip()
        if value:
            return value
    return ""


def receipt_status(receipt: dict[str, Any]) -> Any:
    for key in ("command_status", "status", "result", "exit_code"):
        if key in receipt:
            return receipt[key]
    return None


def matching_receipts(record: dict[str, Any], receipts: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    return [receipts[receipt_id] for receipt_id in record_receipt_ids(record) if receipt_id in receipts]


def receipt_errors(
    record: dict[str, Any],
    receipts: dict[str, dict[str, Any]],
    expected_head: str | None,
    *,
    require_runtime_path: str | None = None,
) -> list[str]:
    ids = record_receipt_ids(record)
    if not ids:
        return ["receipt_id"]

    missing_ids = [receipt_id for receipt_id in ids if receipt_id not in receipts]
    if missing_ids:
        return [f"receipt log entry for {', '.join(missing_ids)}"]

    errors: list[str] = []
    command = str(record.get("command", "")).strip()
    test_file = str(record.get("test_file", "")).strip()
    test_name = str(record.get("test_name", "")).strip()
    ptype = proof_type(record)
    paths = set(record_paths(record))
    if require_runtime_path:
        paths.add(require_runtime_path)

    for receipt in matching_receipts(record, receipts):
        receipt_id = str(receipt.get("receipt_id", "")).strip()
        prefix = f"receipt {receipt_id}"

        for label in unsafe_secret_or_db_labels(receipt):
            errors.append(f"{prefix} contains unsafe evidence: {label}")
        if not status_is_pass(receipt_status(receipt)):
            errors.append(f"{prefix} PASS command_status/exit_code")
        if expected_head and str(receipt.get("head_sha", "")).strip() != expected_head:
            errors.append(f"{prefix} current head_sha {expected_head}")
        if str(receipt.get("head_sha_after", "")).strip() and expected_head:
            if str(receipt.get("head_sha_after", "")).strip() != expected_head:
                errors.append(f"{prefix} head_sha_after {expected_head}")
        if command and str(receipt.get("command", "")).strip() != command:
            errors.append(f"{prefix} command matches proof record")
        if ptype and str(receipt.get("proof_type", "")).strip().lower() != ptype:
            errors.append(f"{prefix} proof_type {ptype}")
        if test_file and str(receipt.get("test_file", "")).strip() != test_file:
            errors.append(f"{prefix} test_file {test_file}")
        if test_name and str(receipt.get("test_name", "")).strip() != test_name:
            errors.append(f"{prefix} test_name {test_name}")
        receipt_paths = set(record_paths(receipt))
        if paths and not paths.issubset(receipt_paths):
            errors.append(f"{prefix} changed_runtime_paths include {sorted(paths)}")
        if not receipt_output(receipt):
            errors.append(f"{prefix} output_excerpt")
        if not receipt.get("output_sha256"):
            errors.append(f"{prefix} output_sha256")
        if parse_timestamp(receipt_timestamp(receipt)) is None:
            errors.append(f"{prefix} valid timestamp")

    return errors
