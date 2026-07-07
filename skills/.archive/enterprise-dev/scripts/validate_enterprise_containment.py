#!/usr/bin/env python3
"""Fail source edits that are not contained by an enterprise build packet."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Iterable


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from agent_session import (  # noqa: E402
    build_packet_is_mechanical,
    contract_is_locked,
    extract_build_packet_field,
    history_stages,
    load_session,
    resolve_artifact_path,
    sanitize_agent_id,
    session_root_from,
)


SOURCE_EXTENSIONS = {
    ".cjs",
    ".css",
    ".html",
    ".js",
    ".jsx",
    ".mjs",
    ".py",
    ".sh",
    ".sql",
    ".ts",
    ".tsx",
}
SOURCE_ROOTS = (
    "apps/",
    "scripts/",
    "tests/",
    "tools/",
)
CONTROLLED_ROOT_FILES = {
    "eslint.config.js",
    "jest.config.js",
    "package-lock.json",
    "package.json",
    "playwright.config.js",
    "pnpm-lock.yaml",
    "tsconfig.json",
    "vite.config.js",
    "vitest.config.js",
    "yarn.lock",
}
NON_SOURCE_PREFIXES = (
    ".codex/enterprise-state/",
    ".codex/repo-skills/",
    "docs/",
    "node_modules/",
)
REQUIRED_UPSTREAM_STAGES = {"plan", "plan-360-audit", "contract-manager", "contract"}
REQUIRED_ARTIFACTS = {"plan", "plan_360_audit", "contract_review", "contract", "build_packet"}
QUICK_REQUIRED_UPSTREAM_STAGES = {"contract"}
QUICK_REQUIRED_ARTIFACTS = {"contract", "build_packet"}
SOURCE_DIFF_FILTER = "ACMRTD"


def run_git(repo_root: Path, args: list[str]) -> tuple[list[str], str | None]:
    completed = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        encoding="utf-8",
        errors="replace",
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if completed.returncode != 0:
        command = "git " + " ".join(args)
        detail = (completed.stderr or completed.stdout or "git command failed").strip()
        return [], f"{command}: {detail}"
    return [line.strip() for line in completed.stdout.splitlines() if line.strip()], None


def changed_paths(
    repo_root: Path,
    base: str,
    head: str,
    include_worktree: bool,
    include_staged: bool,
) -> tuple[list[str], list[str]]:
    paths: set[str] = set()
    errors: list[str] = []

    def collect(args: list[str]) -> list[str]:
        result, error = run_git(repo_root, args)
        if error:
            errors.append(error)
        return result

    if base and head:
        paths.update(collect(["diff", "--name-only", f"--diff-filter={SOURCE_DIFF_FILTER}", f"{base}...{head}"]))
        if not paths:
            paths.update(collect(["diff", "--name-only", f"--diff-filter={SOURCE_DIFF_FILTER}", base, head]))
    if include_staged:
        paths.update(collect(["diff", "--cached", "--name-only", f"--diff-filter={SOURCE_DIFF_FILTER}"]))
    if include_worktree:
        paths.update(collect(["diff", "--name-only", f"--diff-filter={SOURCE_DIFF_FILTER}"]))
        if not include_staged:
            paths.update(collect(["diff", "--cached", "--name-only", f"--diff-filter={SOURCE_DIFF_FILTER}"]))
        paths.update(collect(["ls-files", "-o", "--exclude-standard"]))
    return sorted(paths), errors


def normalize_path(value: str) -> str:
    normalized = value.strip().strip("`").strip()
    if normalized.startswith("./"):
        normalized = normalized[2:]
    return normalized


def is_source_path(path: str) -> bool:
    normalized = normalize_path(path)
    if any(normalized.startswith(prefix) for prefix in NON_SOURCE_PREFIXES):
        return False
    if normalized in CONTROLLED_ROOT_FILES:
        return True
    if not any(normalized.startswith(prefix) for prefix in SOURCE_ROOTS):
        return False
    return Path(normalized).suffix.lower() in SOURCE_EXTENSIONS


def is_test_source(path: str) -> bool:
    normalized = normalize_path(path)
    lowered = normalized.lower()
    return (
        normalized.startswith("tests/")
        or "/__tests__/" in lowered
        or lowered.endswith((".test.js", ".test.jsx", ".test.ts", ".test.tsx", ".spec.js", ".spec.ts"))
    )


def path_tokens(value: str) -> list[str]:
    tokens: list[str] = []
    for raw in value.replace(",", "\n").splitlines():
        item = raw.strip()
        if not item:
            continue
        if item.startswith(("-", "*")):
            item = item[1:].strip()
        if item.startswith("`") and "`" in item[1:]:
            item = item.split("`", 2)[1]
        else:
            item = item.split()[0]
        item = normalize_path(item.rstrip(";:"))
        if "/" in item or item in CONTROLLED_ROOT_FILES:
            tokens.append(item)
    return sorted(set(tokens))


def is_broad_allowed_path(value: str) -> bool:
    return value.endswith("/") or any(char in value for char in "*?[]")


def path_matches(path: str, allowed: Iterable[str]) -> bool:
    normalized = normalize_path(path)
    for raw_allowed in allowed:
        allowed_path = normalize_path(raw_allowed)
        if not allowed_path:
            continue
        if normalized == allowed_path:
            return True
    return False


def load_agent_session(repo_root: Path, session_root_value: str, agent_id: str) -> tuple[dict | None, str | None]:
    session_root = session_root_from(repo_root, session_root_value)
    session_path = session_root / f"{sanitize_agent_id(agent_id)}.json"
    session = load_session(session_path)
    if session is None:
        return None, f"agent session does not exist: {session_path}"
    return session, None


def validate(repo_root: Path, args: argparse.Namespace) -> dict:
    changed, path_errors = changed_paths(repo_root, args.base, args.head, args.include_worktree, args.include_staged)
    changed.extend(normalize_path(path) for path in args.path)
    source_paths = [path for path in changed if is_source_path(path)]
    source_paths = sorted(set(source_paths))
    errors: list[str] = []

    if path_errors and not args.path:
        return {
            "result": "FAIL",
            "source_paths": source_paths,
            "errors": ["could not determine changed paths for containment", *path_errors],
        }

    if not source_paths:
        return {
            "result": "PASS",
            "source_paths": [],
            "errors": [],
        }

    if not args.agent_id:
        return {
            "result": "FAIL",
            "source_paths": source_paths,
            "errors": ["source edits detected but --agent-id was not provided"],
        }

    session, error = load_agent_session(repo_root, args.session_root, args.agent_id)
    if error:
        return {
            "result": "FAIL",
            "source_paths": source_paths,
            "errors": [error],
        }
    assert session is not None

    is_quick = session.get("path_classification") == "QUICK"
    required_stages = QUICK_REQUIRED_UPSTREAM_STAGES if is_quick else REQUIRED_UPSTREAM_STAGES
    required_artifacts = QUICK_REQUIRED_ARTIFACTS if is_quick else REQUIRED_ARTIFACTS

    stages = history_stages(session)
    missing_stages = sorted(required_stages - stages)
    if missing_stages:
        errors.append("enterprise containment missing upstream stages: " + ", ".join(missing_stages))

    artifacts = session.get("artifacts", {})
    if not isinstance(artifacts, dict):
        artifacts = {}
    missing_artifacts = sorted(key for key in required_artifacts if not artifacts.get(key))
    if missing_artifacts:
        errors.append("enterprise containment missing artifacts: " + ", ".join(missing_artifacts))

    if not contract_is_locked(repo_root, session):
        errors.append("enterprise containment requires a LOCKED contract artifact")

    packet_ok, packet_failures = build_packet_is_mechanical(repo_root, session)
    if not packet_ok:
        errors.extend(packet_failures)

    build_packet = artifacts.get("build_packet")
    allowed_runtime: list[str] = []
    allowed_tests: list[str] = []
    if isinstance(build_packet, str) and build_packet:
        packet_path = resolve_artifact_path(repo_root, build_packet)
        if packet_path.exists():
            content = packet_path.read_text(encoding="utf-8", errors="replace")
            allowed_runtime = path_tokens(extract_build_packet_field(content, "Allowed Runtime Paths"))
            allowed_tests = path_tokens(extract_build_packet_field(content, "Allowed Test Paths"))

    broad_paths = [path for path in [*allowed_runtime, *allowed_tests] if is_broad_allowed_path(path)]
    if broad_paths:
        errors.append(
            "enterprise build packet allowed paths must be exact repo-relative file paths, not broad patterns or directories: "
            + ", ".join(broad_paths)
        )

    uncovered: list[str] = []
    for path in source_paths:
        allowed = [*allowed_runtime, *allowed_tests] if is_test_source(path) else allowed_runtime
        if not path_matches(path, allowed):
            uncovered.append(path)
    if uncovered:
        errors.append(
            "source edits are outside the enterprise build packet allowed paths: " + ", ".join(uncovered)
        )

    return {
        "result": "FAIL" if errors else "PASS",
        "source_paths": source_paths,
        "allowed_runtime_paths": allowed_runtime,
        "allowed_test_paths": allowed_tests,
        "errors": errors,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate enterprise containment for source edits.")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument("--agent-id")
    parser.add_argument("--session-root", default=".codex/enterprise-state/agent-sessions")
    parser.add_argument("--base", default="origin/dev")
    parser.add_argument("--head", default="HEAD")
    parser.add_argument("--include-worktree", action="store_true")
    parser.add_argument("--include-staged", action="store_true")
    parser.add_argument("--path", action="append", default=[], help="Explicit planned path to include in containment.")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    result = validate(Path(args.repo_root).resolve(), args)
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    elif result["errors"]:
        for error in result["errors"]:
            print(error, file=sys.stderr)
    else:
        print("enterprise containment OK")
    return 1 if result["errors"] else 0


if __name__ == "__main__":
    sys.exit(main())
