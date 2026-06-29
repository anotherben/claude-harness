#!/usr/bin/env python3
"""Validate Codex headless worker result artifacts."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


HERE = Path(__file__).resolve().parent
HARNESS_SCRIPT_DIR = HERE.parents[1] / "enterprise-harness" / "scripts"
sys.path.insert(0, str(HARNESS_SCRIPT_DIR))

from proof_utils import collect_records, read_text_files, status_is_pass  # noqa: E402


ALLOWED_STATUSES = {"PASS", "FAIL", "BLOCKED", "N/A"}
WORKER_KEYS = ("enterprise_worker_result", "worker_result")


def current_head(repo_root: Path) -> str | None:
    try:
        return subprocess.check_output(
            ["git", "-C", str(repo_root), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None


def load_direct_json(text: str) -> dict[str, Any] | None:
    try:
        parsed = json.loads(text.strip())
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def records_from_artifact(path: Path) -> list[dict[str, Any]]:
    text = read_text_files([path])
    records = collect_records(text, WORKER_KEYS)
    direct = load_direct_json(text)
    if direct:
        if any(key in direct for key in WORKER_KEYS):
            records.extend(collect_records(json.dumps(direct), WORKER_KEYS))
        elif str(direct.get("schema", "")).startswith("enterprise_worker_result"):
            records.append(direct)
    return records


def collect_artifacts(paths: list[Path], dispatch_root: Path | None) -> list[Path]:
    artifacts = list(paths)
    if dispatch_root:
        root = dispatch_root.resolve()
        artifacts.extend(sorted(root.rglob("*.out.md")))
        artifacts.extend(sorted(root.rglob("*.worker.json")))
    seen: set[Path] = set()
    unique: list[Path] = []
    for path in artifacts:
        resolved = path.resolve()
        if resolved not in seen:
            seen.add(resolved)
            unique.append(resolved)
    return unique


def as_list(value: Any) -> list[Any]:
    if isinstance(value, list):
        return value
    if value is None:
        return []
    return [value]


def string_list(value: Any) -> list[str]:
    return [str(item).strip() for item in as_list(value) if str(item).strip()]


def command_receipts(command: dict[str, Any]) -> list[str]:
    receipts: list[str] = []
    for key in ("receipt_id", "receipt_ids", "command_receipt_id", "command_receipt_ids"):
        receipts.extend(string_list(command.get(key)))
    return sorted(set(receipts))


def command_status(command: dict[str, Any]) -> Any:
    for key in ("status", "result", "command_status", "exit_code"):
        if key in command:
            return command[key]
    return None


def validate_command(command: Any, index: int) -> list[str]:
    missing: list[str] = []
    if not isinstance(command, dict):
        return [f"commands[{index}] object"]
    if not str(command.get("command", "")).strip():
        missing.append(f"commands[{index}].command")
    status = command_status(command)
    if status is None:
        missing.append(f"commands[{index}].status")
    elif not status_is_pass(status) and str(status).strip().upper() not in {"FAIL", "BLOCKED", "N/A"}:
        missing.append(f"commands[{index}].status valid")
    if status_is_pass(status) and command.get("receipt_required", True) is not False:
        if not command_receipts(command):
            missing.append(f"commands[{index}].receipt_id")
    return missing


def validate_record(
    record: dict[str, Any],
    artifact: Path,
    expected_head: str | None,
    expected_stage: str | None,
    expected_workers: set[str],
) -> dict[str, Any]:
    missing: list[str] = []
    worker_id = str(record.get("worker_id", "")).strip()
    stage = str(record.get("stage", "")).strip()
    status = str(record.get("status", "")).strip().upper()
    runtime = str(record.get("runtime", "")).strip().lower()

    for field in ("worker_id", "runtime", "model", "worktree", "head_sha", "stage", "status"):
        if not str(record.get(field, "")).strip():
            missing.append(field)

    if "codex" not in runtime:
        missing.append("runtime codex")
    if status not in ALLOWED_STATUSES:
        missing.append(f"status in {sorted(ALLOWED_STATUSES)}")
    if expected_head and str(record.get("head_sha", "")).strip() != expected_head:
        missing.append(f"head_sha {expected_head}")
    if expected_stage and stage != expected_stage:
        missing.append(f"stage {expected_stage}")
    if expected_workers and worker_id not in expected_workers:
        missing.append(f"worker_id in {sorted(expected_workers)}")

    assigned = (
        string_list(record.get("assigned_ids"))
        or string_list(record.get("pc_ids"))
        or string_list(record.get("lens_ids"))
        or string_list(record.get("task_ids"))
    )
    if not assigned:
        missing.append("assigned_ids/pc_ids/lens_ids/task_ids")

    commands = as_list(record.get("commands"))
    read_only = bool(record.get("read_only"))
    if not commands and not read_only:
        missing.append("commands or read_only=true")
    for index, command in enumerate(commands):
        missing.extend(validate_command(command, index))

    evidence = record.get("evidence")
    artifacts = record.get("artifacts")
    if not evidence and not artifacts:
        missing.append("evidence or artifacts")

    return {
        "artifact": str(artifact),
        "worker_id": worker_id or "<missing>",
        "stage": stage or "<missing>",
        "status": "PASS" if not missing else "FAIL",
        "missing": missing,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Codex headless worker artifacts.")
    parser.add_argument("--artifact", action="append", type=Path, default=[])
    parser.add_argument("--dispatch-root", type=Path)
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--expected-head", default=None)
    parser.add_argument("--stage")
    parser.add_argument("--worker-id", action="append", default=[])
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    expected_head = args.expected_head
    if expected_head is None:
        expected_head = current_head(args.repo_root.resolve())
    elif expected_head == "":
        expected_head = None

    artifacts = collect_artifacts(args.artifact, args.dispatch_root)
    if not artifacts:
        raise SystemExit("no worker artifacts found")

    expected_workers = {str(worker).strip() for worker in args.worker_id if str(worker).strip()}
    results: list[dict[str, Any]] = []
    for artifact in artifacts:
        records = records_from_artifact(artifact)
        if not records:
            results.append(
                {
                    "artifact": str(artifact),
                    "worker_id": "<missing>",
                    "stage": args.stage or "<unknown>",
                    "status": "FAIL",
                    "missing": ["structured enterprise_worker_result"],
                }
            )
            continue
        for record in records:
            results.append(validate_record(record, artifact, expected_head, args.stage, expected_workers))

    failed = [result for result in results if result["status"] != "PASS"]
    payload = {"result": "FAIL" if failed else "PASS", "artifacts": results}
    if args.json or not failed:
        print(json.dumps(payload, indent=2))
    else:
        for result in failed:
            print(f"{result['artifact']}: {', '.join(result['missing'])}", file=sys.stderr)
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
