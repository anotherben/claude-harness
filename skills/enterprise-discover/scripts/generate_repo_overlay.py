#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional


GENERATOR_VERSION = "2026-05-03-goal-intake-v1"

STAGES = [
    ("", "Enterprise", "workflow decisions"),
    ("discover", "Discover", "repo discovery and portability refresh"),
    ("brainstorm", "Brainstorm", "design discovery"),
    ("stack-review", "Stack Review", "technology decision locking"),
    ("plan", "Plan", "implementation planning"),
    ("contract", "Contract", "contract locking"),
    ("build", "Build", "implementation"),
    ("review", "Review", "structured review"),
    ("pr-review", "PR Review", "PR conversation closeout and failed-review learning"),
    ("forge", "Forge", "adversarial probing"),
    ("verify", "Verify", "fresh verification"),
    ("harness", "Harness", "final ship gating"),
    ("compound", "Compound", "knowledge capture"),
    ("debug", "Debug", "root-cause debugging"),
]


def sha256_file(path: Path) -> Optional[str]:
    if not path.is_file():
        return None
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def sha256_tree(path: Path) -> Optional[str]:
    if not path.exists():
        return None
    digest = hashlib.sha256()
    files = sorted(p for p in path.rglob("*") if p.is_file() and "__pycache__" not in p.parts)
    for file_path in files:
        digest.update(str(file_path.relative_to(path)).encode("utf-8"))
        digest.update(b"\0")
        digest.update(file_path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def enterprise_skills_root() -> Path:
    return Path(__file__).resolve().parents[2]


def generic_source_hashes() -> dict[str, Optional[str]]:
    root = enterprise_skills_root()
    hashes: dict[str, Optional[str]] = {
        "generator": sha256_file(Path(__file__).resolve()),
        "validate_overlay_manifest": sha256_file(root / "enterprise-discover" / "scripts" / "validate_overlay_manifest.py"),
        "validate_evals": sha256_file(root / "enterprise" / "scripts" / "validate_evals.py"),
        "enterprise_required_gates": sha256_file(root / "enterprise" / "scripts" / "enterprise_required_gates.py"),
        "validate_architecture_contract": sha256_file(root / "enterprise" / "scripts" / "validate_architecture_contract.py"),
        "validate_structured_proof": sha256_file(root / "enterprise-harness" / "scripts" / "validate_structured_proof.py"),
        "changed_file_proof_map": sha256_file(root / "enterprise-harness" / "scripts" / "changed_file_proof_map.py"),
        "run_with_receipt": sha256_file(root / "enterprise-harness" / "scripts" / "run_with_receipt.py"),
    }
    for suffix, _, _ in STAGES:
        name = generic_skill_name(suffix)
        hashes[name] = sha256_tree(root / name)
    return hashes


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Generate repo-local enterprise overlay skills.",
    )
    parser.add_argument("--repo-slug", required=True)
    parser.add_argument("--repo-display-name")
    parser.add_argument("--repo-root", default=".")
    parser.add_argument(
        "--output-root",
        default=".codex/repo-skills",
        help="Repo-relative directory for generated overlay skills.",
    )
    parser.add_argument(
        "--profile-path",
        default=".codex/enterprise-state/repo-profile.json",
    )
    parser.add_argument(
        "--traps-path",
        default=".codex/enterprise-state/repo-traps.json",
    )
    parser.add_argument(
        "--best-practices-path",
        default=".codex/enterprise-state/repo-best-practices.json",
    )
    parser.add_argument(
        "--machine-path",
        default=".codex/enterprise-state/local-machine.json",
    )
    parser.add_argument(
        "--agent-session-root",
        default=".codex/enterprise-state/agent-sessions",
    )
    return parser.parse_args()


def title_case_slug(slug: str) -> str:
    return " ".join(part.capitalize() for part in slug.replace("_", "-").split("-") if part)


def skill_name(prefix: str, suffix: str) -> str:
    return prefix if not suffix else f"{prefix}-{suffix}"


