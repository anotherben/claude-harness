#!/usr/bin/env python3
"""Dispatch a Codex headless worker with MCP preflight and artifact paths."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_REQUIRED_MCPS = ("vault-index", "cortex-engine")


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def load_mcp_list(command: str = "codex") -> list[dict[str, Any]]:
    try:
        output = subprocess.check_output([command, "mcp", "list", "--json"], text=True, stderr=subprocess.STDOUT)
    except FileNotFoundError:
        raise SystemExit(f"required command not found: {command}")
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"codex MCP preflight failed:\n{exc.output.strip()}")
    try:
        data = json.loads(output)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"codex MCP preflight did not return JSON: {exc}")
    if not isinstance(data, list):
        raise SystemExit("codex MCP preflight must return a JSON list")
    return [item for item in data if isinstance(item, dict)]


def current_head(worktree: Path) -> str | None:
    try:
        return subprocess.check_output(
            ["git", "-C", str(worktree), "rev-parse", "HEAD"],
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (FileNotFoundError, subprocess.CalledProcessError):
        return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Dispatch a Codex headless enterprise worker.")
    parser.add_argument("--slug", required=True)
    parser.add_argument("--stage", required=True)
    parser.add_argument("--worker-id", required=True)
    parser.add_argument("--prompt-file", type=Path, required=True)
    parser.add_argument("--worktree", type=Path, default=Path.cwd())
    parser.add_argument("--output-dir", type=Path)
    parser.add_argument("--model", default="gpt-5.5")
    parser.add_argument("--codex-command", default="codex")
    parser.add_argument("--required-mcp", action="append", default=[])
    parser.add_argument(
        "--sandbox-mode",
        choices=["danger-full-access", "full-auto"],
        default="danger-full-access",
    )
    parser.add_argument("--dry-run", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    worktree = args.worktree.resolve()
    prompt_file = args.prompt_file.resolve()
    if not prompt_file.is_file():
        raise SystemExit(f"missing worker prompt file: {prompt_file}")

    output_dir = args.output_dir or worktree / ".codex" / "enterprise-state" / "dispatch" / args.slug / args.stage
    if not output_dir.is_absolute():
        output_dir = worktree / output_dir
    output_dir.mkdir(parents=True, exist_ok=True)

    mcp_list = load_mcp_list(args.codex_command)
    mcp_path = output_dir / "codex-mcp-list.json"
    mcp_path.write_text(json.dumps(mcp_list, indent=2), encoding="utf-8")
    enabled = {str(item.get("name", "")) for item in mcp_list if item.get("enabled") is True}
    required = set(args.required_mcp or DEFAULT_REQUIRED_MCPS)
    missing = sorted(required - enabled)
    if missing:
        raise SystemExit(f"missing required Codex MCP server(s): {', '.join(missing)}")

    result_path = output_dir / f"{args.worker_id}.out.md"
    events_path = output_dir / f"{args.worker_id}.events.jsonl"
    dispatch_path = output_dir / f"{args.worker_id}.dispatch.json"
    command = [
        args.codex_command,
        "exec",
        "--cd",
        str(worktree),
        "--model",
        args.model,
        "--json",
        "--output-last-message",
        str(result_path),
    ]
    if args.sandbox_mode == "danger-full-access":
        command.append("--dangerously-bypass-approvals-and-sandbox")
    else:
        command.append("--full-auto")
    command.append("-")

    dispatch_record = {
        "schema": "enterprise_codex_worker_dispatch.v1",
        "slug": args.slug,
        "stage": args.stage,
        "worker_id": args.worker_id,
        "runtime": "codex-headless",
        "model": args.model,
        "worktree": str(worktree),
        "head_sha": current_head(worktree),
        "prompt_file": str(prompt_file),
        "result_file": str(result_path),
        "events_file": str(events_path),
        "mcp_list_file": str(mcp_path),
        "required_mcp": sorted(required),
        "dispatched_at": iso_now(),
        "dry_run": bool(args.dry_run),
        "command": command,
    }
    dispatch_path.write_text(json.dumps(dispatch_record, indent=2), encoding="utf-8")

    if args.dry_run:
        dispatch_record["status"] = "DRY_RUN"
        dispatch_path.write_text(json.dumps(dispatch_record, indent=2), encoding="utf-8")
        print(json.dumps(dispatch_record, indent=2))
        return 0

    with prompt_file.open("r", encoding="utf-8") as stdin, events_path.open("w", encoding="utf-8") as stdout:
        completed = subprocess.run(command, cwd=worktree, text=True, stdin=stdin, stdout=stdout, stderr=subprocess.STDOUT)
    dispatch_record["completed_at"] = iso_now()
    dispatch_record["exit_code"] = completed.returncode
    dispatch_record["status"] = "PASS" if completed.returncode == 0 else "FAIL"
    dispatch_record["head_sha_after"] = current_head(worktree)
    dispatch_path.write_text(json.dumps(dispatch_record, indent=2), encoding="utf-8")
    print(json.dumps(dispatch_record, indent=2))
    return completed.returncode


if __name__ == "__main__":
    sys.exit(main())
