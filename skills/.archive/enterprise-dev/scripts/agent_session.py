#!/usr/bin/env python3
import argparse
import hashlib
import json
import os
import re
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Tuple


DEFAULT_SESSION_ROOT = ".codex/enterprise-state/agent-sessions"
AGENT_ENV_KEYS = (
    "CODEX_ENTERPRISE_AGENT_ID",
    "CODEX_SESSION_ID",
    "OPENAI_SESSION_ID",
    "SESSION_ID",
    "TERM_SESSION_ID",
)
LOCKED_STATUS_PATTERN = re.compile(r"^\*\*Status\*\*:\s*LOCKED\s*$", re.MULTILINE)
BUILD_PACKET_REQUIRED_TERMS = (
    "Mechanical Build Packet",
    "Allowed Runtime Paths",
    "Allowed Test Paths",
    "Allowed Artifact Paths",
    "Module Boundary",
    "Folder Placement",
    "Public Seam",
    "Owner Layer",
    "Allowed Dependency Direction",
    "Forbidden Imports",
    "Architecture Tests",
    "Postcondition Execution Order",
    "Expected RED",
    "Expected GREEN",
    "Required Commands",
    "Forbidden Changes",
    "Refusal Conditions",
)
INLINE_CONTRACT_REQUIRED_TERMS = (
    "Outcome",
    "Allowed Files",
    "Focused Proof Command",
    "Forbidden Scope",
    "Stop Rule",
)
PATH_LIKE_PATTERN = re.compile(
    r"`(?:\.?/)?[A-Za-z0-9_.@-]+/(?:[A-Za-z0-9_.@*-]+/)*[A-Za-z0-9_.@*-]+/?`"
    r"|(?:^|[\s,;:])(?:\.?/)?[A-Za-z0-9_.@-]+/(?:[A-Za-z0-9_.@*-]+/)*[A-Za-z0-9_.@*-]+/?"
)
COMMAND_LIKE_PATTERN = re.compile(
    r"`[^`]*(?:npm|node|python3?|npx|pnpm|yarn|pytest|jest|vitest|playwright|psql|curl|gh|docker|turbo|bash|sh)[^`]*`"
    r"|\b(?:npm|node|python3?|npx|pnpm|yarn|pytest|jest|vitest|playwright|psql|curl|gh|docker|turbo|bash|sh)\b",
    re.IGNORECASE,
)
POSTCONDITION_ID_PATTERN = re.compile(r"\bPC-[A-Za-z0-9._-]+\b")
ARCHITECTURE_PACKET_TERMS = (
    "Module Boundary",
    "Folder Placement",
    "Public Seam",
    "Owner Layer",
    "Allowed Dependency Direction",
    "Forbidden Imports",
    "Architecture Tests",
)
ARCHITECTURE_LAYER_PATTERN = re.compile(
    r"\b(?:route|routes|controller|controllers|service|services|repository|repositories|repo|repos|"
    r"domain|domains|adapter|adapters|component|components|hook|hooks|worker|workers|job|jobs|"
    r"schema|schemas|model|models|client|clients|api|ui|db|database|migration|migrations)\b",
    re.IGNORECASE,
)
DEPENDENCY_DIRECTION_PATTERN = re.compile(r"(?:->|=>|\bfrom\b|\bto\b|\binto\b|\bmust not\b|\bmay only\b)", re.IGNORECASE)
IMPORT_WORD_PATTERN = re.compile(r"\b(?:import|require|export|route|consumer|call|calls|from)\b", re.IGNORECASE)
FORBIDDEN_CHANGE_WORD_PATTERN = re.compile(
    r"\b(?:edit|modify|touch|change|create|delete|remove|rewrite|move|rename|import|require|call|"
    r"mock|proof|schema|migration|writer|helper|route|service|seam|module)\b",
    re.IGNORECASE,
)
ROOT_FILE_TARGET_PATTERN = re.compile(
    r"`(?:\.?/)?(?:[A-Za-z0-9_-]+\.)+[A-Za-z0-9_-]+`"
    r"|`\.[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)?`"
)
PACKAGE_MODULE_TARGET_PATTERN = re.compile(r"`(?:node:)?(?:@?[A-Za-z0-9_.-]+)(?:/[A-Za-z0-9_.-]+)*`")
NAMED_SEAM_TARGET_PATTERN = re.compile(
    r"`(?:[A-Za-z_$][A-Za-z0-9_$]*[.#:])?[A-Za-z_$][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*"
    r"(?:[.#:][A-Za-z_$][A-Za-z0-9_$]*)?`"
)
GENERIC_BACKTICKED_TARGET_PATTERN = re.compile(
    r"`(?:service|services|helper|helpers|writer|writers|schema|schemas|route|routes|module|modules|"
    r"seam|seams|code|logic|files?|tests?|util|utils|client|clients|component|components|db|"
    r"database|databases|adapter|adapters|controller|controllers|repo|repos|repository|repositories|"
    r"model|models|hook|hooks|worker|workers|job|jobs|domain|domains|endpoint|endpoints|api|ui|"
    r"config|configs|setting|settings|middleware|middlewares|lib|libs|common|shared|core|base|"
    r"manager|managers)`",
    re.IGNORECASE,
)
CONCRETE_FORBIDDEN_BEHAVIOR_PATTERN = re.compile(
    r"\b(?:mock[- ]?only proof|mock[- ]?only tests?|migration[- ]?only proof|diff[- ]?only proof|"
    r"dry[- ]?run[- ]?only proof|live db proof|stale[- ]?memory proof)\b",
    re.IGNORECASE,
)
VAGUE_FORBIDDEN_CHANGE_PATTERNS = (
    re.compile(r"\b(?:avoid|don't|do not)\s+(?:risky|unsafe|unrelated|extra|broad)\b", re.IGNORECASE),
    re.compile(r"\b(?:risky|unsafe|unrelated|extra|broad)\s+changes?\b", re.IGNORECASE),
)
ARCHITECTURE_TEST_PATTERN = re.compile(
    r"\b(?:module[-_.]?graph|startup[-_.]?seam|startup[-_.]?smoke|seam[-_.]?load|architecture|contract|test|spec)\b",
    re.IGNORECASE,
)
VAGUE_BUILD_PACKET_PATTERNS = (
    re.compile(r"\b(?:tbd|todo|pending|unknown|figure out|usual checks?|standard checks?)\b", re.IGNORECASE),
    re.compile(r"\b(?:as needed|where applicable|relevant tests?|affected files?|affected paths?|etc\.?)\b", re.IGNORECASE),
    re.compile(r"\b(?:best practices?|clean architecture|proper layer|standard layout|good structure|normal layering)\b", re.IGNORECASE),
)
EVIDENCE_ARTIFACT_PREFIXES = (
    ".codex/enterprise-state/",
    "docs/reviews/",
    "docs/solutions/",
)

