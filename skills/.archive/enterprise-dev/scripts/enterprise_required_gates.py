#!/usr/bin/env python3
import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Optional


AGENT_STAGE_GATES = {
    "contract",
    "build",
    "review",
    "forge",
    "verify",
    "harness",
    "pr-readiness",
    "merge",
    "compound",
}
FINAL_PROOF_STAGES = {"harness", "pr-readiness", "merge"}
ARCHITECTURE_CONTRACT_STAGES = {"build", "review", "forge", "verify", "harness", "pr-readiness", "merge"}
CONTAINMENT_STAGES = {"build", "review", "forge", "verify", "harness", "pr-readiness", "merge"}
QUICK_LANE_BOUNDARY_TEXT = "QUICK lane ends at focused verify"
CLOSEOUT_GATE_STAGES = {"pr-readiness", "merge"}
CLOSEOUT_PATH_CLASSIFICATIONS = {"PR_CLOSEOUT", "NON_ENTERPRISE_PR_CLOSEOUT"}
SESSION_ARTIFACT_ALIASES = {
    "postconditions": ("postconditions", "postcondition_registry"),
    "verification": ("verification", "verify", "verification_report"),
    "receipt_log": ("receipt_log", "receipts", "command_receipts", "receipt_log_jsonl"),
    "build_packet": ("build_packet", "mechanical_build_packet", "contract"),
    "contract": ("contract", "locked_contract"),
    "review": ("review", "review_report"),
    "forge_report": ("forge_report", "forge", "forge_review"),
    "solution": ("solution", "compound", "solution_report"),
    "dispatch_root": ("dispatch_root", "worker_dispatch_root"),
    "worker_artifact": ("worker_artifact", "worker_artifacts"),
}


