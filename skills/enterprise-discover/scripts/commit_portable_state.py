#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path


DEFAULT_PORTABLE_PATHS = (
    ".codex/enterprise-state/repo-profile.json",
    ".codex/enterprise-state/repo-traps.json",
    ".codex/enterprise-state/repo-best-practices.json",
    ".codex/repo-skills",
)

FORBIDDEN_EXACT_PATHS = {
    ".codex/enterprise-state/local-machine.json",
}

FORBIDDEN_PREFIXES = (
    ".codex/enterprise-state/agent-sessions/",
)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Stage and commit only the portable enterprise repo artifacts.",
    )
    parser.add_argument("--repo-root", default=".")
    parser.add_argument(
        "--message",
        default="Seed enterprise repo profile and overlays",
        help="Commit message for portable setup artifacts.",
    )
    parser.add_argument(
        "--extra-path",
        action="append",
        default=[],
        help="Additional repo-relative portable paths to include, such as .gitignore.",
    )
    parser.add_argument(
        "--stage-only",
        action="store_true",
        help="Stage portable files but do not create a commit.",
    )
    return parser.parse_args()


def run_git(repo_root: Path, *args: str, check: bool = True) -> subprocess.CompletedProcess:
    completed = subprocess.run(
        ["git", *args],
        cwd=repo_root,
        text=True,
        capture_output=True,
    )
    if check and completed.returncode != 0:
        raise RuntimeError(
            "git {args} failed ({code})\nstdout:\n{stdout}\nstderr:\n{stderr}".format(
                args=" ".join(args),
                code=completed.returncode,
                stdout=completed.stdout,
                stderr=completed.stderr,
            )
        )
    return completed


def normalize_repo_path(path_text: str) -> str:
    return path_text.replace("\\", "/").strip("/")


def is_forbidden(path_text: str) -> bool:
    normalized = normalize_repo_path(path_text)
    if normalized in FORBIDDEN_EXACT_PATHS:
        return True
    return any(normalized == prefix.rstrip("/") or normalized.startswith(prefix) for prefix in FORBIDDEN_PREFIXES)


def path_matches_root(path_text: str, root_text: str) -> bool:
    normalized_path = normalize_repo_path(path_text)
    normalized_root = normalize_repo_path(root_text)
    return normalized_path == normalized_root or normalized_path.startswith(f"{normalized_root}/")


def resolve_existing_paths(repo_root: Path, requested_paths: list[str]) -> list[str]:
    existing = []
    for relative_path in requested_paths:
        if is_forbidden(relative_path):
            raise RuntimeError(f"refusing forbidden path: {relative_path}")
        candidate = repo_root / relative_path
        if candidate.exists():
            existing.append(relative_path)
    return existing


def main() -> int:
    args = parse_args()
    requested_repo_root = Path(args.repo_root).resolve()
    git_top = run_git(requested_repo_root, "rev-parse", "--show-toplevel").stdout.strip()
    repo_root = Path(git_top).resolve()

    requested_paths = list(DEFAULT_PORTABLE_PATHS) + list(args.extra_path)
    portable_paths = resolve_existing_paths(repo_root, requested_paths)
    if not portable_paths:
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": "no-portable-paths-found",
                    "requested_paths": requested_paths,
                },
                indent=2,
            )
        )
        return 1

    run_git(repo_root, "add", "--", *portable_paths)

    all_staged = run_git(repo_root, "diff", "--cached", "--name-only").stdout.splitlines()
    all_staged = [normalize_repo_path(path) for path in all_staged if path.strip()]

    forbidden_staged = [path for path in all_staged if is_forbidden(path)]
    if forbidden_staged:
        run_git(repo_root, "rm", "--cached", "--quiet", "--ignore-unmatch", "--", *forbidden_staged, check=False)
        all_staged = run_git(repo_root, "diff", "--cached", "--name-only").stdout.splitlines()
        all_staged = [normalize_repo_path(path) for path in all_staged if path.strip()]

    staged_portable = [
        path for path in all_staged if any(path_matches_root(path, root) for root in portable_paths)
    ]
    if not staged_portable:
        print(
            json.dumps(
                {
                    "ok": True,
                    "action": "noop",
                    "portable_paths": portable_paths,
                    "message": "No portable changes were staged.",
                },
                indent=2,
            )
        )
        return 0

    forbidden_staged = [path for path in all_staged if is_forbidden(path)]
    if forbidden_staged:
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": "forbidden-path-staged",
                    "paths": forbidden_staged,
                },
                indent=2,
            )
        )
        return 1

    if args.stage_only:
        print(
            json.dumps(
                {
                    "ok": True,
                    "action": "stage-only",
                    "portable_paths": portable_paths,
                    "staged_paths": staged_portable,
                },
                indent=2,
            )
        )
        return 0

    run_git(repo_root, "commit", "-m", args.message, "--", *portable_paths)
    commit_sha = run_git(repo_root, "rev-parse", "HEAD").stdout.strip()
    committed_paths = run_git(repo_root, "show", "--name-only", "--format=", "HEAD", "--", *portable_paths).stdout.splitlines()
    committed_paths = [normalize_repo_path(path) for path in committed_paths if path.strip()]

    if any(is_forbidden(path) for path in committed_paths):
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": "forbidden-path-committed",
                    "commit_sha": commit_sha,
                    "paths": committed_paths,
                },
                indent=2,
            )
        )
        return 1

    if any(not any(path_matches_root(path, root) for root in portable_paths) for path in committed_paths):
        print(
            json.dumps(
                {
                    "ok": False,
                    "reason": "unexpected-path-committed",
                    "commit_sha": commit_sha,
                    "paths": committed_paths,
                    "portable_paths": portable_paths,
                },
                indent=2,
            )
        )
        return 1

    print(
        json.dumps(
            {
                "ok": True,
                "action": "commit",
                "commit_sha": commit_sha,
                "portable_paths": portable_paths,
                "committed_paths": committed_paths,
            },
            indent=2,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except RuntimeError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2))
        raise SystemExit(1)
