#!/usr/bin/env python3
"""Map changed runtime files to structured proof records."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

from proof_utils import (
    collect_records,
    current_head,
    has_query_or_schema_readback,
    has_source_grounding,
    load_receipts,
    non_migration_source_read_paths,
    proof_type,
    read_text_files,
    record_output,
    record_paths,
    record_status,
    receipt_errors,
    status_is_pass,
)


RUNTIME_SUFFIXES = {
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".mjs",
    ".cjs",
    ".py",
    ".sh",
    ".sql",
}


def changed_files(repo_root: Path, base: str, head: str) -> list[str]:
    commands = [
        ["git", "-C", str(repo_root), "diff", "--name-only", f"{base}...{head}"],
        ["git", "-C", str(repo_root), "diff", "--name-only", base, head],
    ]
    last_error = ""
    for command in commands:
        try:
            output = subprocess.check_output(command, text=True, stderr=subprocess.STDOUT)
            return [line.strip() for line in output.splitlines() if line.strip()]
        except subprocess.CalledProcessError as exc:
            last_error = exc.output.strip()
    raise SystemExit(f"could not compute changed files for {base}..{head}: {last_error}")


def is_runtime(path: str) -> bool:
    p = Path(path)
    if p.suffix not in RUNTIME_SUFFIXES:
        return False
    lowered = path.lower()
    if any(part in lowered for part in ("/__tests__/", ".test.", ".spec.", "/test/", "/tests/")):
        return False
    if lowered.startswith(("docs/", ".codex/repo-skills/")):
        return False
    return True


def is_ui_surface(path: str) -> bool:
    lowered = path.lower()
    return (
        lowered.endswith((".jsx", ".tsx"))
        or "apps/admin" in lowered
        or "frontend" in lowered
        or "component" in lowered
        or "pdf" in lowered
        or "upload" in lowered
    )


def is_data_surface(path: str) -> bool:
    lowered = path.lower()
    return (
        lowered.endswith(".sql")
        or "migration" in lowered
        or "database" in lowered
        or "/db" in lowered
        or "query" in lowered
        or "schema" in lowered
    )


def matching_records(path: str, records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [record for record in records if path in record_paths(record)]


def check_file(
    path: str,
    records: list[dict[str, Any]],
    expected_head: str | None,
    receipts: dict[str, dict[str, Any]],
) -> dict[str, Any]:
    matches = matching_records(path, records)
    missing: list[str] = []
    if not matches:
        return {"path": path, "status": "FAIL", "missing": ["structured proof record"]}

    passing = [record for record in matches if status_is_pass(record_status(record))]
    if not passing:
        missing.append("PASS proof record")
        passing = matches

    proof_types = {proof_type(record) for record in passing}
    if not proof_types.intersection({"unit", "integration", "live_db", "headless_browser", "e2e", "code_execution"}):
        missing.append("execution proof_type")

    if expected_head:
        stale = [record for record in passing if str(record.get("head_sha", "")).strip() != expected_head]
        if stale:
            missing.append(f"current head_sha {expected_head}")

    if not any(record_output(record) for record in passing):
        missing.append("pass_output/output_excerpt")

    if is_ui_surface(path) and "headless_browser" not in proof_types and "e2e" not in proof_types:
        missing.append("headless_browser or e2e proof for UI/PDF/file surface")
    if is_data_surface(path):
        if "live_db" not in proof_types and "integration" not in proof_types:
            missing.append("live_db or integration proof for schema/query/data surface")
        if not any(non_migration_source_read_paths(record) for record in passing):
            missing.append("current runtime source_read_paths/code_read_paths for schema/query/data surface")
        if not any(has_source_grounding(record) for record in passing):
            missing.append("cortex freshness/source-grounding proof or explicit fallback reason")
        if not any(has_query_or_schema_readback(record) for record in passing):
            missing.append("query/schema readback proof against runtime path, not migration-only proof")

    receipt_failures: list[str] = []
    for record in passing:
        receipt_failures.extend(receipt_errors(record, receipts, expected_head, require_runtime_path=path))
    if receipt_failures:
        missing.extend(sorted(set(receipt_failures)))

    return {
        "path": path,
        "status": "PASS" if not missing else "FAIL",
        "proof_types": sorted(proof_types),
        "records": [str(record.get("id") or record.get("pc_id") or "") for record in passing],
        "missing": missing,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Fail if changed runtime files lack structured proof.")
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--base", default="origin/dev")
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--head-sha")
    parser.add_argument("--evidence", action="append", type=Path, required=True)
    parser.add_argument(
        "--receipt-log",
        action="append",
        type=Path,
        required=True,
        help="JSONL receipts written by run_with_receipt.py. Required so changed-file proof is command-backed.",
    )
    args = parser.parse_args()

    evidence = read_text_files(args.evidence)
    records = collect_records(evidence, ("enterprise_pc_trace", "enterprise_changed_file_proof", "changed_file_proof"))
    if not records:
        raise SystemExit("evidence lacks structured changed-file proof records")

    all_changed = changed_files(args.repo_root, args.base, args.head)
    runtime_files = [path for path in all_changed if is_runtime(path)]
    expected_head = args.head_sha or current_head(args.repo_root)
    receipts = load_receipts(args.receipt_log)
    if not receipts:
        raise SystemExit("receipt log has no enterprise command receipts")
    results = [check_file(path, records, expected_head, receipts) for path in runtime_files]
    failed = [result for result in results if result["status"] != "PASS"]
    print(
        json.dumps(
            {
                "result": "FAIL" if failed else "PASS",
                "base": args.base,
                "head": args.head,
                "runtime_files": results,
                "non_runtime_changed_files": [path for path in all_changed if path not in runtime_files],
            },
            indent=2,
        )
    )
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