def repo_root_from(value: Optional[str]) -> Path:
    if value:
        return Path(value).resolve()
    try:
        completed = subprocess.run(
            ["git", "rev-parse", "--show-toplevel"],
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        return Path(completed.stdout.strip()).resolve()
    except (OSError, subprocess.CalledProcessError):
        return Path.cwd().resolve()


def enterprise_source_root(repo_root: Path) -> Path:
    repo_copy = repo_root / "tools" / "enterprise-skills"
    if repo_copy.exists():
        return repo_copy
    return Path(__file__).resolve().parents[2]


def sanitize_agent_id(agent_id: str) -> str:
    cleaned = "".join(char if char.isalnum() or char in "._-" else "-" for char in agent_id).strip("-.")
    if not cleaned:
        raise ValueError("agent id resolved to an empty value")
    return cleaned


def session_root_from(repo_root: Path, value: str) -> Path:
    candidate = Path(value)
    if not candidate.is_absolute():
        candidate = repo_root / candidate
    return candidate.resolve()


def load_agent_session(repo_root: Path, args: argparse.Namespace) -> tuple[Optional[dict], Optional[dict]]:
    if not args.agent_id:
        return None, {
            "name": "agent_session_loaded",
            "status": "FAIL",
            "required": True,
            "cmd": [],
            "reason": "final proof stages require --agent-id",
        }
    session_root = session_root_from(repo_root, args.session_root)
    session_path = session_root / f"{sanitize_agent_id(args.agent_id)}.json"
    if not session_path.exists():
        return None, {
            "name": "agent_session_loaded",
            "status": "FAIL",
            "required": True,
            "cmd": [],
            "reason": f"agent session does not exist: {session_path}",
        }
    try:
        return json.loads(session_path.read_text(encoding="utf-8")), None
    except json.JSONDecodeError as error:
        return None, {
            "name": "agent_session_loaded",
            "status": "FAIL",
            "required": True,
            "cmd": [],
            "reason": f"agent session is not valid JSON: {error}",
        }


def tail(value: str, limit: int = 1200) -> str:
    value = value.strip()
    if len(value) <= limit:
        return value
    return value[-limit:]


def run_step(name: str, cmd: list[str], cwd: Path, required: bool = True) -> dict:
    if not cmd:
        return {
            "name": name,
            "status": "SKIP",
            "required": required,
            "cmd": [],
            "reason": "empty command",
        }
    executable = cmd[0]
    if shutil.which(executable) is None and not Path(executable).exists():
        return {
            "name": name,
            "status": "FAIL" if required else "SKIP",
            "required": required,
            "cmd": cmd,
            "reason": f"missing executable: {executable}",
        }
    completed = subprocess.run(
        cmd,
        cwd=cwd,
        encoding="utf-8",
        errors="replace",
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return {
        "name": name,
        "status": "PASS" if completed.returncode == 0 else ("FAIL" if required else "WARN"),
        "required": required,
        "cmd": cmd,
        "returncode": completed.returncode,
        "stdout": tail(completed.stdout),
        "stderr": tail(completed.stderr),
    }


def run_git(repo_root: Path, args: list[str]) -> subprocess.CompletedProcess:
    cmd = ["git", *args]
    try:
        return subprocess.run(
            cmd,
            cwd=repo_root,
            encoding="utf-8",
            errors="replace",
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except OSError as exc:
        return subprocess.CompletedProcess(
            cmd,
            127,
            stdout="",
            stderr=f"unable to execute git: {exc}",
        )


def command_available(command: str, env_var: Optional[str] = None) -> bool:
    if env_var and os.environ.get(env_var):
        return True
    return shutil.which(command) is not None


def fresh_worktree_start_step(repo_root: Path) -> dict:
    if os.environ.get("GITHUB_ACTIONS") == "true":
        return {
            "name": "fresh_worktree_start_gate",
            "status": "SKIP",
            "required": False,
            "cmd": [],
            "reason": "skipped in GitHub Actions checkout",
        }

    branch = run_git(repo_root, ["branch", "--show-current"])
    branch_name = branch.stdout.strip()
    if branch.returncode != 0 or not branch_name:
        return {
            "name": "fresh_worktree_start_gate",
            "status": "FAIL",
            "required": True,
            "cmd": ["git", "branch", "--show-current"],
            "reason": "enterprise start requires a named feature branch in an isolated worktree",
            "stderr": tail(branch.stderr),
        }

    if branch_name in {"main", "master", "dev"}:
        return {
            "name": "fresh_worktree_start_gate",
            "status": "FAIL",
            "required": True,
            "cmd": ["git", "branch", "--show-current"],
            "reason": (
                f"enterprise start must not run directly on {branch_name}; cut a fresh worktree "
                "from origin/dev first"
            ),
        }

    status = run_git(repo_root, ["status", "--porcelain=v1", "--untracked-files=all"])
    dirty = [line for line in status.stdout.splitlines() if line.strip()]
    if status.returncode != 0:
        return {
            "name": "fresh_worktree_start_gate",
            "status": "FAIL",
            "required": True,
            "cmd": ["git", "status", "--porcelain=v1", "--untracked-files=all"],
            "reason": "could not inspect worktree cleanliness",
            "stderr": tail(status.stderr),
        }
    if dirty:
        return {
            "name": "fresh_worktree_start_gate",
            "status": "FAIL",
            "required": True,
            "cmd": ["git", "status", "--porcelain=v1", "--untracked-files=all"],
            "reason": (
                "enterprise start requires a clean fresh worktree before planning or contracting; "
                "stash, commit, or cut a new worktree from origin/dev"
            ),
            "stdout": tail("\n".join(dirty)),
        }

    fetch = run_git(repo_root, ["fetch", "--prune", "origin", "+refs/heads/dev:refs/remotes/origin/dev"])
    if fetch.returncode != 0:
        return {
            "name": "fresh_worktree_start_gate",
            "status": "FAIL",
            "required": True,
            "cmd": ["git", "fetch", "--prune", "origin", "+refs/heads/dev:refs/remotes/origin/dev"],
            "reason": "cannot verify freshness because origin/dev could not be refreshed",
            "stderr": tail(fetch.stderr or fetch.stdout),
        }

    origin_dev = run_git(repo_root, ["rev-parse", "--verify", "origin/dev"])
    if origin_dev.returncode != 0:
        return {
            "name": "fresh_worktree_start_gate",
            "status": "FAIL",
            "required": True,
            "cmd": ["git", "rev-parse", "--verify", "origin/dev"],
            "reason": "cannot verify freshness because origin/dev is missing; run git fetch origin dev first",
            "stderr": tail(origin_dev.stderr),
        }

    ancestor = run_git(repo_root, ["merge-base", "--is-ancestor", "origin/dev", "HEAD"])
    if ancestor.returncode != 0:
        behind = run_git(repo_root, ["rev-list", "--left-right", "--count", "HEAD...origin/dev"])
        behind_text = behind.stdout.strip()
        return {
            "name": "fresh_worktree_start_gate",
            "status": "FAIL",
            "required": True,
            "cmd": ["git", "merge-base", "--is-ancestor", "origin/dev", "HEAD"],
            "details": [["git", "fetch", "--prune", "origin", "+refs/heads/dev:refs/remotes/origin/dev"]],
            "reason": (
                "enterprise start requires a branch cut from current origin/dev; this branch is stale "
                "or has the wrong ancestry, so create a fresh worktree from origin/dev before continuing"
            ),
            "stdout": f"rev-list HEAD...origin/dev: {behind_text}" if behind_text else "",
            "stderr": tail(ancestor.stderr),
        }

    return {
        "name": "fresh_worktree_start_gate",
        "status": "PASS",
        "required": True,
        "cmd": ["git", "fetch", "--prune", "origin", "+refs/heads/dev:refs/remotes/origin/dev"],
        "details": [
            ["git", "status", "--porcelain=v1", "--untracked-files=all"],
            ["git", "merge-base", "--is-ancestor", "origin/dev", "HEAD"],
        ],
        "stdout": f"branch={branch_name}",
        "stderr": "",
    }


def enterprise_precheck_step(repo_root: Path, source_root: Path) -> dict:
    cmd = ["enterprise-precheck", "--skill", "enterprise"]
    if shutil.which("enterprise-precheck") is not None:
        return run_step("enterprise_precheck", cmd, repo_root, required=True)

    if os.environ.get("GITHUB_ACTIONS") != "true":
        return {
            "name": "enterprise_precheck",
            "status": "FAIL",
            "required": True,
            "cmd": cmd,
            "reason": "enterprise-precheck executable is missing outside CI; install the global wrapper instead of treating file presence as a passed precheck",
        }

    required_files = [
        source_root / "enterprise" / "SKILL.md",
        source_root / "enterprise" / "scripts" / "agent_session.py",
        source_root / "enterprise" / "scripts" / "enterprise_required_gates.py",
        source_root / "enterprise-harness" / "SKILL.md",
    ]
    missing = [str(path) for path in required_files if not path.exists()]
    if missing:
        return {
            "name": "enterprise_precheck",
            "status": "FAIL",
            "required": True,
            "cmd": cmd,
            "reason": "enterprise-precheck missing and repo-local CI fallback is incomplete: "
            + ", ".join(missing),
        }

    return {
        "name": "enterprise_precheck",
        "status": "PASS",
        "required": True,
        "cmd": cmd,
        "stdout": "repo-local CI fallback: enterprise-precheck executable unavailable; repo-local enterprise gate tooling is present",
        "stderr": "",
    }


def missing_artifact_step(key: str, required: bool = True) -> dict:
    return {
        "name": f"final_harness_artifact:{key}",
        "status": "FAIL" if required else "SKIP",
        "required": required,
        "cmd": [],
        "reason": f"missing required final proof artifact: {key}",
    }


def resolve_repo_path(repo_root: Path, value: Optional[str]) -> Optional[Path]:
    if not value:
        return None
    candidate = Path(value)
    if candidate.is_absolute():
        return candidate.resolve()
    return (repo_root / candidate).resolve()


def repo_relative(repo_root: Path, path: Path) -> str:
    try:
        return path.resolve().relative_to(repo_root).as_posix()
    except ValueError:
        return str(path)


def session_artifact(session: dict, key: str) -> Optional[str]:
    artifacts = session.get("artifacts", {})
    if not isinstance(artifacts, dict):
        return None
    for alias in SESSION_ARTIFACT_ALIASES.get(key, (key,)):
        value = artifacts.get(alias)
        if isinstance(value, str) and value.strip():
            return value.strip()
        if isinstance(value, list) and value:
            first = str(value[0]).strip()
            if first:
                return first
    return None


def arg_or_session_artifact(args: argparse.Namespace, session: dict, key: str) -> Optional[str]:
    value = getattr(args, key.replace("-", "_"), None)
    if value:
        return value
    return session_artifact(session, key)


def required_path(
    steps: list[dict],
    repo_root: Path,
    args: argparse.Namespace,
    session: dict,
    key: str,
) -> Optional[Path]:
    value = arg_or_session_artifact(args, session, key)
    path = resolve_repo_path(repo_root, value)
    if not path:
        steps.append(missing_artifact_step(key))
        return None
    if not path.exists():
        steps.append(
            {
                "name": f"final_harness_artifact:{key}",
                "status": "FAIL",
                "required": True,
                "cmd": [],
                "reason": f"artifact path does not exist: {key} -> {value}",
            }
        )
        return None
    return path


def maybe_node_test(name: str, repo_root: Path, relative_path: str, required: bool) -> Optional[dict]:
    path = repo_root / relative_path
    if not path.exists():
        return {
            "name": name,
            "status": "FAIL" if required else "SKIP",
            "required": required,
            "cmd": ["node", relative_path],
            "reason": f"missing test: {relative_path}",
        }
    return run_step(name, ["node", relative_path], repo_root, required=required)


def overlay_manifest_steps(repo_root: Path, source_root: Path) -> list[dict]:
    validator = source_root / "enterprise-discover" / "scripts" / "validate_overlay_manifest.py"
    manifests = sorted((repo_root / ".codex" / "repo-skills").glob("*-manifest.json"))
    if not manifests:
        return [
            {
                "name": "overlay_manifest",
                "status": "SKIP",
                "required": False,
                "cmd": [],
                "reason": "no repo-local overlay manifest found",
            }
        ]
    steps: list[dict] = []
    for manifest in manifests:
        if not validator.exists():
            steps.append(
                {
                    "name": f"overlay_manifest:{manifest.name}",
                    "status": "FAIL",
                    "required": True,
                    "cmd": ["python3", str(validator), "--repo-root", ".", "--manifest", str(manifest)],
                    "reason": "overlay manifest validator is missing",
                }
            )
            continue
        steps.append(
            run_step(
                f"overlay_manifest:{manifest.name}",
                [
                    "python3",
                    str(validator),
                    "--repo-root",
                    ".",
                    "--manifest",
                    str(manifest.relative_to(repo_root)),
                ],
                repo_root,
                required=True,
            )
        )
    return steps


def stage_gate_step(
    repo_root: Path,
    source_root: Path,
    stage: str,
    agent_id: Optional[str],
    session_root: Optional[str],
    expected_pr: Optional[str],
    expected_base_ref: Optional[str],
) -> Optional[dict]:
    if stage not in AGENT_STAGE_GATES:
        return None
    gate = source_root / "enterprise" / "scripts" / "agent_session.py"
    if not gate.exists():
        return {
            "name": f"agent_stage_gate:{stage}",
            "status": "FAIL",
            "required": True,
            "cmd": ["python3", str(gate), "check-stage", "--stage", stage],
            "reason": "agent_session.py is missing",
        }
    cmd = ["python3", str(gate), "check-stage", "--stage", stage]
    if agent_id:
        cmd.extend(["--agent-id", agent_id])
    if session_root:
        cmd.extend(["--session-root", session_root])
    if expected_pr:
        cmd.extend(["--expected-pr", expected_pr])
    if expected_base_ref:
        cmd.extend(["--expected-base-ref", expected_base_ref])
    return run_step(f"agent_stage_gate:{stage}", cmd, repo_root, required=True)


def is_quick_lane_boundary_step(step: Optional[dict]) -> bool:
    if not step or not step.get("name", "").startswith("agent_stage_gate:"):
        return False
    text = "\n".join(
        str(step.get(key, ""))
        for key in ("reason", "stdout", "stderr")
    )
    return QUICK_LANE_BOUNDARY_TEXT in text


def normalize_base_ref(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    text = str(value).strip()
    for prefix in ("refs/heads/", "origin/"):
        if text.startswith(prefix):
            return text[len(prefix) :]
    return text


def parsed_stage_gate_output(step: dict) -> dict:
    try:
        output = json.loads(str(step.get("stdout") or ""))
    except (TypeError, json.JSONDecodeError):
        return {}
    return output if isinstance(output, dict) else {}


def is_closeout_lane_step(step: Optional[dict], stage: str) -> bool:
    if stage not in CLOSEOUT_GATE_STAGES:
        return False
    if not step or not step.get("name", "").startswith("agent_stage_gate:"):
        return False
    output = parsed_stage_gate_output(step)
    return output.get("path_classification") in CLOSEOUT_PATH_CLASSIFICATIONS


def architecture_contract_steps(args: argparse.Namespace, repo_root: Path, source_root: Path) -> list[dict]:
    if args.stage not in ARCHITECTURE_CONTRACT_STAGES:
        return []

    validator = source_root / "enterprise" / "scripts" / "validate_architecture_contract.py"
    if not validator.exists():
        return [
            {
                "name": "architecture_contract",
                "status": "FAIL",
                "required": True,
                "cmd": ["python3", str(validator), "--artifact", "<build_packet>", "--repo-root", "."],
                "reason": "validate_architecture_contract.py is missing",
            }
        ]

    session, error_step = load_agent_session(repo_root, args)
    if error_step:
        error_step = dict(error_step)
        error_step["name"] = "architecture_contract_agent_session"
        return [error_step]
    assert session is not None

    artifact_value = arg_or_session_artifact(args, session, "build_packet") or arg_or_session_artifact(args, session, "contract")
    artifact_path = resolve_repo_path(repo_root, artifact_value)
    if not artifact_path:
        return [
            {
                "name": "architecture_contract",
                "status": "FAIL",
                "required": True,
                "cmd": ["python3", str(validator), "--artifact", "<build_packet>", "--repo-root", "."],
                "reason": "missing required architecture contract artifact: build_packet",
            }
        ]
    if not artifact_path.exists():
        return [
            {
                "name": "architecture_contract",
                "status": "FAIL",
                "required": True,
                "cmd": ["python3", str(validator), "--artifact", str(artifact_path), "--repo-root", "."],
                "reason": f"architecture contract artifact path does not exist: {artifact_value}",
            }
        ]

    return [
        run_step(
            "architecture_contract",
            [
                "python3",
                str(validator),
                "--repo-root",
                ".",
                "--artifact",
                str(artifact_path),
                "--json",
            ],
            repo_root,
            required=True,
        )
    ]


def containment_steps(args: argparse.Namespace, repo_root: Path, source_root: Path) -> list[dict]:
    if args.stage not in CONTAINMENT_STAGES:
        return []
    validator = source_root / "enterprise" / "scripts" / "validate_enterprise_containment.py"
    if not validator.exists():
        return [
            {
                "name": "enterprise_containment",
                "status": "FAIL",
                "required": True,
                "cmd": ["python3", str(validator), "--repo-root", ".", "--agent-id", args.agent_id or "<agent-id>"],
                "reason": "validate_enterprise_containment.py is missing",
            }
        ]
    cmd = [
        "python3",
        str(validator),
        "--repo-root",
        ".",
        "--base",
        args.base,
        "--head",
        args.head,
        "--json",
    ]
    if args.agent_id:
        cmd.extend(["--agent-id", args.agent_id])
    if args.session_root:
        cmd.extend(["--session-root", args.session_root])
    return [run_step("enterprise_containment", cmd, repo_root, required=True)]


def final_proof_steps(args: argparse.Namespace, repo_root: Path, source_root: Path) -> list[dict]:
    if args.stage not in FINAL_PROOF_STAGES:
        return []

    steps: list[dict] = []
    session, error_step = load_agent_session(repo_root, args)
    if error_step:
        return [error_step]
    assert session is not None

    harness_scripts = source_root / "enterprise-harness" / "scripts"
    enterprise_scripts = source_root / "enterprise" / "scripts"

    postconditions = required_path(steps, repo_root, args, session, "postconditions")
    verification = required_path(steps, repo_root, args, session, "verification")
    receipt_log = required_path(steps, repo_root, args, session, "receipt_log")

    if postconditions and verification and receipt_log:
        steps.append(
            run_step(
                "final_harness_check_pc_trace",
                [
                    "python3",
                    str(harness_scripts / "check_pc_trace.py"),
                    "--postconditions",
                    str(postconditions),
                    "--evidence",
                    str(verification),
                    "--repo-root",
                    ".",
                    "--receipt-log",
                    str(receipt_log),
                ],
                repo_root,
                required=True,
            )
        )
        steps.append(
            run_step(
                "final_harness_changed_file_proof_map",
                [
                    "python3",
                    str(harness_scripts / "changed_file_proof_map.py"),
                    "--repo-root",
                    ".",
                    "--base",
                    args.base,
                    "--head",
                    args.head,
                    "--evidence",
                    str(verification),
                    "--receipt-log",
                    str(receipt_log),
                ],
                repo_root,
                required=True,
            )
        )

    for key, artifact_type in (
        ("review", "review"),
        ("forge_report", "forge"),
        ("verification", "verification"),
        ("solution", "solution"),
    ):
        value = arg_or_session_artifact(args, session, key)
        if not value and key == "solution":
            continue
        path = required_path(steps, repo_root, args, session, key)
        if not path:
            continue
        steps.append(
            run_step(
                f"final_harness_validate_structured_proof:{artifact_type}",
                [
                    "python3",
                    str(harness_scripts / "validate_structured_proof.py"),
                    "--artifact",
                    str(path),
                    "--path",
                    repo_relative(repo_root, path),
                    "--json",
                ],
                repo_root,
                required=True,
            )
        )

    if verification:
        steps.append(
            run_step(
                "final_harness_validate_release_readiness",
                [
                    "python3",
                    str(harness_scripts / "validate_release_readiness.py"),
                    "--evidence",
                    str(verification),
                    "--json",
                ],
                repo_root,
                required=True,
            )
        )

    dispatch_root = arg_or_session_artifact(args, session, "dispatch_root")
    worker_artifact = arg_or_session_artifact(args, session, "worker_artifact")
    if dispatch_root or worker_artifact:
        cmd = [
            "python3",
            str(enterprise_scripts / "validate_worker_artifacts.py"),
            "--repo-root",
            ".",
            "--stage",
            args.stage,
            "--json",
        ]
        if dispatch_root:
            cmd.extend(["--dispatch-root", str(resolve_repo_path(repo_root, dispatch_root))])
        if worker_artifact:
            cmd.extend(["--artifact", str(resolve_repo_path(repo_root, worker_artifact))])
        steps.append(run_step("final_harness_validate_worker_artifacts", cmd, repo_root, required=True))

    if args.stage in {"pr-readiness", "merge"} and verification and receipt_log:
        cmd = [
            "python3",
            str(harness_scripts / "pr_readiness_gate.py"),
            "--evidence",
            str(verification),
            "--receipt-log",
            str(receipt_log),
        ]
        profile = repo_root / ".codex" / "enterprise-state" / "repo-profile.json"
        if profile.exists():
            cmd.extend(["--repo-profile", str(profile)])
        if args.pr:
            cmd.extend(["--pr", args.pr])
        steps.append(run_step("final_harness_pr_readiness_gate", cmd, repo_root, required=True))

    return steps


def collect_steps(args: argparse.Namespace) -> list[dict]:
    repo_root = repo_root_from(args.repo_root)
    source_root = enterprise_source_root(repo_root)
    using_global_source = source_root != (repo_root / "tools" / "enterprise-skills")
    repo_self_tests_required = not using_global_source
    steps: list[dict] = []

    steps.append(enterprise_precheck_step(repo_root, source_root))
    if args.stage == "start":
        steps.append(fresh_worktree_start_step(repo_root))

    steps.append(
        maybe_node_test(
            "skill_root_policy",
            repo_root,
            "scripts/check-skill-roots.cjs",
            required=repo_self_tests_required,
        )
    )
    steps.append(
        maybe_node_test(
            "enterprise_skill_reference_links",
            repo_root,
            "tests/enterprise-skill-reference-links.test.cjs",
            required=repo_self_tests_required,
        )
    )

    eval_validator = source_root / "enterprise" / "scripts" / "validate_evals.py"
    if eval_validator.exists():
        steps.append(
            run_step(
                "enterprise_eval_contracts",
                ["python3", str(eval_validator), "--root", str(source_root), "--json"],
                repo_root,
                required=True,
            )
        )
    else:
        steps.append(
            {
                "name": "enterprise_eval_contracts",
                "status": "FAIL",
                "required": True,
                "cmd": ["python3", str(eval_validator), "--root", str(source_root), "--json"],
                "reason": "validate_evals.py is missing",
            }
        )

    steps.extend(overlay_manifest_steps(repo_root, source_root))

    if (repo_root / "tests" / "enterprise-agent-session-build-packet.test.cjs").exists():
        result = maybe_node_test(
            "mechanical_build_packet_regression",
            repo_root,
            "tests/enterprise-agent-session-build-packet.test.cjs",
            required=True,
        )
        if result:
            steps.append(result)
    else:
        steps.append(
            {
                "name": "mechanical_build_packet_regression",
                "status": "SKIP",
                "required": False,
                "cmd": ["node", "tests/enterprise-agent-session-build-packet.test.cjs"],
                "reason": "repo has no build-packet regression test",
            }
        )

    if (repo_root / "tests" / "enterprise-architecture-contract-gate.test.cjs").exists():
        result = maybe_node_test(
            "architecture_contract_regression",
            repo_root,
            "tests/enterprise-architecture-contract-gate.test.cjs",
            required=True,
        )
        if result:
            steps.append(result)
    else:
        steps.append(
            {
                "name": "architecture_contract_regression",
                "status": "SKIP",
                "required": False,
                "cmd": ["node", "tests/enterprise-architecture-contract-gate.test.cjs"],
                "reason": "repo has no architecture-contract regression test",
            }
        )

    if (repo_root / "tests" / "enterprise-containment-gate.test.cjs").exists():
        result = maybe_node_test(
            "enterprise_containment_regression",
            repo_root,
            "tests/enterprise-containment-gate.test.cjs",
            required=True,
        )
        if result:
            steps.append(result)
    else:
        steps.append(
            {
                "name": "enterprise_containment_regression",
                "status": "SKIP",
                "required": False,
                "cmd": ["node", "tests/enterprise-containment-gate.test.cjs"],
                "reason": "repo has no enterprise containment regression test",
            }
        )

    if (repo_root / "tests" / "enterprise-pr-body-generator.test.cjs").exists():
        result = maybe_node_test(
            "enterprise_pr_body_generator_regression",
            repo_root,
            "tests/enterprise-pr-body-generator.test.cjs",
            required=True,
        )
        if result:
            steps.append(result)
    else:
        steps.append(
            {
                "name": "enterprise_pr_body_generator_regression",
                "status": "SKIP",
                "required": False,
                "cmd": ["node", "tests/enterprise-pr-body-generator.test.cjs"],
                "reason": "repo has no enterprise PR body generator regression test",
            }
        )

    if (repo_root / "tests" / "enterprise-wrapper-instructions.test.cjs").exists():
        result = maybe_node_test(
            "enterprise_wrapper_instructions_regression",
            repo_root,
            "tests/enterprise-wrapper-instructions.test.cjs",
            required=True,
        )
        if result:
            steps.append(result)
    else:
        steps.append(
            {
                "name": "enterprise_wrapper_instructions_regression",
                "status": "SKIP",
                "required": False,
                "cmd": ["node", "tests/enterprise-wrapper-instructions.test.cjs"],
                "reason": "repo has no enterprise wrapper-instructions regression test",
            }
        )

    global_fallback_wrappers_available = all(
        [
            command_available("enterprise-precheck", "ENTERPRISE_PRECHECK_BIN"),
            command_available("enterprise-required-gates", "ENTERPRISE_REQUIRED_GATES_BIN"),
            command_available("enterprise-agent-session", "ENTERPRISE_AGENT_SESSION_BIN"),
            command_available("enterprise-containment", "ENTERPRISE_CONTAINMENT_BIN"),
            command_available("enterprise-hook", "ENTERPRISE_HOOK_BIN"),
        ]
    )
    if (repo_root / "tests" / "enterprise-global-tooling-fallback.test.cjs").exists() and global_fallback_wrappers_available:
        result = maybe_node_test(
            "enterprise_global_tooling_fallback_regression",
            repo_root,
            "tests/enterprise-global-tooling-fallback.test.cjs",
            required=True,
        )
        if result:
            steps.append(result)
    else:
        steps.append(
            {
                "name": "enterprise_global_tooling_fallback_regression",
                "status": "SKIP",
                "required": False,
                "cmd": ["node", "tests/enterprise-global-tooling-fallback.test.cjs"],
                "reason": "repo has no enterprise global-tooling fallback regression test or required global wrappers are unavailable",
            }
        )

    stage_step = stage_gate_step(
        repo_root,
        source_root,
        args.stage,
        args.agent_id,
        args.session_root,
        args.pr,
        normalize_base_ref(args.base),
    )
    if stage_step:
        steps.append(stage_step)
        if is_quick_lane_boundary_step(stage_step) or is_closeout_lane_step(stage_step, args.stage):
            return steps
    steps.extend(containment_steps(args, repo_root, source_root))
    steps.extend(architecture_contract_steps(args, repo_root, source_root))
    steps.extend(final_proof_steps(args, repo_root, source_root))

    return steps


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Run the required enterprise self-checks from the $enterprise workflow."
    )
    parser.add_argument(
        "--stage",
        required=True,
        choices=sorted(AGENT_STAGE_GATES | {"start"}),
        help="Enterprise stage being entered or checked.",
    )
    parser.add_argument("--agent-id", help="Agent session id used by agent_session.py gates.")
    parser.add_argument("--session-root", default=".codex/enterprise-state/agent-sessions")
    parser.add_argument("--repo-root", help="Repository root. Defaults to current git root.")
    parser.add_argument("--postconditions", help="Postcondition registry path for final proof stages.")
    parser.add_argument("--verification", help="Verification evidence/report path for final proof stages.")
    parser.add_argument("--receipt-log", help="Command receipt JSONL path for final proof stages.")
    parser.add_argument("--review", help="Review artifact path for final proof stages.")
    parser.add_argument("--forge-report", help="Forge artifact path for final proof stages.")
    parser.add_argument("--solution", help="Solution/compound artifact path for final proof stages.")
    parser.add_argument("--dispatch-root", help="Delegated worker dispatch root for final proof stages.")
    parser.add_argument("--worker-artifact", help="Delegated worker result artifact for final proof stages.")
    parser.add_argument("--pr", help="PR number or URL for PR readiness/merge stages.")
    parser.add_argument("--base", default="origin/dev", help="Base ref for changed-file proof mapping.")
    parser.add_argument("--head", default="HEAD", help="Head ref for changed-file proof mapping.")
    parser.add_argument("--json", action="store_true", help="Emit compact JSON only.")
    args = parser.parse_args()

    repo_root = repo_root_from(args.repo_root)
    steps = collect_steps(args)
    failed = [step for step in steps if step["status"] == "FAIL"]
    result = {
        "ok": not failed,
        "stage": args.stage,
        "repo_root": str(repo_root),
        "steps": steps,
    }

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(f"ENTERPRISE REQUIRED GATES — stage={args.stage} — {'PASS' if result['ok'] else 'FAIL'}")
        for step in steps:
            print(f"{step['status']:>4} {step['name']}")
            if step["status"] == "FAIL":
                detail = step.get("stderr") or step.get("stdout") or step.get("reason", "")
                if detail:
                    print(detail)
        if not result["ok"]:
            print(json.dumps(result, indent=2))

    return 0 if result["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