def generic_skill_name(suffix: str) -> str:
    return "enterprise" if not suffix else f"enterprise-{suffix}"


def stage_description(display_name: str, stage_hint: str) -> str:
    return (
        f"Use when working in the {display_name} repo and {stage_hint} "
        "must be anchored to the repo-local profile, traps, and source-of-truth docs"
    )


def required_context_lines(
    profile_path: str,
    traps_path: str,
    best_path: str,
    machine_path: str,
    agent_session_root: str,
) -> list[str]:
    return [
        f"- Read `{profile_path}`",
        f"- Read `{traps_path}`",
        f"- Read `{best_path}` if it exists",
        f"- Read `{machine_path}` only when command availability or this computer matters",
        f"- Read your own gitignored agent-session file under `{agent_session_root}/<agent-id>.json` once stage work begins",
    ]


def load_repo_profile(repo_root: Path, profile_path: str) -> dict:
    resolved = repo_root / profile_path
    if not resolved.exists():
        return {}
    try:
        data = json.loads(resolved.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return {}
    return data if isinstance(data, dict) else {}


def repo_gate_command_fragments(profile: dict) -> list[str]:
    matrix = profile.get("commands", {}).get("repo_gate_matrix", [])
    fragments: list[str] = []
    if not isinstance(matrix, list):
        return fragments
    for entry in matrix:
        if isinstance(entry, str):
            command = entry.strip()
            if command:
                fragments.append(f"`{command}`")
            continue
        if not isinstance(entry, dict):
            continue
        command = str(entry.get("command", "")).strip()
        if not command:
            continue
        label = str(entry.get("name", "")).strip()
        when = str(entry.get("when", "")).strip()
        suffix = f" ({when})" if when else ""
        fragments.append(f"`{command}`" + (f" for {label}{suffix}" if label else suffix))
    return fragments


def repo_gate_lines(profile: dict) -> list[str]:
    fragments = repo_gate_command_fragments(profile)
    if not fragments:
        return []
    return [
        "- Repo-local gate commands from the committed repo profile: "
        + "; ".join(fragments)
        + ".",
    ]


def hard_rule_lines(suffix: str, profile: dict) -> list[str]:
    common = [
        "- Use the GPT-5.5 fresh baseline: outcome, success criteria, constraints, evidence, and stop rules come before legacy prompt ceremony.",
        "- `/goal` may be used as the enterprise intent front door for vague or product-shaped requests, but it is only an intake adapter. It must hand off to `$enterprise` path selection, `enterprise-required-gates`, agent-session artifacts, `plan-360-audit`, `contract-manager`, review, forge, verify, and PR-readiness/merge gates. Empty or skeletal goal output fails intake.",
        "- It is acceptable for planning and contract work to consume most of the lane when schema, tenant, identity, workflow, or file-boundary proof is unclear.",
        "- Use stable enterprise wrappers as the primary command surface in every worktree: `enterprise-agent-session`, `enterprise-required-gates`, and `enterprise-containment`. They prefer repo-local tooling when present and fall back to reviewed global tooling when old promotion worktrees lack repo-local gate files.",
        "- Every enterprise plan handoff must run `plan-360-audit` and record `plan_360_audit` before contract or build.",
        "- `contract-manager` is required before contract locking or implementation; record `contract_review` and recycle blocking findings before `LOCKED`.",
        "- Build is mechanical. Non-`QUICK` build cannot start until the agent session records a semantic `build_packet` with exact `Allowed Runtime Paths`, `Allowed Test Paths`, `Allowed Artifact Paths`, `Module Boundary`, `Folder Placement`, `Public Seam`, `Owner Layer`, `Allowed Dependency Direction`, `Forbidden Imports`, `Architecture Tests`, `Postcondition Execution Order`, `Expected RED`, `Expected GREEN`, `Required Commands`, `Forbidden Changes`, and `Refusal Conditions`.",
        "- Full proof is the only passing state. `PARTIALLY PROVED`, `UNPROVED`, mock-only, stale, wrong-head, and important untested edge-case proof are failed gates, not warnings.",
        "- No PR-ready, merge-ready, ship-ready, or `ok to merge` claim may bypass `enterprise-review`, `enterprise-forge`, and `enterprise-verify`; run the `pr-readiness` or `merge` agent-session gate before any merge command.",
        '- `$enterprise` owns the mechanical gate runner. Do not ask the user to run `npm`, `node`, or harness commands to prove enterprise compliance; invoke `enterprise-required-gates --repo-root "$PWD" --stage <stage> --agent-id <agent-id>` yourself and report its result.',
        "- For `harness`, `pr-readiness`, and `merge`, the `$enterprise` runner must also execute final proof scripts for PC trace, changed-file proof, structured proof, release readiness, delegated worker artifacts when present, and PR readiness when applicable.",
        "- Schema, query, and data-sensitive claims require current runtime code reads plus live/integration database proof against the actual runtime query path. Mock-only proof, migration-only proof, and diff-only proof do not count.",
        "- Cortex is the first code-location map for non-trivial source work, not final truth. Pair Cortex freshness/status/symbol evidence with direct source reads, or record an explicit fallback reason and use `rg`/direct reads for exact strings, ignored paths, tests/docs/config, dynamic exports, generated code, or stale indexes.",
        "- All verification and browser work must be headless. Manual GUI proof is supporting context only, never completion evidence.",
        "- Mirror required CI and repo-specific local gates before PR, using commands from the current repository profile or repo-local config rather than assuming a fixed command list.",
        "- Repo-local overlay freshness must be proven by `.codex/repo-skills/*-manifest.json` hashes. If the manifest is stale, rerun discover before relying on overlays.",
        "- Codex headless is the default enterprise worker runtime for delegated build, review, forge, and verify slices. Probe `codex mcp list --json` before dispatch and fail closed if required MCP servers are missing.",
        "- Do not use cmux panes, OpenCode, Kimi, or other runtimes as primary enterprise automation unless MCP, skills, repo policy, and structured-output parity are proven for this repo.",
        "- Delegated worker prompts must be compact packet files with stage, PC/lens ids, owned paths, forbidden paths, required commands, output paths, and stop rules. Do not pass a whole chat transcript.",
        *repo_gate_lines(profile),
        "- If CI or a local gate forces a code pivot, prior review/forge evidence for affected files expires. Re-run the attack on the current final diff.",
        "- If merge blockers, PR body requirements, live-proof commands, or ownership gates are unknown, stop before build instead of learning them from failed CI.",
        "- Apply the PR reviewer trap matrix when relevant: migration runner compatibility, SQL literal/precedence/sargability/type hazards, atomic concurrency/idempotence, state-transition metadata cleanup, live-test safety, mock shape vs real query shape, UI/rendered-output parity and escaping, exact docs/contracts/paths, valid falsy values, and original-vs-transformed identity fields.",
    ]
    stage_specific = {
        "discover": [
            "- Discover must write an overlay manifest with generator version, generated timestamp, repo-profile/trap/best-practice hashes, generic source hashes, and generated skill hashes.",
            "- Discover must run `python3 tools/enterprise-skills/enterprise-discover/scripts/validate_overlay_manifest.py --repo-root . --manifest .codex/repo-skills/<repo-family>-manifest.json` before relying on overlays.",
        ],
        "plan": [
            "- The plan must define file and module architecture, SRP boundaries, directory placement, public seams, consumer paths, and follow-up refactor boundaries.",
            "- The plan must include an Architecture Ratchet Matrix for multi-file, extraction, refactor, or architecture-sensitive work: current boundary evidence, target shape, thin vertical slice, public seam, owner layer, dependency direction, forbidden imports, architecture test, and future regression trap.",
            "- The plan must include a Local Full-Schema Proof Plan for schema/query/data-sensitive work: local Postgres source, restore/migration command, runtime query proof command, safety controls, cleanup, or a blocking/narrowed claim.",
            "- The plan must include a Known Review Trap Matrix that turns repeated PR-review failures into plan questions, contract obligations, proof commands, or explicit non-goals.",
            "- The plan must include source-to-consumer E2E traces, edge cases, exact live DB commands when relevant, and exact headless browser commands for UI/PDF/file flows.",
            "- The plan must include a PR Review Prevention Matrix plus async lifecycle, field-level contract, branch/reason-set, cast/index-safety, runtime-proof-parity, proof-lane-integrity, integration-fault, boundary-invariant, observability-redaction, public-seam/UI-accessibility, bounded-live-proof, test-integrity, and artifact-portability matrices where relevant; exact producer field spelling, near-miss field spelling collisions, duplicate submit, concurrent worker, stale running, old synchronous confirmation/error preservation, post-commit failure, helper return variants, unavailable dependency, retry, UI rehydration, sibling reasons, malformed/out-of-range casts, lane collisions, missing-resource proof failures, external fallback/idempotency, tenant/supplier/owner invariants, secret redaction, consumer seams, custom keyboard paths, no-mock/source-string proof integrity, and portable/current artifacts need proof commands before build.",
            "- The plan must include a repo gate matrix with local mirrors for delivery, no-new-mock, DB ownership, live-proof, browser/PDF, and required CI checks.",
            "- The plan must draft a `Mechanical Build Packet` with exact `Allowed Runtime Paths`, `Allowed Test Paths`, `Allowed Artifact Paths`, `Module Boundary`, `Folder Placement`, `Public Seam`, `Owner Layer`, `Allowed Dependency Direction`, `Forbidden Imports`, `Architecture Tests`, `Postcondition Execution Order`, `Expected RED`, `Expected GREEN`, `Required Commands`, `Forbidden Changes`, and `Refusal Conditions` so build does not guess.",
            "- After writing the plan, invoke `plan-360-audit`, fix or stop on blocking findings, and record the audit artifact as `plan_360_audit`.",
        ],
        "stack-review": [
            "- Stack review must preserve the incumbent stack unless the TDD proves a new technology domain is required.",
            "- Stack review decisions must be recorded as portable repo artifacts and kept in the overlay manifest hash chain.",
            "- Stack review must finish before plan for FULL lanes that need technology decision locking.",
        ],
        "contract": [
            "- Contract entry requires a recorded `plan_360_audit` when the lane has a plan.",
            "- Before locking the contract, invoke `contract-manager`, fix or stop on blocking findings, and record its artifact as `contract_review`.",
            "- The contract must prove current code and database reality before locking. Do not base postconditions on migrations, schema diffs, or intended shape alone.",
            "- The locked contract must include or point to a semantic `Mechanical Build Packet`, record it as `build_packet`, and fail closed if exact runtime paths, test paths, artifact paths, RED/GREEN commands, required commands, forbidden changes, refusal conditions, module boundary, folder placement, public seam, owner layer, dependency direction, forbidden imports, architecture tests, ownership seams, or other packet fields remain unknown.",
            "- The contract must lock Architecture Ratchet Matrix rows and Local Full-Schema Proof Plan rows into postconditions, invariants, commands, or explicit blockers before `LOCKED`.",
            "- The contract must define file/module/SRP/directory boundaries and map every changed code path to postconditions, E2E traces, edge cases, and live/headless verification commands.",
            "- The contract must name source-grounding method: Cortex status/symbol/outline evidence plus direct source reads, or explicit fallback reason with `rg`/direct-read proof for Cortex gaps.",
            "- The contract must lock exact producer-to-consumer field names, lifecycle postconditions, and every applicable PR Review Prevention Matrix cell: branch/reason-set, cast/index-safety, runtime-proof-parity, proof-lane-integrity, integration-fault, boundary-invariant, observability-redaction, public-seam/UI-accessibility, bounded-live-proof, test-integrity, and artifact-portability; missing cells keep the contract DRAFT.",
            "- The contract must name repo gate commands and must fail closed for mixed-owner direct-write files, missing PR-body proof, missing live-proof artifacts, or mock-only schema/query evidence.",
        ],
        "build": [
            "- Build is mechanical execution from the recorded `build_packet`: edit only `Allowed Runtime Paths`, `Allowed Test Paths`, or `Allowed Artifact Paths`, execute postconditions in order, run the named `Expected RED`, `Expected GREEN`, and `Required Commands`, preserve `Module Boundary`, `Folder Placement`, `Public Seam`, `Owner Layer`, `Allowed Dependency Direction`, `Forbidden Imports`, and `Architecture Tests`, honor `Forbidden Changes`, and stop on `Refusal Conditions` instead of inventing missing paths, owners, tests, helpers, writers, proof, or architecture.",
            "- For schema, query, tenant, money, order, invoice, inventory, or identity work, the first relevant RED test must be a live/integration DB test against the real query path.",
            "- For UI/PDF/file work, keep the headless browser command ready before implementation is called complete.",
            "- Keep the diff compliant with no-new-mock and DB ownership gates while coding; do not leave these for CI to discover.",
            "- Build must run architecture-ratchet and local-full-schema proof commands as soon as the relevant seam or query path exists; do not defer boundary regressions or local Postgres proof to final verify.",
            "- Build must run async lifecycle, field-contract, preserved-confirmation, commit-boundary, helper-return-variant, operator retry, branch/reason-set, cast/index-safety, runtime-proof-parity, proof-lane-integrity, integration-fault, boundary-invariant, observability-redaction, public-seam/UI-accessibility, bounded-live-proof, test-integrity, and artifact-portability counterexamples as soon as each seam exists; source-string and hard-coded mock tests cannot be primary runtime proof.",
            "- Build should use subagent-sliced execution when the locked contract has independent disjoint write slices, but the lead keeps contract interpretation, integration, combined checks, receipt-backed proof, and review handoff.",
            "- Automated build slices should run as Codex headless workers by default and write prompt/result artifacts under `.codex/enterprise-state/dispatch/<slug>/build/`.",
            "- Do not run concurrent writer subagents on overlapping files; use lead-only or explicitly ordered execution for tightly coupled work.",
        ],
        "review": [
            "- Review non-trivial, schema-sensitive, data-sensitive, tenant, money, order, invoice, inventory, and UI workflow changes with adversarial multi-agent scrutiny when practical.",
            "- Delegated review lenses should run as Codex headless workers by default, with agent/session/worker proof recorded in the attack-lens packet.",
            "- Review must include a structured `enterprise_attack_lens_packet`; prose claims that lenses ran are not enough.",
            "- Review must test the contract against current code execution, live DB proof, E2E traces, headless browser evidence, and edge cases.",
            "- Review must fail missing architecture-ratchet or local-full-schema evidence when changed boundaries, deep modules, extractions, helpers, schema paths, query paths, or data-sensitive behavior are in scope.",
            "- Review must fail partial proof and inspect async lifecycle, exact field spelling, preserved confirmation/error behavior, commit-boundary, helper return variants, unavailable dependency, retry, UI rehydration, branch/reason-set, cast/index-safety, runtime-proof-parity, proof-lane-integrity, integration-fault, boundary-invariant, observability-redaction, public-seam/UI-accessibility, bounded-live-proof, test-integrity, and artifact-portability cells before forge.",
            "- Review must inspect repo gate evidence and the current final diff. Stale passes from before a code pivot do not count.",
            "- Review must check Cortex/source-grounding proof and fail claims that use Cortex as truth without direct source reads or explicit fallback evidence.",
            "- Review must classify PR mode as normal-open, high-risk-draft, or advisory-harvest. High-risk lanes cannot be treated as normal without rationale, and Copilot/advisory findings must be routed.",
        ],
        "forge": [
            "- Forge should behave like an adversarial attack pass: try to break schema assumptions, code execution paths, E2E workflows, edge cases, and headless UI/PDF/file flows.",
            "- Forge is mandatory before PR readiness or merge; it is the gate that tries to pull the current final diff apart.",
            "- Delegated forge lenses should run as Codex headless workers by default, with agent/session/worker proof recorded in the attack-lens packet.",
            "- Forge must include a structured `enterprise_attack_lens_packet`; missing lenses fail forge.",
            "- Missing proof for any changed runtime file becomes a forge bug and recycles into contract/build.",
            "- Partial proof, mock-only proof, source-string-only proof, and untested important async/field/branch/cast/proof-lane/artifact cells are forge bugs, not residual risk notes; this includes quantity/ID/status field spelling, near-miss field spelling collisions, skipped confirmation/error codes, commit-boundary failures, truthy non-success helper returns, sibling reason gaps, unsafe casts, generic lane shadowing, non-failing missing-resource probes, unbounded proof queries, and stale or machine-local artifacts.",
            "- Forge must attack the repo gate matrix and rerun after any gate-driven code pivot.",
            "- Forge must attack source-read coverage and live query/readback proof; migration-only proof is a forge failure.",
            "- Forge must attack architecture-ratchet and local-full-schema claims: private-helper-only proof, missing future-regression trap, non-local DB target, unsafe snapshot handling, or skipped cleanup are forge bugs.",
            "- Forge must attack stale Cortex indexes, ignored source paths, exact-text gaps, missing test/docs/config source types, dynamic exports, generated code, and missing Cortex fallback reasons.",
            "- Forge must attack PR timing: high-risk draft policy, stale Copilot reviews after code pivots, and advisory-harvest routing for non-blocking comments.",
        ],
        "verify": [
            "- Verify must re-test against current code, not only review artifacts. Every changed runtime file needs a code execution trace or a documented non-runtime reason.",
            "- Delegated verification lenses should run as Codex headless workers by default, with worker outputs referenced by structured proof records.",
            "- Verify commands must produce command receipts; structured `enterprise_pc_trace` and `enterprise_changed_file_proof` records must cite matching receipt ids.",
            "- Verify must include structured `enterprise_pc_trace`, `enterprise_changed_file_proof`, and `enterprise_pr_readiness` records.",
            "- Schema/query/data records must name current runtime source/code reads and query/schema readback proof. Migration files can be supporting context only.",
            "- Schema/query/data records must include Cortex freshness/source-grounding evidence or an explicit Cortex fallback reason.",
            "- Cross-layer behavior requires full E2E trace evidence. UI changes, including PDF upload/preview/download flows, require headless browser testing.",
            "- Verify must run or explicitly justify every repo gate matrix command before final signoff.",
            "- Verify must fail unless the final proof verdict is full PROVED/PASS and branch/reason-set, cast/index-safety, runtime-proof-parity, proof-lane-integrity, integration-fault, boundary-invariant, architecture-ratchet, local-full-schema, observability-redaction, public-seam/UI-accessibility, bounded-live-proof, test-integrity, and artifact-portability records are present or structured not-applicable with applicability predicate, source evidence, current head, and non-runtime/non-DB scope; partial proof cannot move to PR readiness or merge.",
            "- Verify must record PR mode, high-risk draft disposition, Copilot/current-head review status, and advisory-harvest routing.",
        ],
        "harness": [
            "- Harness and merge readiness must run the `pr-readiness` or `merge` agent-session gate, which fails unless review, forge, and verify were recorded in order against the current code state.",
            "- Run final ship gates through `enterprise-required-gates --stage harness|pr-readiness|merge --agent-id <agent-id>` so PC trace, changed-file proof, structured proof, worker-artifact, and PR-readiness scripts are one required path.",
            "- Final ship gating must use receipt-backed PC trace proof, not test counts. Every contract postcondition must map to current command receipt, test file, test name, command output, and runtime path or documented non-runtime reason.",
            "- If delegated workers were used, final ship gating must confirm Codex headless worker outputs exist and are referenced by structured proof or attack-lens records.",
            "- Final ship gating must run `run_with_receipt.py` for verification commands, then `check_pc_trace.py`, `changed_file_proof_map.py`, `validate_release_readiness.py`, `pr_readiness_gate.py` for PR-backed work, and `validate_structured_proof.py` on touched artifacts.",
            "- Final ship gating must fail closed if code execution proof, live DB proof, local full-schema proof, architecture ratchet proof, source-read proof, query/readback proof, E2E trace evidence, or headless browser evidence is required but missing.",
            "- Final ship gating must fail closed if Cortex/source-grounding proof or explicit Cortex fallback reasons are missing for schema/query/data proof.",
            "- Final ship gating must fail closed if repo gate matrix evidence is missing or review/forge evidence predates the final diff.",
            "- Final ship gating must fail closed when high-risk PRs skip draft/readiness policy without rationale or useful Copilot/advisory comments are not fixed, tracked, or converted into trap/gate/eval learning.",
        ],
        "pr-review": [
            "- Use blocking-closeout for merge-blocking conversations and advisory-harvest for useful but non-blocking Copilot/GitHub comments.",
            "- Read live GitHub review threads and current PR head before classifying anything; unresolved blocking conversation state is the merge blocker source of truth.",
            "- Do not make every PR draft by default. Use draft for high-risk lanes, or globally only after confirming Copilot reviews draft PRs in this repo.",
            "- Reply with current-head evidence before resolving threads. Do not resolve review conversations as administrative cleanup unless the user explicitly narrows the task to that.",
            "- Real or useful advisory review findings must feed regression proof or compound learning that recommends a trap, gate, script, contract invariant/postcondition, plan rule, or eval.",
        ],
        "compound": [
            "- If the lane followed a failed PR review or unresolved conversation, compound must produce trap/gate/script/contract/plan/eval recommendations for every real finding.",
            "- Compound must include structured `enterprise_prevention_records` with status `implemented`, `tracked-follow-up`, `gate-added`, `eval-added`, or `blocked-with-reason`.",
            "- Vague prevention such as \"be more careful\" or \"add more tests\" is not accepted; tie the lesson to the earliest upstream stage that should catch it.",
        ],
        "debug": [
            "- Debug fixes for schema/query/data issues require current code reads and live/integration DB reproduction before accepting a root cause.",
        ],
    }
    return common + stage_specific.get(suffix, [])


def render_body(
    display_name: str,
    prefix: str,
    suffix: str,
    title: str,
    profile_path: str,
    traps_path: str,
    best_path: str,
    machine_path: str,
    agent_session_root: str,
    generator_cmd: str,
    profile: dict,
) -> str:
    generic_name = generic_skill_name(suffix)
    heading = f"{display_name} Enterprise" if not suffix else f"{display_name} Enterprise {title}"
    lines = [
        f"# {heading}",
        "",
        f"Repo-local overlay for the {display_name} repository.",
        "",
        "## Global Precheck",
        "",
        "Before reading further, writing artifacts, delegating, or changing files, run:",
        "",
        "```bash",
        f"enterprise-precheck --skill {skill_name(prefix, suffix)}",
        "```",
        "",
        "If it exits non-zero, stop and report stderr verbatim. Do not hand-craft packet files or evidence markers to bypass it.",
        "",
        "## Required Context",
        "",
        *required_context_lines(profile_path, traps_path, best_path, machine_path, agent_session_root),
        "",
        "## Repo-Local Hard Rules",
        "",
        *hard_rule_lines(suffix, profile),
        "",
        "## Required Workflow",
        "",
    ]

    if suffix == "":
        lines.extend(
            [
                "1. Prefer this repo-local family over the generic `enterprise-*` skills for work in this repo.",
                "2. Resolve commands, relative paths, workspace packages, and source-of-truth docs from the committed repo profile.",
                "3. If the repo profile is missing, stale, or contradicted by reality, run the repo-local discover wrapper first.",
                f"4. Invoke `{generic_name}`.",
                "5. Keep repo-wide learnings in committed `.codex/enterprise-state/` files, not in ad hoc chat memory.",
                f"6. Keep in-flight stage state in your own gitignored agent session under `{agent_session_root}`, not in repo-global status files.",
            ]
        )
    elif suffix == "discover":
        lines.extend(
            [
                "1. Refresh the committed repo profile, trap file, and best-practices file for this repo.",
                "2. Refresh the gitignored local-machine file only for this computer.",
                f"3. Refresh the current agent session under `{agent_session_root}` before relying on stage gates.",
                f"4. Regenerate this repo-local family with `{generator_cmd}`.",
                f"5. Invoke `{generic_name}`.",
                "6. Stage and commit only the portable setup artifacts with `python3 tools/enterprise-skills/enterprise-discover/scripts/commit_portable_state.py --repo-root .`.",
                "7. Do not commit machine-specific facts, live agent-session files, or absolute paths.",
            ]
        )
    else:
        lines.extend(
            [
                "1. Resolve commands, relative paths, workspace packages, and source-of-truth docs from the committed repo profile.",
                "2. If the committed profile is missing, stale, or contradicted by reality, run the repo-local discover wrapper first.",
                f"3. Invoke `{generic_name}`.",
                "4. Keep repo-specific learnings in committed `.codex/enterprise-state/` files, and keep machine-only facts out of git.",
                f"5. Use your own gitignored agent session under `{agent_session_root}` as the only source of in-flight stage truth.",
            ]
        )

    return "\n".join(lines) + "\n"


def render_skill(
    output_dir: Path,
    prefix: str,
    display_name: str,
    suffix: str,
    title: str,
    stage_hint: str,
    profile_path: str,
    traps_path: str,
    best_path: str,
    machine_path: str,
    agent_session_root: str,
    generator_cmd: str,
    profile: dict,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    skill_path = output_dir / "SKILL.md"
    frontmatter = [
        "---",
        f"name: {skill_name(prefix, suffix)}",
        f"description: {stage_description(display_name, stage_hint)}",
        "---",
        "",
    ]
    body = render_body(
        display_name,
        prefix,
        suffix,
        title,
        profile_path,
        traps_path,
        best_path,
        machine_path,
        agent_session_root,
        generator_cmd,
        profile,
    )
    skill_path.write_text("\n".join(frontmatter) + body, encoding="utf-8")


def main() -> int:
    args = parse_args()
    repo_root = Path(args.repo_root).resolve()
    output_root = repo_root / args.output_root
    display_name = args.repo_display_name or title_case_slug(args.repo_slug)
    prefix = f"{args.repo_slug}-enterprise"
    profile = load_repo_profile(repo_root, args.profile_path)
    generator_cmd = (
        "python3 tools/enterprise-skills/enterprise-discover/scripts/generate_repo_overlay.py "
        f"--repo-slug {args.repo_slug} --repo-display-name \"{display_name}\""
    )

    manifest = {
        "repo_slug": args.repo_slug,
        "repo_display_name": display_name,
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "generator_version": GENERATOR_VERSION,
        "generated_skills": [],
        "profile_path": args.profile_path,
        "traps_path": args.traps_path,
        "best_practices_path": args.best_practices_path,
        "machine_path": args.machine_path,
        "agent_session_root": args.agent_session_root,
        "source_hashes": {
            "profile": sha256_file(repo_root / args.profile_path),
            "traps": sha256_file(repo_root / args.traps_path),
            "best_practices": sha256_file(repo_root / args.best_practices_path),
            "generic_sources": generic_source_hashes(),
        },
        "generated_skill_hashes": {},
    }

    for suffix, title, stage_hint in STAGES:
        dir_name = skill_name(prefix, suffix)
        render_skill(
            output_root / dir_name,
            prefix,
            display_name,
            suffix,
            title,
            stage_hint,
            args.profile_path,
            args.traps_path,
            args.best_practices_path,
            args.machine_path,
            args.agent_session_root,
            generator_cmd,
            profile,
        )
        manifest["generated_skills"].append(dir_name)
        manifest["generated_skill_hashes"][dir_name] = sha256_tree(output_root / dir_name)

    manifest_path = output_root / f"{prefix}-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
