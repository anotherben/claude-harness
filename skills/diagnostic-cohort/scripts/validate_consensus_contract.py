#!/usr/bin/env python3
"""Validate a diagnostic cohort consensus contract."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


EXPECTED_SCHEMA_VERSION = "diagnostic_cohort.consensus_contract.v1"
VALID_DECISIONS = {"approved", "blocked", "pending", "needs_revision"}
VALID_REVIEWER_STATUS = {"pending", "approved", "blocked", "needs_revision"}
VALID_ROOT_CAUSE_STATUS = {"confirmed", "blocked", "disputed", "not_applicable"}


def non_empty_string(value: Any) -> bool:
    return isinstance(value, str) and value.strip() != ""


def non_empty_list(value: Any) -> bool:
    return isinstance(value, list) and len(value) > 0


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def load_json(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        raise ValueError(f"{path}: invalid JSON: {exc}") from exc
    if not isinstance(data, dict):
        raise ValueError(f"{path}: contract must be a JSON object")
    return data


def validate_fix_eval(item: Any, index: int, errors: list[str]) -> None:
    prefix = f"fix_evals[{index}]"
    require(isinstance(item, dict), f"{prefix}: must be object", errors)
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
        require(non_empty_string(item.get(key)), f"{prefix}.{key} must be non-empty", errors)
    require("command" in item, f"{prefix}.command missing", errors)


def validate_reviewer(item: Any, index: int, errors: list[str]) -> None:
    prefix = f"reviewers[{index}]"
    require(isinstance(item, dict), f"{prefix}: must be object", errors)
    if not isinstance(item, dict):
        return
    for key in ("role", "required", "one_job", "status", "evidence_refs", "blocking_findings"):
        require(key in item, f"{prefix}.{key} missing", errors)
    require(non_empty_string(item.get("role")), f"{prefix}.role must be non-empty", errors)
    require(item.get("required") in {True, False}, f"{prefix}.required must be boolean", errors)
    require(non_empty_string(item.get("one_job")), f"{prefix}.one_job must be non-empty", errors)
    require(item.get("status") in VALID_REVIEWER_STATUS, f"{prefix}.status invalid", errors)
    require(isinstance(item.get("evidence_refs"), list), f"{prefix}.evidence_refs must be list", errors)
    require(isinstance(item.get("blocking_findings"), list), f"{prefix}.blocking_findings must be list", errors)


def validate_contract(contract: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    required = (
        "schema_version",
        "artifact_type",
        "contract_id",
        "created_at",
        "target",
        "objective",
        "root_cause_confirmation",
        "fix_evals",
        "orchestration",
        "reviewers",
        "loop_control",
        "consensus",
        "validator",
    )
    for key in required:
        require(key in contract, f"missing top-level field: {key}", errors)

    require(contract.get("schema_version") == EXPECTED_SCHEMA_VERSION, "schema_version invalid", errors)
    require(contract.get("artifact_type") == "consensus_contract", "artifact_type must be consensus_contract", errors)
    require(non_empty_string(contract.get("contract_id")), "contract_id must be non-empty", errors)
    require(non_empty_string(contract.get("created_at")), "created_at must be non-empty", errors)

    target = contract.get("target")
    require(isinstance(target, dict), "target must be object", errors)
    if isinstance(target, dict):
        for key in ("kind", "path_or_url", "source"):
            require(non_empty_string(target.get(key)), f"target.{key} must be non-empty", errors)
        require("repo_root" in target, "target.repo_root missing", errors)
        require("branch" in target, "target.branch missing", errors)
        require("head_sha" in target, "target.head_sha missing", errors)

    objective = contract.get("objective")
    require(isinstance(objective, dict), "objective must be object", errors)
    if isinstance(objective, dict):
        require(non_empty_string(objective.get("summary")), "objective.summary must be non-empty", errors)
        require(non_empty_list(objective.get("success_criteria")), "objective.success_criteria must be non-empty", errors)
        require(isinstance(objective.get("non_goals"), list), "objective.non_goals must be list", errors)

    root = contract.get("root_cause_confirmation")
    require(isinstance(root, dict), "root_cause_confirmation must be object", errors)
    if isinstance(root, dict):
        require(root.get("status") in VALID_ROOT_CAUSE_STATUS, "root_cause_confirmation.status invalid", errors)
        require(isinstance(root.get("agreed_chain_refs"), list), "root_cause_confirmation.agreed_chain_refs must be list", errors)
        require(isinstance(root.get("rejected_hypotheses"), list), "root_cause_confirmation.rejected_hypotheses must be list", errors)
        require(isinstance(root.get("remaining_uncertainty"), list), "root_cause_confirmation.remaining_uncertainty must be list", errors)

    fix_evals = contract.get("fix_evals")
    require(non_empty_list(fix_evals), "fix_evals must be non-empty", errors)
    if isinstance(fix_evals, list):
        for index, item in enumerate(fix_evals):
            validate_fix_eval(item, index, errors)

    orchestration = contract.get("orchestration")
    require(isinstance(orchestration, dict), "orchestration must be object", errors)
    if isinstance(orchestration, dict):
        require(non_empty_string(orchestration.get("mode")), "orchestration.mode must be non-empty", errors)
        prompt = orchestration.get("pasteable_goal_prompt")
        require(non_empty_string(prompt), "orchestration.pasteable_goal_prompt must be non-empty", errors)
        if isinstance(prompt, str):
            require("/goal" in prompt, "orchestration.pasteable_goal_prompt must contain /goal", errors)
        require(non_empty_string(orchestration.get("lead_owner")), "orchestration.lead_owner must be non-empty", errors)
        require(isinstance(orchestration.get("active_limit"), int), "orchestration.active_limit must be integer", errors)
        if isinstance(orchestration.get("active_limit"), int):
            require(1 <= orchestration.get("active_limit") <= 3, "orchestration.active_limit must be 1..3", errors)

    reviewers = contract.get("reviewers")
    require(non_empty_list(reviewers), "reviewers must be non-empty", errors)
    if isinstance(reviewers, list):
        for index, item in enumerate(reviewers):
            validate_reviewer(item, index, errors)

    loop = contract.get("loop_control")
    require(isinstance(loop, dict), "loop_control must be object", errors)
    if isinstance(loop, dict):
        current_round = loop.get("current_round")
        max_rounds = loop.get("max_rounds")
        require(isinstance(current_round, int) and current_round >= 0, "loop_control.current_round must be non-negative integer", errors)
        require(isinstance(max_rounds, int) and 1 <= max_rounds <= 3, "loop_control.max_rounds must be 1..3", errors)
        if isinstance(current_round, int) and isinstance(max_rounds, int):
            require(current_round <= max_rounds, "loop_control.current_round cannot exceed max_rounds", errors)
        require(non_empty_string(loop.get("stop_gate")), "loop_control.stop_gate must be non-empty", errors)
        require(loop.get("block_on_repeated_blocker") is True, "loop_control.block_on_repeated_blocker must be true", errors)
        require(loop.get("material_revision_required") is True, "loop_control.material_revision_required must be true", errors)

    consensus = contract.get("consensus")
    require(isinstance(consensus, dict), "consensus must be object", errors)
    decision = None
    if isinstance(consensus, dict):
        decision = consensus.get("decision")
        require(decision in VALID_DECISIONS, "consensus.decision invalid", errors)
        for key in ("agreed_issue", "agreed_root_cause", "agreed_resolution"):
            require(non_empty_string(consensus.get(key)) or decision != "approved", f"consensus.{key} must be non-empty when approved", errors)
        require(isinstance(consensus.get("required_approvals"), list), "consensus.required_approvals must be list", errors)
        require(isinstance(consensus.get("unresolved_blockers"), list), "consensus.unresolved_blockers must be list", errors)
        require(isinstance(consensus.get("revision_required"), list), "consensus.revision_required must be list", errors)

    if decision == "approved":
        if isinstance(root, dict):
            require(root.get("status") == "confirmed", "approved consensus requires confirmed root cause", errors)
        if isinstance(reviewers, list):
            required_roles = [
                item.get("role")
                for item in reviewers
                if isinstance(item, dict) and item.get("required") is True and non_empty_string(item.get("role"))
            ]
            for item in reviewers:
                if isinstance(item, dict) and item.get("required") is True:
                    require(item.get("status") == "approved", f"required reviewer {item.get('role')} is not approved", errors)
        if isinstance(consensus, dict):
            require(not consensus.get("unresolved_blockers"), "approved consensus cannot have unresolved_blockers", errors)
            approvals = consensus.get("required_approvals")
            if isinstance(approvals, list):
                missing = [role for role in required_roles if role not in approvals]
                extra = [role for role in approvals if role not in required_roles]
                require(not missing, "consensus.required_approvals missing required reviewers: " + ", ".join(missing), errors)
                require(not extra, "consensus.required_approvals names non-required reviewers: " + ", ".join(map(str, extra)), errors)

    if isinstance(orchestration, dict) and isinstance(orchestration.get("pasteable_goal_prompt"), str) and isinstance(fix_evals, list):
        prompt = orchestration.get("pasteable_goal_prompt")
        eval_ids = [
            item.get("id")
            for item in fix_evals
            if isinstance(item, dict) and non_empty_string(item.get("id"))
        ]
        missing_eval_refs = [eval_id for eval_id in eval_ids if eval_id not in prompt]
        require(not missing_eval_refs, "orchestration.pasteable_goal_prompt must mention fix eval ids: " + ", ".join(missing_eval_refs), errors)

    validator = contract.get("validator")
    require(isinstance(validator, dict), "validator must be object", errors)
    if isinstance(validator, dict):
        require(non_empty_string(validator.get("command")), "validator.command must be non-empty", errors)
        require(validator.get("required") is True, "validator.required must be true", errors)

    return errors


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate diagnostic cohort consensus contract.")
    parser.add_argument("contract", type=Path)
    args = parser.parse_args()

    try:
        contract = load_json(args.contract)
    except ValueError as exc:
        print(f"FAIL: {exc}", file=sys.stderr)
        return 1

    errors = validate_contract(contract)
    if errors:
        for error in errors:
            print(f"FAIL: {error}", file=sys.stderr)
        return 1

    print(f"PASS: {args.contract}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