STAGE_GATES = {
    "contract": {
        "all_history": ["plan", "plan-360-audit"],
        "artifacts": ["plan", "plan_360_audit"],
    },
    "build": {
        "all_history": ["plan", "plan-360-audit", "contract-manager", "contract"],
        "artifacts": ["plan", "plan_360_audit", "contract_review", "contract", "build_packet"],
        "checks": ["contract_locked", "mechanical_build_packet"],
    },
    "review": {
        "all_history": ["build", "contract"],
        "artifacts": ["plan", "plan_360_audit", "contract_review", "contract", "build_packet"],
        "checks": ["contract_locked", "mechanical_build_packet"],
    },
    "forge": {
        "all_history": ["review"],
        "artifacts": ["plan", "plan_360_audit", "contract_review", "contract", "review"],
        "checks": ["contract_locked"],
    },
    "verify": {
        "all_history": ["build", "contract"],
        "artifacts": ["plan", "plan_360_audit", "contract_review", "contract", "build_packet"],
        "checks": ["contract_locked", "mechanical_build_packet"],
        "non_quick_history": ["review", "forge"],
        "non_quick_artifacts": ["review", "forge_report"],
    },
    "harness": {
        "all_history": ["review", "forge", "verify"],
        "artifacts": ["build_packet", "review", "forge_report", "verification"],
        "checks": ["mechanical_build_packet", "review_forge_verify_order", "review_forge_verify_current_code"],
    },
    "pr-readiness": {
        "all_history": ["review", "forge", "verify"],
        "artifacts": ["build_packet", "review", "forge_report", "verification"],
        "checks": ["mechanical_build_packet", "review_forge_verify_order", "review_forge_verify_current_code"],
    },
    "merge": {
        "all_history": ["review", "forge", "verify"],
        "artifacts": ["build_packet", "review", "forge_report", "verification"],
        "checks": ["mechanical_build_packet", "review_forge_verify_order", "review_forge_verify_current_code"],
    },
    "compound": {
        "all_history": ["verify"],
        "artifacts": ["verification"],
    },
}
QUICK_STAGE_GATES = {
    "contract": {
        "artifacts": ["inline_contract"],
        "checks": ["inline_contract"],
    },
    "build": {
        "all_history": ["contract"],
        "artifacts": ["inline_contract"],
        "checks": ["inline_contract"],
    },
    "review": {
        "all_history": ["build", "contract"],
        "artifacts": ["inline_contract"],
        "checks": ["inline_contract"],
    },
    "verify": {
        "all_history": ["build", "contract"],
        "artifacts": ["inline_contract", "focused_proof"],
        "checks": ["inline_contract"],
    },
}
QUICK_LANE_BOUNDARY_STAGES = {"forge", "harness", "pr-readiness", "merge"}
CLOSEOUT_PATH_CLASSIFICATIONS = {"PR_CLOSEOUT", "NON_ENTERPRISE_PR_CLOSEOUT"}
CLOSEOUT_STAGE_GATES = {
    "pr-readiness": {
        "artifacts": ["closeout_receipt"],
        "checks": ["closeout_receipt"],
    },
    "merge": {
        "artifacts": ["closeout_receipt"],
        "checks": ["closeout_receipt"],
    },
}
CLOSEOUT_RECEIPT_SCHEMA = "helpdesk.pr_closeout_receipt.v1"
CLOSEOUT_RECEIPT_TRUE_FIELDS = (
    "required_checks_passed",
    "current_head_verified",
    "review_threads_resolved",
    "copilot_review_wait_passed",
    "local_canary_passed",
    "blast_radius_passed",
    "patch_or_fix_satisfied",
    "mock_only_proof_rejected",
)
CLOSEOUT_RECEIPT_EVIDENCE_KEYS = (
    "required_checks",
    "current_head",
    "review_threads",
    "copilot_review_wait",
    "local_canary",
    "blast_radius",
    "patch_or_fix",
    "mock_only_proof",
    "merge_method",
)


def utc_now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def sanitize_agent_id(agent_id: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "-", agent_id).strip("-.")
    if not cleaned:
        raise ValueError("agent id resolved to an empty value")
    return cleaned


def resolve_agent_id(explicit_agent_id: Optional[str]) -> str:
    if explicit_agent_id:
        return explicit_agent_id
    for key in AGENT_ENV_KEYS:
        value = os.environ.get(key)
        if value:
            return value
    return f"agent-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}-{uuid.uuid4().hex[:8]}"


def repo_root_from(value: str) -> Path:
    return Path(value).resolve()


