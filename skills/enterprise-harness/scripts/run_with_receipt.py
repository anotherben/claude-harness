#!/usr/bin/env python3
"""Run a headless command and append a verifiable enterprise command receipt."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shlex
import subprocess
import sys
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from proof_utils import current_head


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def excerpt(text: str, limit: int) -> str:
    cleaned = text.replace("\x00", "")
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit] + f"\n...[truncated {len(cleaned) - limit} chars]"


def command_string(command: list[str], shell: bool) -> str:
    if shell:
        return " ".join(command).strip()
    return " ".join(shlex.quote(part) for part in command)


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run a non-interactive command and write a JSONL enterprise_command_receipt."
    )
    parser.add_argument("--repo-root", type=Path, default=Path.cwd())
    parser.add_argument("--receipt-log", type=Path, default=Path(".codex/enterprise-state/command-receipts.jsonl"))
    parser.add_argument("--id", required=True, help="PC id, invariant id, gate id, or proof id.")
    parser.add_argument(
        "--proof-type",
        required=True,
        choices=["unit", "integration", "live_db", "headless_browser", "e2e", "code_execution", "repo_gate"],
    )
    parser.add_argument("--test-file", default="")
    parser.add_argument("--test-name", default="")
    parser.add_argument("--changed-runtime-path", action="append", default=[])
    parser.add_argument("--edge-case", action="append", default=[])
    parser.add_argument("--timeout-seconds", type=float, default=1800)
    parser.add_argument("--output-limit", type=int, default=12000)
    parser.add_argument("--shell", action="store_true", help="Run the command through the shell.")
    parser.add_argument("command", nargs=argparse.REMAINDER)
    args = parser.parse_args()

    command = list(args.command)
    if command and command[0] == "--":
        command = command[1:]
    if not command:
        raise SystemExit("command is required after --")

    repo_root = args.repo_root.resolve()
    receipt_log = args.receipt_log
    if not receipt_log.is_absolute():
        receipt_log = repo_root / receipt_log

    started_at = iso_now()
    start = time.monotonic()
    head_before = current_head(repo_root)
    combined = ""
    exit_code = 1
    timed_out = False
    command_text = command_string(command, args.shell)

    try:
        env = dict(os.environ)
        env.setdefault("CI", "1")
        completed = subprocess.run(
            command_text if args.shell else command,
            cwd=repo_root,
            shell=args.shell,
            text=True,
            stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=args.timeout_seconds,
            env=env,
        )
        combined = completed.stdout or ""
        exit_code = int(completed.returncode)
    except subprocess.TimeoutExpired as exc:
        timed_out = True
        stdout = exc.stdout or ""
        stderr = exc.stderr or ""
        if isinstance(stdout, bytes):
            stdout = stdout.decode(errors="replace")
        if isinstance(stderr, bytes):
            stderr = stderr.decode(errors="replace")
        combined = f"{stdout}\n{stderr}\nTIMEOUT after {args.timeout_seconds:g}s".strip()
        exit_code = 124

    finished_at = iso_now()
    duration_ms = int((time.monotonic() - start) * 1000)
    head_after = current_head(repo_root)
    output_excerpt = excerpt(combined, args.output_limit)
    receipt = {
        "schema": "enterprise_command_receipt.v1",
        "receipt_id": str(uuid.uuid4()),
        "id": args.id,
        "proof_type": args.proof_type,
        "command": command_text,
        "argv": command if not args.shell else [],
        "shell": bool(args.shell),
        "started_at": started_at,
        "finished_at": finished_at,
        "duration_ms": duration_ms,
        "repo_root": str(repo_root),
        "head_sha": head_before,
        "head_sha_after": head_after,
        "head_unchanged": head_before == head_after,
        "exit_code": exit_code,
        "command_status": "PASS" if exit_code == 0 else "FAIL",
        "timed_out": timed_out,
        "test_file": args.test_file,
        "test_name": args.test_name,
        "changed_runtime_paths": sorted(set(args.changed_runtime_path)),
        "edge_cases": args.edge_case,
        "output_excerpt": output_excerpt,
        "output_sha256": hashlib.sha256(combined.encode("utf-8", errors="replace")).hexdigest(),
    }

    receipt_log.parent.mkdir(parents=True, exist_ok=True)
    with receipt_log.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(receipt, sort_keys=True) + "\n")

    print(json.dumps(receipt, indent=2, sort_keys=True))
    return exit_code


if __name__ == "__main__":
    sys.exit(main())
