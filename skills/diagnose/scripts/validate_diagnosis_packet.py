#!/usr/bin/env python3
"""Validate a diagnose build packet for build-agent handoff quality."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any


EXPECTED_SCHEMA_VERSION = "diagnose.build_packet.v1"
VALID_STATUSES = {
    "blocked",
    "repro_ready",
    "root_cause_ready",
    "build_ready",
    "fixed_pending_verify",
}
IMPLEMENTATION_SUFFIXES = {
    ".js",
    ".jsx",
    ".ts",
    ".tsx",
    ".cjs",
    ".mjs",
    ".sql",
    ".py",
    ".sh",
    ".json",
    ".toml",
    ".yaml",
    ".yml",
    ".md",
}
IMPLEMENTATION_PATH_MARKERS = (
    "/src/",
    "/database/",
    "/migrations/",
    "/routes/",
    "/services/",
    "/domains/",
    "/jobs/",
    "/workers/",
    "/__tests__/",
    "/tests/",
    "/docs/",
)


class ValidationError(Exception):
    pass


def load_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as handle:
            data = json.load(handle)
    except json.JSONDecodeError as exc:
        raise ValidationError(f"{path}: invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValidationError(f"{path}: packet must be a JSON object")
    return data


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def non_empty_list(value: Any) -> bool:
    return isinstance(value, list) and len(value) > 0


def validate_task(task: Any, prefix: str, errors: list[str]) -> None:
    require(isinstance(task, dict), f"{prefix}: task must be object", errors)
    if not isinstance(task, dict):
        return
    for key in ("id", "description", "files"):
        require(key in task, f"{prefix}: missing {key}", errors)
    require(non_empty_string(task.get("id")), f"{prefix}: id must be non-empty", errors)
    require(non_empty_string(task.get("description")), f"{prefix}: description must be non-empty", errors)
    require(non_empty_list(task.get("files")), f"{prefix}: files must be non-empty", errors)


def validate_build_task(task: Any, index: int, errors: list[str]) -> None:
    prefix = f"build_plan[{index}]"
    validate_task(task, prefix, errors)
    if not isinstance(task, dict):
        return
    for key in ("owner_role", "dependencies", "acceptance_criteria", "verification", "stop_rule"):
        require(key in task, f"{prefix}: missing {key}", errors)
    require(non_empty_string(task.get("owner_role")), f"{prefix}: owner_role must be non-empty", errors)
    require(isinstance(task.get("dependencies"), list), f"{prefix}: dependencies must be list", errors)
    require(non_empty_list(task.get("acceptance_criteria")), f"{prefix}: acceptance_criteria must be non-empty", errors)
    require(non_empty_list(task.get("verification")), f"{prefix}: verification must be non-empty", errors)
    require(non_empty_string(task.get("stop_rule")), f"{prefix}: stop_rule must be non-empty", errors)


def validate_subagent_task(task: Any, index: int, errors: list[str]) -> None:
    prefix = f"subagent_tasks[{index}]"
    require(isinstance(task, dict), f"{prefix}: subagent task must be object", errors)
    if not isinstance(task, dict):
        return
    for key in ("id", "role", "one_job", "scope", "inputs", "outputs", "forbidden"):
        require(key in task, f"{prefix}: missing {key}", errors)
    require(non_empty_string(task.get("role")), f"{prefix}: role must be non-empty", errors)
    require(non_empty_string(task.get("one_job")), f"{prefix}: one_job must be non-empty", errors)
    require(non_empty_list(task.get("scope")), f"{prefix}: scope must be non-empty", errors)
    require(non_empty_list(task.get("outputs")), f"{prefix}: outputs must be non-empty", errors)
    forbidden = task.get("forbidden")
    require(isinstance(forbidden, list), f"{prefix}: forbidden must be list", errors)
    if isinstance(forbidden, list):
        joined = " ".join(str(item).lower() for item in forbidden)
        require(
            "edit" in joined
            or "implement" in joined
            or "mutat" in joined
            or "code change" in joined
            or "code changes" in joined,
            f"{prefix}: forbidden should explicitly block edits/implementation/mutation/code changes",
            errors,
        )


def validate_fix_eval(item: Any, index: int, errors: list[str]) -> None:
    prefix = f"fix_evals[{index}]"
    require(isinstance(item, dict), f"{prefix}: fix eval must be object", errors)
    if not isinstance(item, dict):
        return
    for key in (
        "id",
        "purpose",
        "proof_type",
        "expected_failure_before_fix",
        "expected_pass_after_fix",
        "freshness_subject",
        "required_before",
    ):
        require(non_empty_string(item.get(key)), f"{prefix}: {key} must be non-empty", errors)
    require("command" in item, f"{prefix}: missing command", errors)


def validate_packet(packet: dict[str, Any], diagnosis_only: bool) -> list[str]:
    errors: list[str] = []
    required = (
        "schema_version",
        "packet_id",
        "created_at",
        "repo_root",
        "head_sha",
        "branch",
        "source_issue_or_pr",
        "original_prompt",
        "diagnosis_status",
        "root_cause_chain",
        "ownership",
        "srp_refactor",
        "domain_refactor",
        "seam",
        "write_leak_impact",
        "recent_trap_replay",
        "evidence_freshness",
        "sibling_search",
        "ratchets",
        "root_cause_confirmation",
        "consensus_review",
        "fix_evals",
        "goal_prompt",
        "build_plan",
        "subagent_tasks",
        "verification_plan",
        "blockers",
        "assumptions",
        "open_questions",
        "do_not_do",
    )
    for key in required:
        require(key in packet, f"missing top-level field: {key}", errors)

    require(packet.get("schema_version") == EXPECTED_SCHEMA_VERSION, "schema_version must be diagnose.build_packet.v1", errors)
    status = packet.get("diagnosis_status")
    require(status in VALID_STATUSES, f"diagnosis_status must be one of {sorted(VALID_STATUSES)}", errors)
    if diagnosis_only:
        require(status != "fixed_pending_verify", "diagnosis-only packet must not be fixed_pending_verify", errors)

    require(non_empty_string(packet.get("packet_id")), "packet_id must be non-empty", errors)
    require(non_empty_string(packet.get("repo_root")), "repo_root must be non-empty", errors)
    require(non_empty_string(packet.get("original_prompt")), "original_prompt must be non-empty", errors)

    source = packet.get("source_issue_or_pr")
    require(isinstance(source, dict), "source_issue_or_pr must be object", errors)
    if isinstance(source, dict):
        require(source.get("type") in {"issue", "pr", "incident", "manual", "unknown"}, "source_issue_or_pr.type invalid", errors)
        require("id" in source, "source_issue_or_pr.id missing", errors)
        require("url" in source, "source_issue_or_pr.url missing", errors)
        require("title" in source, "source_issue_or_pr.title missing", errors)

    root_chain = packet.get("root_cause_chain")
    require(non_empty_list(root_chain), "root_cause_chain must be non-empty", errors)
    if isinstance(root_chain, list):
        require(len(root_chain) >= 3 or status == "blocked", "root_cause_chain should include symptom, cause, and root cause", errors)

    ownership = packet.get("ownership")
    require(isinstance(ownership, dict), "ownership must be object", errors)
    if isinstance(ownership, dict):
        require(non_empty_string(ownership.get("owner")), "ownership.owner must be non-empty", errors)
        require(non_empty_string(ownership.get("source_of_truth")), "ownership.source_of_truth must be non-empty", errors)
        require(isinstance(ownership.get("consumers"), list), "ownership.consumers must be list", errors)
        require(isinstance(ownership.get("wrong_owners"), list), "ownership.wrong_owners must be list", errors)

    for section in ("srp_refactor",):
        value = packet.get(section)
        require(isinstance(value, dict), f"{section} must be object", errors)
        if isinstance(value, dict):
            for bucket in ("fix_now", "follow_up", "note_only"):
                require(isinstance(value.get(bucket), list), f"{section}.{bucket} must be list", errors)
            total = sum(len(value.get(bucket, [])) for bucket in ("fix_now", "follow_up", "note_only") if isinstance(value.get(bucket), list))
            require(total > 0 or status == "blocked", f"{section} must classify at least one item", errors)

    domain = packet.get("domain_refactor")
    require(isinstance(domain, dict), "domain_refactor must be object", errors)
    if isinstance(domain, dict):
        require(non_empty_string(domain.get("decision")), "domain_refactor.decision must be non-empty", errors)
        require(isinstance(domain.get("fix_now"), list), "domain_refactor.fix_now must be list", errors)
        require(isinstance(domain.get("follow_up"), list), "domain_refactor.follow_up must be list", errors)

    seam = packet.get("seam")
    require(isinstance(seam, dict), "seam must be object", errors)
    if isinstance(seam, dict):
        seam_known = non_empty_string(seam.get("correct_seam")) or non_empty_list(seam.get("missing_seam_findings"))
        require(seam_known, "seam.correct_seam or seam.missing_seam_findings must be populated", errors)
        require(isinstance(seam.get("regression_test"), dict), "seam.regression_test must be object", errors)

    impact = packet.get("write_leak_impact")
    require(isinstance(impact, dict), "write_leak_impact must be object", errors)
    if isinstance(impact, dict):
        for key in ("direct_writes", "transitive_writes", "external_side_effects", "leak_paths", "retries_jobs_events"):
            require(isinstance(impact.get(key), list), f"write_leak_impact.{key} must be list", errors)
        populated = sum(len(impact.get(key, [])) for key in ("direct_writes", "transitive_writes", "external_side_effects", "leak_paths", "retries_jobs_events") if isinstance(impact.get(key), list))
        require(populated > 0 or status == "blocked", "write_leak_impact must include at least one impact item", errors)

    require(isinstance(packet.get("recent_trap_replay"), list), "recent_trap_replay must be list", errors)
    require(isinstance(packet.get("sibling_search"), list), "sibling_search must be list", errors)
    require(isinstance(packet.get("ratchets"), list), "ratchets must be list", errors)

    root_confirmation = packet.get("root_cause_confirmation")
    require(isinstance(root_confirmation, dict), "root_cause_confirmation must be object", errors)
    if isinstance(root_confirmation, dict):
        require(isinstance(root_confirmation.get("confirmed"), bool), "root_cause_confirmation.confirmed must be boolean", errors)
        require(isinstance(root_confirmation.get("decisive_evidence"), list), "root_cause_confirmation.decisive_evidence must be list", errors)
        require(isinstance(root_confirmation.get("rejected_hypotheses"), list), "root_cause_confirmation.rejected_hypotheses must be list", errors)
        require(isinstance(root_confirmation.get("remaining_uncertainty"), list), "root_cause_confirmation.remaining_uncertainty must be list", errors)
        require(
            isinstance(root_confirmation.get("confirmed_before_build_plan"), bool),
            "root_cause_confirmation.confirmed_before_build_plan must be boolean",
            errors,
        )
        if status in {"root_cause_ready", "build_ready"}:
            require(root_confirmation.get("confirmed") is True, f"{status} requires confirmed root cause", errors)
            require(
                root_confirmation.get("confirmed_before_build_plan") is True,
                f"{status} requires root cause confirmation before build plan",
                errors,
            )
            require(
                non_empty_list(root_confirmation.get("decisive_evidence")),
                f"{status} requires root_cause_confirmation.decisive_evidence",
                errors,
            )

    consensus = packet.get("consensus_review")
    require(isinstance(consensus, dict), "consensus_review must be object", errors)
    if isinstance(consensus, dict):
        agreement = consensus.get("agreement_status")
        require(
            agreement in {"agreed", "blocked", "disputed", "solo_low_risk"},
            "consensus_review.agreement_status invalid",
            errors,
        )
        require("contract_path_or_id" in consensus, "consensus_review.contract_path_or_id missing", errors)
        require(isinstance(consensus.get("rounds"), list), "consensus_review.rounds must be list", errors)
        require(isinstance(consensus.get("participants"), list), "consensus_review.participants must be list", errors)
        require("agreed_issue" in consensus, "consensus_review.agreed_issue missing", errors)
        require("agreed_root_cause" in consensus, "consensus_review.agreed_root_cause missing", errors)
        require("agreed_resolution" in consensus, "consensus_review.agreed_resolution missing", errors)
        require(isinstance(consensus.get("dissent"), list), "consensus_review.dissent must be list", errors)
        require(non_empty_string(consensus.get("stop_reason")), "consensus_review.stop_reason must be non-empty", errors)
        if agreement in {"blocked", "disputed"} and status not in {"blocked", "repro_ready", "root_cause_ready"}:
            require(False, f"{status} cannot have {agreement} consensus", errors)
        if status == "build_ready":
            require(agreement == "agreed", "build_ready requires consensus_review.agreement_status agreed", errors)
            require(non_empty_list(consensus.get("rounds")), "build_ready requires consensus_review.rounds", errors)
            require(non_empty_list(consensus.get("participants")), "build_ready requires consensus_review.participants", errors)
            for key in ("agreed_issue", "agreed_root_cause", "agreed_resolution"):
                require(non_empty_string(consensus.get(key)), f"build_ready requires consensus_review.{key}", errors)

    fix_evals = packet.get("fix_evals")
    require(isinstance(fix_evals, list), "fix_evals must be list", errors)
    if isinstance(fix_evals, list):
        for index, item in enumerate(fix_evals):
            validate_fix_eval(item, index, errors)
    if status == "build_ready":
        require(non_empty_list(fix_evals), "build_ready requires fix_evals", errors)

    fix_eval_items = fix_evals if isinstance(fix_evals, list) else []
    eval_ids = {
        item.get("id")
        for item in fix_eval_items
        if isinstance(item, dict) and non_empty_string(item.get("id"))
    }
    goal_prompt = packet.get("goal_prompt")
    require(isinstance(goal_prompt, dict), "goal_prompt must be object", errors)
    if isinstance(goal_prompt, dict):
        pasteable = goal_prompt.get("pasteable_text")
        require("pasteable_text" in goal_prompt, "goal_prompt.pasteable_text missing", errors)
        require(isinstance(goal_prompt.get("must_pass_evals"), list), "goal_prompt.must_pass_evals must be list", errors)
        require(isinstance(goal_prompt.get("scope_limits"), list), "goal_prompt.scope_limits must be list", errors)
        require(isinstance(goal_prompt.get("do_not_do"), list), "goal_prompt.do_not_do must be list", errors)
        if status == "build_ready":
            require(non_empty_string(pasteable), "build_ready requires goal_prompt.pasteable_text", errors)
            if isinstance(pasteable, str):
                require("/goal" in pasteable, "build_ready goal_prompt.pasteable_text must contain /goal", errors)
            must_pass = goal_prompt.get("must_pass_evals")
            require(non_empty_list(must_pass), "build_ready requires goal_prompt.must_pass_evals", errors)
            if isinstance(must_pass, list):
                missing = [item for item in must_pass if item not in eval_ids]
                require(not missing, "goal_prompt.must_pass_evals must reference fix_evals ids: " + ", ".join(map(str, missing)), errors)
                if isinstance(pasteable, str):
                    absent = [item for item in must_pass if isinstance(item, str) and item not in pasteable]
                    require(not absent, "goal_prompt.pasteable_text must mention required eval ids: " + ", ".join(absent), errors)

    require(non_empty_list(packet.get("build_plan")) or status == "blocked", "build_plan must be non-empty for non-blocked packets", errors)
    require(non_empty_list(packet.get("subagent_tasks")) or status == "blocked", "subagent_tasks must be non-empty for non-blocked packets", errors)
    require(non_empty_list(packet.get("verification_plan")) or status == "blocked", "verification_plan must be non-empty for non-blocked packets", errors)

    for index, task in enumerate(packet.get("build_plan", []) if isinstance(packet.get("build_plan"), list) else []):
        validate_build_task(task, index, errors)
    for index, task in enumerate(packet.get("subagent_tasks", []) if isinstance(packet.get("subagent_tasks"), list) else []):
        validate_subagent_task(task, index, errors)

    do_not_do = packet.get("do_not_do")
    require(isinstance(do_not_do, list), "do_not_do must be list", errors)
    if isinstance(do_not_do, list):
        joined = " ".join(str(item).lower() for item in do_not_do)
        require(
            "edit" in joined
            or "implement" in joined
            or "mutat" in joined
            or "code change" in joined
            or "code changes" in joined,
            "do_not_do must explicitly block implementation/editing/code changes during diagnosis",
            errors,
        )

    return errors


def changed_files_from_git(worktree: Path) -> list[str]:
    try:
        output = subprocess.check_output(
            ["git", "-C", str(worktree), "status", "--short"],
            text=True,
            stderr=subprocess.STDOUT,
        )
    except (FileNotFoundError, subprocess.CalledProcessError) as exc:
        raise ValidationError(f"could not read git status for {worktree}: {exc}")
    files: list[str] = []
    for line in output.splitlines():
        if not line.strip():
            continue
        path = line[3:].strip()
        if " -> " in path:
            path = path.split(" -> ", 1)[1].strip()
        files.append(path)
    return files


def implementation_like(path: str) -> bool:
    normalized = "/" + path.replace("\\", "/")
    if normalized.startswith("/.codex/diagnose/") or normalized.startswith("/.codex/tmp/"):
        return False
    return Path(path).suffix in IMPLEMENTATION_SUFFIXES and any(marker in normalized for marker in IMPLEMENTATION_PATH_MARKERS)


def validate_changed_files(changed_files: list[str], errors: list[str]) -> None:
    offenders = [path for path in changed_files if implementation_like(path)]
    if offenders:
        errors.append(
            "diagnosis-only run changed implementation/proof files: "
            + ", ".join(offenders[:20])
            + (" ..." if len(offenders) > 20 else "")
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate diagnose JSON build packet.")
    parser.add_argument("packet", type=Path)
    parser.add_argument("--diagnosis-only", action="store_true", help="Reject fixed_pending_verify and implementation edits.")
    parser.add_argument("--git-worktree", type=Path, help="Check working tree has no implementation edits.")
    parser.add_argument("--changed-file", action="append", default=[], help="Changed file path to check; repeatable.")
    args = parser.parse_args()

    errors: list[str] = []
    try:
        packet = load_json(args.packet)
        errors.extend(validate_packet(packet, args.diagnosis_only))
        changed = list(args.changed_file)
        if args.git_worktree:
            changed.extend(changed_files_from_git(args.git_worktree))
        if args.diagnosis_only:
            validate_changed_files(changed, errors)
    except ValidationError as exc:
        errors.append(str(exc))

    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1

    print(f"PASS: {args.packet}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