def run_git(repo_root: Path, args: List[str]) -> Optional[str]:
    try:
        completed = subprocess.run(
            ["git", *args],
            cwd=repo_root,
            check=True,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
    except (OSError, subprocess.CalledProcessError):
        return None
    return completed.stdout.strip()


def current_git_head(repo_root: Path) -> Optional[str]:
    return run_git(repo_root, ["rev-parse", "HEAD"])


def is_evidence_artifact(path: str) -> bool:
    normalized = path.strip()
    if normalized.startswith("./"):
        normalized = normalized[2:]
    return any(normalized.startswith(prefix) for prefix in EVIDENCE_ARTIFACT_PREFIXES)


def current_code_state(repo_root: Path) -> Optional[str]:
    head = current_git_head(repo_root)
    changed = run_git(repo_root, ["ls-files", "-m", "-d", "-o", "--exclude-standard"])
    staged = run_git(repo_root, ["diff", "--cached", "--name-only", "--diff-filter=ACMRTD"])
    if head is None or changed is None or staged is None:
        return None

    digest = hashlib.sha256()
    digest.update(head.encode("utf-8"))
    changed_paths = set(changed.splitlines()) | set(staged.splitlines())
    for raw_path in sorted(path for path in changed_paths if path and not is_evidence_artifact(path)):
        digest.update(raw_path.encode("utf-8"))
        digest.update(b"\0")
        full_path = repo_root / raw_path
        if full_path.exists() and full_path.is_file():
            digest.update(full_path.read_bytes())
        else:
            digest.update(b"<deleted>")
        digest.update(b"\0")
    return digest.hexdigest()


def session_root_from(repo_root: Path, value: str) -> Path:
    session_root = Path(value)
    if not session_root.is_absolute():
        session_root = repo_root / session_root
    return session_root.resolve()


def session_path_for(session_root: Path, agent_id: str) -> Path:
    return session_root / f"{sanitize_agent_id(agent_id)}.json"


def load_session(path: Path) -> Optional[dict]:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def write_session(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp_path = path.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
    tmp_path.replace(path)


def default_session(agent_id: str, repo_root: Path) -> dict:
    now = utc_now()
    return {
        "schema_version": 1,
        "agent_id": agent_id,
        "repo_root": str(repo_root),
        "created_at": now,
        "updated_at": now,
        "path_classification": None,
        "task_slug": None,
        "proof_scope_target": None,
        "current_stage": None,
        "artifacts": {},
        "history": [],
    }


def normalize_path(repo_root: Path, raw_path: str) -> str:
    candidate = Path(raw_path)
    if not candidate.is_absolute():
        return candidate.as_posix()
    resolved = candidate.resolve()
    try:
        return resolved.relative_to(repo_root).as_posix()
    except ValueError:
        return str(resolved)


def resolve_artifact_path(repo_root: Path, raw_path: str) -> Path:
    candidate = Path(raw_path)
    if candidate.is_absolute():
        return candidate.resolve()
    return (repo_root / candidate).resolve()


def parse_artifact_pairs(values: List[str], repo_root: Path) -> Dict[str, str]:
    artifacts: Dict[str, str] = {}
    for value in values:
        if "=" not in value:
            raise ValueError(f"artifact must use kind=path form: {value}")
        key, raw_path = value.split("=", 1)
        key = key.strip()
        raw_path = raw_path.strip()
        if not key or not raw_path:
            raise ValueError(f"artifact must use kind=path form: {value}")
        artifacts[key] = normalize_path(repo_root, raw_path)
    return artifacts


def history_stages(session: dict) -> set:
    stages = set()
    for entry in session.get("history", []):
        stage = entry.get("stage")
        if stage:
            stages.add(stage)
    current_stage = session.get("current_stage")
    if current_stage:
        stages.add(current_stage)
    return stages


def latest_history_entry(session: dict, stage: str) -> Optional[dict]:
    for entry in reversed(session.get("history", [])):
        if entry.get("stage") == stage:
            return entry
    return None


def latest_history_index(session: dict, stage: str) -> Optional[int]:
    history = session.get("history", [])
    for index in range(len(history) - 1, -1, -1):
        if history[index].get("stage") == stage:
            return index
    return None


def file_exists_for_artifact(repo_root: Path, session: dict, artifact_key: str) -> Tuple[bool, Optional[str]]:
    artifact_path = session.get("artifacts", {}).get(artifact_key)
    if not artifact_path:
        return False, None
    resolved = resolve_artifact_path(repo_root, artifact_path)
    return resolved.exists(), artifact_path


def contract_is_locked(repo_root: Path, session: dict) -> bool:
    contract_path = session.get("artifacts", {}).get("contract")
    if not contract_path:
        return False
    resolved = resolve_artifact_path(repo_root, contract_path)
    if not resolved.exists():
        return False
    content = resolved.read_text(encoding="utf-8")
    return bool(LOCKED_STATUS_PATTERN.search(content))


def build_packet_field_line_pattern(term: str) -> re.Pattern:
    return re.compile(
        rf"^\s*(?:[-*]\s*)?(?:\*\*)?{re.escape(term)}(?:\*\*)?\s*:?\s*(.*)$",
        re.IGNORECASE,
    )


def any_build_packet_field_line(line: str) -> bool:
    return any(build_packet_field_line_pattern(term).match(line) for term in BUILD_PACKET_REQUIRED_TERMS)


def field_line_pattern(term: str) -> re.Pattern:
    return re.compile(
        rf"^\s*(?:[-*]\s*)?(?:\*\*)?{re.escape(term)}(?:\*\*)?\s*:?\s*(.*)$",
        re.IGNORECASE,
    )


def extract_named_field(content: str, term: str, all_terms: Tuple[str, ...]) -> str:
    heading_pattern = re.compile(
        rf"(?im)^\s{{0,3}}#{{1,6}}\s+{re.escape(term)}\s*:?\s*$"
    )
    heading_match = heading_pattern.search(content)
    if heading_match:
        next_heading = re.search(r"(?m)^\s{0,3}#{1,6}\s+\S", content[heading_match.end() :])
        end_index = heading_match.end() + next_heading.start() if next_heading else len(content)
        return content[heading_match.end() : end_index].strip()

    lines = content.splitlines()
    field_pattern = field_line_pattern(term)
    for index, line in enumerate(lines):
        match = field_pattern.match(line)
        if not match:
            continue
        collected = [match.group(1).strip()]
        for next_line in lines[index + 1 :]:
            if any(field_line_pattern(candidate).match(next_line) for candidate in all_terms):
                break
            stripped = next_line.strip()
            if not stripped:
                if any(part.strip() for part in collected):
                    break
                continue
            if next_line.startswith((" ", "\t")) or re.match(r"^\s*(?:[-*]|\d+\.)\s+\S", next_line):
                collected.append(stripped)
                continue
            break
        return "\n".join(part for part in collected if part).strip()
    return ""


def extract_build_packet_field(content: str, term: str) -> str:
    return extract_named_field(content, term, BUILD_PACKET_REQUIRED_TERMS)


def extract_inline_contract_field(content: str, term: str) -> str:
    return extract_named_field(content, term, INLINE_CONTRACT_REQUIRED_TERMS)


def forbidden_change_items(value: str) -> List[str]:
    items: List[str] = []
    for raw_line in value.splitlines():
        stripped = raw_line.strip()
        if not stripped:
            continue
        item = re.sub(r"^(?:[-*]|\d+\.)\s+", "", stripped).strip()
        if item:
            items.append(item)
    return items or [value.strip()]


def forbidden_change_item_failures(item: str) -> List[str]:
    compact = re.sub(r"\s+", " ", item).strip()
    if not compact:
        return []
    if compact.lower() in {"none", "n/a", "na", "not applicable"}:
        return ["mechanical build packet forbidden changes must name exact forbidden paths, modules, or seams: Forbidden Changes"]
    for pattern in (*VAGUE_BUILD_PACKET_PATTERNS, *VAGUE_FORBIDDEN_CHANGE_PATTERNS):
        if pattern.search(compact):
            return ["mechanical build packet forbidden changes must name exact forbidden paths, modules, or seams: Forbidden Changes"]
    if GENERIC_BACKTICKED_TARGET_PATTERN.search(item):
        return ["mechanical build packet forbidden changes must name exact forbidden paths, modules, or seams: Forbidden Changes"]
    has_action = bool(FORBIDDEN_CHANGE_WORD_PATTERN.search(compact))
    has_import_action = bool(re.search(r"\b(?:import|require)\b", compact, re.IGNORECASE))
    has_exact_target = bool(
        PATH_LIKE_PATTERN.search(item)
        or ROOT_FILE_TARGET_PATTERN.search(item)
        or NAMED_SEAM_TARGET_PATTERN.search(item)
        or CONCRETE_FORBIDDEN_BEHAVIOR_PATTERN.search(compact)
        or (has_import_action and PACKAGE_MODULE_TARGET_PATTERN.search(item))
    )
    if not (has_action and has_exact_target):
        return ["mechanical build packet forbidden changes must name exact forbidden paths, modules, or seams: Forbidden Changes"]
    return []


def build_packet_field_failures(term: str, value: str) -> List[str]:
    failures: List[str] = []
    compact = re.sub(r"\s+", " ", value).strip()
    if not compact:
        return [f"mechanical build packet field is empty: {term}"]
    if compact.lower() in {"none", "n/a", "na", "not applicable"}:
        return [f"mechanical build packet field is non-actionable: {term}"]
    for pattern in VAGUE_BUILD_PACKET_PATTERNS:
        if pattern.search(compact):
            failures.append(f"mechanical build packet field is vague: {term}")
            break

    if term in {"Allowed Runtime Paths", "Allowed Test Paths", "Allowed Artifact Paths"}:
        if not PATH_LIKE_PATTERN.search(value):
            failures.append(f"mechanical build packet field must name exact repo-relative paths: {term}")
    elif term in {"Folder Placement", "Public Seam"}:
        if not PATH_LIKE_PATTERN.search(value):
            failures.append(f"mechanical build packet architecture field must name exact repo-relative paths: {term}")
    elif term in {"Module Boundary", "Owner Layer"}:
        if not (PATH_LIKE_PATTERN.search(value) and ARCHITECTURE_LAYER_PATTERN.search(value)):
            failures.append(f"mechanical build packet architecture field must name exact repo-relative paths and layers: {term}")
    elif term == "Allowed Dependency Direction":
        if not (DEPENDENCY_DIRECTION_PATTERN.search(value) and ARCHITECTURE_LAYER_PATTERN.search(value)):
            failures.append("mechanical build packet dependency direction must name exact allowed layer/import direction")
    elif term == "Forbidden Imports":
        if not (PATH_LIKE_PATTERN.search(value) and IMPORT_WORD_PATTERN.search(value)):
            failures.append("mechanical build packet forbidden imports must name exact forbidden import paths or modules")
    elif term == "Forbidden Changes":
        for item in forbidden_change_items(value):
            failures.extend(forbidden_change_item_failures(item))
    elif term == "Architecture Tests":
        if not PATH_LIKE_PATTERN.search(value):
            failures.append("mechanical build packet architecture tests must name exact repo-relative test paths")
        if not COMMAND_LIKE_PATTERN.search(value):
            failures.append("mechanical build packet architecture tests must name exact test commands")
        if not ARCHITECTURE_TEST_PATTERN.search(value):
            failures.append("mechanical build packet architecture tests must name module-graph, startup-seam, seam-load, or equivalent architecture coverage")
    elif term in {"Expected RED", "Expected GREEN", "Required Commands"}:
        if not COMMAND_LIKE_PATTERN.search(value):
            failures.append(f"mechanical build packet field must name exact commands: {term}")
    elif term == "Postcondition Execution Order":
        if not POSTCONDITION_ID_PATTERN.search(value):
            failures.append("mechanical build packet execution order must name PC-* IDs")

    return failures


def build_packet_is_mechanical(repo_root: Path, session: dict) -> Tuple[bool, List[str]]:
    artifact_path = session.get("artifacts", {}).get("build_packet")
    if not artifact_path:
        return False, ["missing artifact in this agent session: build_packet"]
    resolved = resolve_artifact_path(repo_root, artifact_path)
    if not resolved.exists():
        return False, [f"artifact path does not exist: build_packet -> {artifact_path}"]
    content = resolved.read_text(encoding="utf-8")
    missing = [term for term in BUILD_PACKET_REQUIRED_TERMS if term not in content]
    if missing:
        return False, [
            "mechanical build packet is incomplete; missing required terms: "
            + ", ".join(missing)
        ]
    failures: List[str] = []
    for term in BUILD_PACKET_REQUIRED_TERMS:
        if term == "Mechanical Build Packet":
            continue
        field_value = extract_build_packet_field(content, term)
        failures.extend(build_packet_field_failures(term, field_value))
    if failures:
        return False, failures
    return True, []


def inline_contract_field_failures(term: str, value: str) -> List[str]:
    compact = re.sub(r"\s+", " ", value).strip()
    if not compact:
        return [f"quick inline contract field is empty: {term}"]
    if compact.lower() in {"none", "n/a", "na", "not applicable"}:
        return [f"quick inline contract field is non-actionable: {term}"]
    for pattern in VAGUE_BUILD_PACKET_PATTERNS:
        if pattern.search(compact):
            return [f"quick inline contract field is vague: {term}"]

    if term == "Allowed Files" and not (PATH_LIKE_PATTERN.search(value) or ROOT_FILE_TARGET_PATTERN.search(value)):
        return ["quick inline contract allowed files must name exact repo-relative paths"]
    if term == "Focused Proof Command" and not COMMAND_LIKE_PATTERN.search(value):
        return ["quick inline contract proof command must name an exact command"]
    if term == "Forbidden Scope":
        failures: List[str] = []
        for item in forbidden_change_items(value):
            failures.extend(forbidden_change_item_failures(item))
        return [failure.replace("mechanical build packet", "quick inline contract") for failure in failures]
    return []


def inline_contract_is_complete(repo_root: Path, session: dict) -> Tuple[bool, List[str]]:
    artifact_path = session.get("artifacts", {}).get("inline_contract")
    if not artifact_path:
        return False, ["missing artifact in this agent session: inline_contract"]
    resolved = resolve_artifact_path(repo_root, artifact_path)
    if not resolved.exists():
        return False, [f"artifact path does not exist: inline_contract -> {artifact_path}"]
    try:
        content = resolved.read_text(encoding="utf-8", errors="replace")
    except OSError as exc:
        return False, [f"could not read quick inline contract {resolved}: {exc}"]
    missing = [term for term in INLINE_CONTRACT_REQUIRED_TERMS if term not in content]
    if missing:
        return False, [
            "quick inline contract is incomplete; missing required terms: "
            + ", ".join(missing)
        ]
    failures: List[str] = []
    for term in INLINE_CONTRACT_REQUIRED_TERMS:
        field_value = extract_inline_contract_field(content, term)
        failures.extend(inline_contract_field_failures(term, field_value))
    if failures:
        return False, failures
    return True, []


def quick_path_allows_verify_without_review(session: dict) -> bool:
    return session.get("path_classification") == "QUICK"


def normalize_expected_pr(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    match = re.search(r"(?:pull/)?(\d+)/*$", str(value).strip())
    return match.group(1) if match else str(value).strip()


def normalize_base_ref(value: Optional[str]) -> Optional[str]:
    if not value:
        return None
    text = str(value).strip()
    for prefix in ("refs/heads/", "origin/"):
        if text.startswith(prefix):
            return text[len(prefix) :]
    return text


def closeout_path_uses_external_pr_gates(session: dict) -> bool:
    return session.get("path_classification") in CLOSEOUT_PATH_CLASSIFICATIONS


def evidence_source_present(value: object) -> bool:
    if not isinstance(value, dict):
        return False
    for key in ("source", "command", "artifact", "url", "path", "proof"):
        item = value.get(key)
        if isinstance(item, str) and item.strip():
            return True
        if isinstance(item, list) and any(
            isinstance(inner, str) and inner.strip() for inner in item
        ):
            return True
    return False


def evidence_artifact_references(value: dict) -> List[Tuple[str, str]]:
    references: List[Tuple[str, str]] = []
    for key in ("artifact", "path", "proof"):
        item = value.get(key)
        if isinstance(item, str) and item.strip():
            references.append((key, item.strip()))
        elif isinstance(item, list):
            for index, inner in enumerate(item):
                if isinstance(inner, str) and inner.strip():
                    references.append((f"{key}[{index}]", inner.strip()))
    return references


def evidence_artifact_failures(repo_root: Path, evidence_key: str, value: dict, required: bool = False) -> List[str]:
    references = evidence_artifact_references(value)
    if required and not references:
        return [f"closeout_receipt evidence.{evidence_key} must include an artifact, path, or proof file"]

    failures: List[str] = []
    for label, raw_path in references:
        if not resolve_artifact_path(repo_root, raw_path).exists():
            failures.append(f"closeout_receipt evidence.{evidence_key}.{label} does not exist: {raw_path}")
    return failures


def result_looks_pass(value: object) -> bool:
    return str(value or "").strip().lower() in {"pass", "passed", "success", "succeeded", "ok", "true"}


def closeout_receipt_evidence_failures(repo_root: Path, receipt: dict) -> List[str]:
    evidence = receipt.get("evidence")
    if not isinstance(evidence, dict):
        return ["closeout_receipt evidence must be an object"]

    failures: List[str] = []
    for key in CLOSEOUT_RECEIPT_EVIDENCE_KEYS:
        if key not in evidence:
            failures.append(f"closeout_receipt evidence.{key} must be present")
        elif not isinstance(evidence.get(key), dict):
            failures.append(f"closeout_receipt evidence.{key} must be an object")

    required_checks = evidence.get("required_checks")
    if isinstance(required_checks, dict):
        checks = required_checks.get("checks")
        if not isinstance(checks, list) or not checks:
            failures.append("closeout_receipt evidence.required_checks.checks must be a non-empty list")
        else:
            for index, check in enumerate(checks):
                if not isinstance(check, dict):
                    failures.append(f"closeout_receipt evidence.required_checks.checks[{index}] must be an object")
                    continue
                if not str(check.get("name") or "").strip():
                    failures.append(f"closeout_receipt evidence.required_checks.checks[{index}].name must be present")
                conclusion = check.get("conclusion", check.get("status"))
                if not result_looks_pass(conclusion):
                    failures.append(
                        f"closeout_receipt evidence.required_checks.checks[{index}].conclusion must be passing"
                    )
        if not evidence_source_present(required_checks):
            failures.append("closeout_receipt evidence.required_checks must include source, command, artifact, or url")
        failures.extend(evidence_artifact_failures(repo_root, "required_checks", required_checks, required=True))

    current_head = evidence.get("current_head")
    if isinstance(current_head, dict):
        if str(current_head.get("head_sha") or "").lower() != str(receipt.get("head_sha") or "").lower():
            failures.append("closeout_receipt evidence.current_head.head_sha must match head_sha")
        if not evidence_source_present(current_head):
            failures.append("closeout_receipt evidence.current_head must include source, command, artifact, or url")
        failures.extend(evidence_artifact_failures(repo_root, "current_head", current_head))

    review_threads = evidence.get("review_threads")
    if isinstance(review_threads, dict):
        if review_threads.get("unresolved") != receipt.get("review_threads_unresolved"):
            failures.append("closeout_receipt evidence.review_threads.unresolved must match review_threads_unresolved")
        if not evidence_source_present(review_threads):
            failures.append("closeout_receipt evidence.review_threads must include source, command, artifact, or url")
        failures.extend(evidence_artifact_failures(repo_root, "review_threads", review_threads, required=True))

    for key in ("copilot_review_wait", "local_canary", "blast_radius"):
        block = evidence.get(key)
        if not isinstance(block, dict):
            continue
        if not result_looks_pass(block.get("result")):
            failures.append(f"closeout_receipt evidence.{key}.result must be passing")
        if not evidence_source_present(block):
            failures.append(f"closeout_receipt evidence.{key} must include source, command, artifact, or url")
        failures.extend(evidence_artifact_failures(repo_root, key, block, required=True))

    patch_or_fix = evidence.get("patch_or_fix")
    if isinstance(patch_or_fix, dict):
        if str(patch_or_fix.get("verdict") or "").strip().upper() != "FIX":
            failures.append("closeout_receipt evidence.patch_or_fix.verdict must be FIX")
        blockers = patch_or_fix.get("fix_now_blockers", [])
        if not isinstance(blockers, list):
            failures.append("closeout_receipt evidence.patch_or_fix.fix_now_blockers must be a list")
        elif blockers:
            failures.append("closeout_receipt evidence.patch_or_fix.fix_now_blockers must be empty")
        if not evidence_source_present(patch_or_fix):
            failures.append("closeout_receipt evidence.patch_or_fix must include source, command, artifact, or url")
        failures.extend(evidence_artifact_failures(repo_root, "patch_or_fix", patch_or_fix, required=True))

    mock_only_proof = evidence.get("mock_only_proof")
    if isinstance(mock_only_proof, dict):
        if mock_only_proof.get("rejected") is not True:
            failures.append("closeout_receipt evidence.mock_only_proof.rejected must be true")
        if not evidence_source_present(mock_only_proof):
            failures.append("closeout_receipt evidence.mock_only_proof must include source, command, artifact, or url")
        failures.extend(evidence_artifact_failures(repo_root, "mock_only_proof", mock_only_proof, required=True))

    merge_method = evidence.get("merge_method")
    if isinstance(merge_method, dict):
        if merge_method.get("method") != receipt.get("merge_method"):
            failures.append("closeout_receipt evidence.merge_method.method must match merge_method")
        if not evidence_source_present(merge_method):
            failures.append("closeout_receipt evidence.merge_method must include source, command, artifact, or url")
        failures.extend(evidence_artifact_failures(repo_root, "merge_method", merge_method))

    return failures


def closeout_receipt_is_complete(
    repo_root: Path,
    session: dict,
    stage: str,
    expected_pr: Optional[str] = None,
    expected_base_ref: Optional[str] = None,
) -> Tuple[bool, List[str]]:
    artifact_path = session.get("artifacts", {}).get("closeout_receipt")
    if not artifact_path:
        return False, ["missing artifact in this agent session: closeout_receipt"]
    resolved = resolve_artifact_path(repo_root, artifact_path)
    if not resolved.exists():
        return False, [f"artifact path does not exist: closeout_receipt -> {artifact_path}"]
    try:
        receipt = json.loads(resolved.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        return False, [f"closeout_receipt is not valid JSON: {exc}"]
    except OSError as exc:
        return False, [f"could not read closeout_receipt {artifact_path}: {exc}"]

    failures: List[str] = []
    if not expected_pr:
        failures.append("closeout_receipt expected PR is required for closeout readiness or merge")
    if not expected_base_ref:
        failures.append("closeout_receipt expected base ref is required for closeout readiness or merge")
    if receipt.get("schema_version") != CLOSEOUT_RECEIPT_SCHEMA:
        failures.append(f"closeout_receipt schema_version must be {CLOSEOUT_RECEIPT_SCHEMA}")
    if not receipt.get("pr"):
        failures.append("closeout_receipt must name the PR")
    elif expected_pr and str(receipt.get("pr")) != normalize_expected_pr(expected_pr):
        failures.append("closeout_receipt pr must match the requested PR")
    if not receipt.get("base_ref"):
        failures.append("closeout_receipt must name base_ref")
    elif expected_base_ref and normalize_base_ref(str(receipt.get("base_ref"))) != normalize_base_ref(expected_base_ref):
        failures.append("closeout_receipt base_ref must match the requested base ref")
    head_sha = str(receipt.get("head_sha") or "")
    if not re.fullmatch(r"[0-9a-fA-F]{7,40}", head_sha):
        failures.append("closeout_receipt head_sha must be a git SHA")
    else:
        current_head = current_git_head(repo_root)
        if not current_head:
            failures.append("could not determine current git HEAD for closeout_receipt head_sha")
        elif not current_head.lower().startswith(head_sha.lower()):
            failures.append("closeout_receipt head_sha must match the current git HEAD")
    if "blockers" not in receipt:
        failures.append("closeout_receipt blockers must be present")
    blockers = receipt.get("blockers")
    if not isinstance(blockers, list):
        failures.append("closeout_receipt blockers must be a list")
    elif blockers:
        failures.append("closeout_receipt blockers must be empty before readiness or merge")
    if receipt.get("eligible_for_merge") is not True:
        failures.append("closeout_receipt eligible_for_merge must be true")
    if stage == "merge" and receipt.get("merge_method") != "rebase":
        failures.append("closeout_receipt merge_method must be rebase for merge stage")
    for field in CLOSEOUT_RECEIPT_TRUE_FIELDS:
        if receipt.get(field) is not True:
            failures.append(f"closeout_receipt {field} must be true")
    if receipt.get("review_threads_unresolved") != 0:
        failures.append("closeout_receipt review_threads_unresolved must be 0")
    failures.extend(closeout_receipt_evidence_failures(repo_root, receipt))

    return not failures, failures


def review_forge_verify_order_is_valid(session: dict) -> Tuple[bool, List[str]]:
    failures: List[str] = []
    ordered = ["review", "forge", "verify"]
    indexes = []
    for stage in ordered:
        index = latest_history_index(session, stage)
        if index is None:
            failures.append(f"missing upstream stage in this agent session: {stage}")
        indexes.append(index)
    if not failures and indexes != sorted(indexes):
        failures.append("review/forge/verify order is invalid; expected review before forge before verify")
    return not failures, failures


def review_forge_verify_cover_current_code(repo_root: Path, session: dict) -> Tuple[bool, List[str]]:
    failures: List[str] = []
    current_state = current_code_state(repo_root)
    if current_state is None:
        return False, ["could not determine current git code state for review/forge/verify freshness"]
    for stage in ("review", "forge", "verify"):
        entry = latest_history_entry(session, stage)
        if not entry:
            failures.append(f"missing upstream stage in this agent session: {stage}")
            continue
        recorded_state = entry.get("git_state")
        if not recorded_state:
            failures.append(f"{stage} was recorded without git_state; rerun {stage} on the current final diff")
        elif recorded_state != current_state:
            failures.append(f"{stage} evidence is stale for current final diff; rerun {stage}")
    return not failures, failures


def ensure_command(args: argparse.Namespace) -> int:
    repo_root = repo_root_from(args.repo_root)
    agent_id = resolve_agent_id(args.agent_id)
    session_root = session_root_from(repo_root, args.session_root)
    session_path = session_path_for(session_root, agent_id)
    session = load_session(session_path) or default_session(agent_id, repo_root)

    if args.path_classification:
        session["path_classification"] = args.path_classification
    if args.task_slug:
        session["task_slug"] = args.task_slug
    if args.proof_scope_target:
        session["proof_scope_target"] = args.proof_scope_target
    session["updated_at"] = utc_now()

    write_session(session_path, session)
    print(
        json.dumps(
            {
                "ok": True,
                "action": "ensure",
                "agent_id": agent_id,
                "session_path": str(session_path),
                "created": len(session.get("history", [])) == 0 and session.get("current_stage") is None,
                "path_classification": session.get("path_classification"),
                "task_slug": session.get("task_slug"),
            },
            indent=2,
        )
    )
    return 0


def record_stage_command(args: argparse.Namespace) -> int:
    repo_root = repo_root_from(args.repo_root)
    agent_id = resolve_agent_id(args.agent_id)
    session_root = session_root_from(repo_root, args.session_root)
    session_path = session_path_for(session_root, agent_id)
    session = load_session(session_path)
    if session is None:
        print(
            json.dumps(
                {
                    "ok": False,
                    "action": "record-stage",
                    "agent_id": agent_id,
                    "session_path": str(session_path),
                    "failures": ["agent session does not exist; run ensure first"],
                },
                indent=2,
            )
        )
        return 1

    artifact_updates = parse_artifact_pairs(args.artifact, repo_root)
    git_head = args.git_head or current_git_head(repo_root)
    git_state = args.git_state or current_code_state(repo_root)
    session.setdefault("artifacts", {}).update(artifact_updates)
    session["current_stage"] = args.stage
    session["updated_at"] = utc_now()
    if args.path_classification:
        session["path_classification"] = args.path_classification
    if args.task_slug:
        session["task_slug"] = args.task_slug
    if args.proof_scope_target:
        session["proof_scope_target"] = args.proof_scope_target

    session.setdefault("history", []).append(
        {
            "stage": args.stage,
            "timestamp": utc_now(),
            "artifacts": artifact_updates,
            "git_head": git_head,
            "git_state": git_state,
            "note": args.note or "",
        }
    )

    write_session(session_path, session)
    print(
        json.dumps(
            {
                "ok": True,
                "action": "record-stage",
                "agent_id": agent_id,
                "session_path": str(session_path),
                "current_stage": session.get("current_stage"),
                "artifacts": session.get("artifacts", {}),
            },
            indent=2,
        )
    )
    return 0


def check_stage_command(args: argparse.Namespace) -> int:
    repo_root = repo_root_from(args.repo_root)
    agent_id = resolve_agent_id(args.agent_id)
    session_root = session_root_from(repo_root, args.session_root)
    session_path = session_path_for(session_root, agent_id)
    session = load_session(session_path)
    failures: List[str] = []

    if session is None:
        failures.append("agent session does not exist; run ensure first")
    else:
        is_quick = quick_path_allows_verify_without_review(session)
        is_closeout = closeout_path_uses_external_pr_gates(session)
        if is_quick and args.stage in QUICK_LANE_BOUNDARY_STAGES:
            failures.append(
                f"QUICK lane ends at focused verify; reclassify to STANDARD/FULL before running {args.stage}"
            )
            rules = {}
        elif is_closeout and args.stage in CLOSEOUT_STAGE_GATES:
            rules = CLOSEOUT_STAGE_GATES[args.stage]
        elif is_quick and args.stage in QUICK_STAGE_GATES:
            rules = QUICK_STAGE_GATES[args.stage]
        else:
            rules = STAGE_GATES.get(args.stage, {})
        seen_history = history_stages(session)
        for stage in rules.get("all_history", []):
            if stage not in seen_history:
                failures.append(f"missing upstream stage in this agent session: {stage}")

        if not is_quick:
            for stage in rules.get("non_quick_history", []):
                if stage not in seen_history:
                    failures.append(f"missing non-QUICK upstream stage in this agent session: {stage}")
            for artifact_key in rules.get("non_quick_artifacts", []):
                exists, stored_path = file_exists_for_artifact(repo_root, session, artifact_key)
                if not stored_path:
                    failures.append(f"missing non-QUICK artifact in this agent session: {artifact_key}")
                elif not exists:
                    failures.append(f"non-QUICK artifact path does not exist: {artifact_key} -> {stored_path}")

        for artifact_key in rules.get("artifacts", []):
            exists, stored_path = file_exists_for_artifact(repo_root, session, artifact_key)
            if not stored_path:
                failures.append(f"missing artifact in this agent session: {artifact_key}")
            elif not exists:
                failures.append(f"artifact path does not exist: {artifact_key} -> {stored_path}")

        for check_name in rules.get("checks", []):
            if check_name == "contract_locked" and not contract_is_locked(repo_root, session):
                failures.append("contract is not present and LOCKED for this agent session")
            elif check_name == "mechanical_build_packet":
                _, packet_failures = build_packet_is_mechanical(repo_root, session)
                failures.extend(packet_failures)
            elif check_name == "inline_contract":
                _, contract_failures = inline_contract_is_complete(repo_root, session)
                failures.extend(contract_failures)
            elif check_name == "closeout_receipt":
                _, receipt_failures = closeout_receipt_is_complete(
                    repo_root,
                    session,
                    args.stage,
                    args.expected_pr,
                    args.expected_base_ref,
                )
                failures.extend(receipt_failures)
            elif check_name == "review_forge_verify_order":
                _, order_failures = review_forge_verify_order_is_valid(session)
                failures.extend(order_failures)
            elif check_name == "review_forge_verify_current_code":
                _, freshness_failures = review_forge_verify_cover_current_code(repo_root, session)
                failures.extend(freshness_failures)

    ok = not failures
    print(
        json.dumps(
            {
                "ok": ok,
                "action": "check-stage",
                "stage": args.stage,
                "agent_id": agent_id,
                "session_path": str(session_path),
                "path_classification": session.get("path_classification") if session else None,
                "failures": failures,
            },
            indent=2,
        )
    )
    return 0 if ok else 1


def show_command(args: argparse.Namespace) -> int:
    repo_root = repo_root_from(args.repo_root)
    agent_id = resolve_agent_id(args.agent_id)
    session_root = session_root_from(repo_root, args.session_root)
    session_path = session_path_for(session_root, agent_id)
    session = load_session(session_path)
    if session is None:
        print(
            json.dumps(
                {
                    "ok": False,
                    "action": "show",
                    "agent_id": agent_id,
                    "session_path": str(session_path),
                    "failures": ["agent session does not exist"],
                },
                indent=2,
            )
        )
        return 1
    print(json.dumps(session, indent=2))
    return 0


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Manage agent-bound enterprise workflow session state.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    def add_common_flags(command_parser: argparse.ArgumentParser) -> None:
        command_parser.add_argument("--repo-root", default=".")
        command_parser.add_argument("--session-root", default=DEFAULT_SESSION_ROOT)
        command_parser.add_argument("--agent-id")

    ensure_parser = subparsers.add_parser("ensure")
    add_common_flags(ensure_parser)
    ensure_parser.add_argument("--path-classification")
    ensure_parser.add_argument("--task-slug")
    ensure_parser.add_argument("--proof-scope-target")
    ensure_parser.set_defaults(func=ensure_command)

    record_parser = subparsers.add_parser("record-stage")
    add_common_flags(record_parser)
    record_parser.add_argument("--stage", required=True)
    record_parser.add_argument("--artifact", action="append", default=[])
    record_parser.add_argument("--path-classification")
    record_parser.add_argument("--task-slug")
    record_parser.add_argument("--proof-scope-target")
    record_parser.add_argument("--note")
    record_parser.add_argument("--git-head")
    record_parser.add_argument("--git-state")
    record_parser.set_defaults(func=record_stage_command)

    check_parser = subparsers.add_parser("check-stage")
    add_common_flags(check_parser)
    check_parser.add_argument("--stage", required=True, choices=sorted(STAGE_GATES.keys()))
    check_parser.add_argument("--expected-pr")
    check_parser.add_argument("--expected-base-ref")
    check_parser.set_defaults(func=check_stage_command)

    show_parser = subparsers.add_parser("show")
    add_common_flags(show_parser)
    show_parser.set_defaults(func=show_command)

    return parser


def main() -> int:
    parser = build_parser()
    args = parser.parse_args()
    try:
        return args.func(args)
    except ValueError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, indent=2))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
