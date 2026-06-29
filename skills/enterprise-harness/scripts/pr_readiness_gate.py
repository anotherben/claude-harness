#!/usr/bin/env python3
"""Headless PR readiness gate for high-risk and Copilot/advisory state."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from pathlib import Path
from typing import Any

from proof_utils import collect_records, load_receipts, read_text_files, receipt_errors, unsafe_secret_or_db_labels
from validate_release_readiness import validate_text as validate_release_readiness_text


DEFAULT_ADVISORY_TERMS = {
    "auth",
    "csrf",
    "data loss",
    "invoice",
    "inventory",
    "order",
    "payment",
    "permission",
    "schema",
    "security",
    "sql",
    "tenant",
    "xss",
}

FAILED_PROOF_PATTERNS = (
    re.compile(r"\bPARTIALLY\s+PROVED\b", re.IGNORECASE),
    re.compile(r"\bUNPROVED\b", re.IGNORECASE),
    re.compile(r"\bDO\s+NOT\s+CLAIM\s+FIXED\b", re.IGNORECASE),
    re.compile(r"\bgate[_ -]?result\s*[:=]\s*[\"']?FAIL\b", re.IGNORECASE),
    re.compile(r"/(?:Users|home)/[^\s`'\"<>]+", re.IGNORECASE),
    re.compile(r"\b(?:PATH|NODE_PATH)\s*=", re.IGNORECASE),
    re.compile(r"\b(?:Remaining\s+Before\s+Merge|Create\s+PR\s+with\s+wrapper)\b", re.IGNORECASE),
    re.compile(r"\{STAMP\}|\bNo\s+PR\s+exists\s+yet\b", re.IGNORECASE),
    re.compile(r"\btests?\s+ran\s+against\s+production\b|\bproduction\s+database\s+url\b", re.IGNORECASE),
    re.compile(r"\bprod(?:uction)?\s+(?:dump|backup)\s+(?:committed|checked\s+in|in\s+repo)\b", re.IGNORECASE),
    re.compile(r"\b(?:postgresql?|postgres)://[^\s`'\"<>]+", re.IGNORECASE),
    re.compile(r"\bPGPASSWORD\s*=", re.IGNORECASE),
    re.compile(r"\.pgpass\b", re.IGNORECASE),
    re.compile(r"\b(?:primary|prod|production)\s+(?:db|database|snapshot|clone|dump|backup)\b", re.IGNORECASE),
)

CAMEL_BOUNDARY_RE = re.compile(r"(?<=[a-z0-9])(?=[A-Z])")
TOKEN_RE = re.compile(r"[A-Za-z0-9]+")


def run_json(command: list[str]) -> Any:
    try:
        output = subprocess.check_output(command, text=True, stderr=subprocess.STDOUT)
    except FileNotFoundError:
        raise SystemExit(f"required command not found: {command[0]}")
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"command failed: {' '.join(command)}\n{exc.output.strip()}")
    try:
        return json.loads(output)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"command did not return JSON: {' '.join(command)}: {exc}")


def repo_slug(explicit: str | None) -> tuple[str, str]:
    if explicit:
        owner, name = explicit.split("/", 1)
        return owner, name
    data = run_json(["gh", "repo", "view", "--json", "owner,name"])
    return data["owner"]["login"], data["name"]


def pr_number(value: str | None) -> int:
    if value:
        match = re.search(r"(\d+)(?:$|[/?#])", value)
        if not match:
            raise SystemExit(f"could not parse PR number from {value!r}")
        return int(match.group(1))
    data = run_json(["gh", "pr", "view", "--json", "number"])
    return int(data["number"])


def pr_threads(owner: str, name: str, number: int) -> dict[str, Any]:
    query = """
query($owner:String!, $name:String!, $number:Int!) {
  repository(owner:$owner, name:$name) {
    pullRequest(number:$number) {
      number
      isDraft
      headRefOid
      baseRefOid
      reviewDecision
      mergeStateStatus
      files(first:100) { nodes { path } }
      reviewThreads(first:100) {
        nodes {
          id
          isResolved
          isOutdated
          comments(first:20) {
            nodes {
              author { login }
              body
              path
              originalLine
            }
          }
        }
      }
    }
  }
}
"""
    data = run_json(
        [
            "gh",
            "api",
            "graphql",
            "-f",
            f"query={query}",
            "-F",
            f"owner={owner}",
            "-F",
            f"name={name}",
            "-F",
            f"number={number}",
        ]
    )
    pr = data.get("data", {}).get("repository", {}).get("pullRequest")
    if not pr:
        raise SystemExit(f"PR not found: {owner}/{name}#{number}")
    return pr


def load_repo_profile(path: Path) -> dict[str, Any]:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
    except FileNotFoundError:
        raise SystemExit(f"missing repo profile for PR risk classification: {path}")
    except json.JSONDecodeError as exc:
        raise SystemExit(f"invalid repo profile JSON: {path}: {exc}")
    if not isinstance(data, dict):
        raise SystemExit(f"repo profile must be a JSON object: {path}")
    return data


def fallback_risk_classes(profile: dict[str, Any]) -> list[dict[str, Any]]:
    high_risk_domains = [
        str(item).strip()
        for item in profile.get("domains", {}).get("high_risk", [])
        if str(item).strip()
    ]
    if not high_risk_domains:
        return []
    return [
        {
            "name": "repo-high-risk-domains",
            "path_patterns": [re.escape(domain).replace("\\-", "[-_/]") for domain in high_risk_domains],
            "advisory_terms": high_risk_domains,
        }
    ]


def risk_classes_from_profile(profile: dict[str, Any]) -> list[dict[str, Any]]:
    raw = profile.get("pr_readiness", {}).get("risk_classes", [])
    if raw is None:
        raw = []
    if not isinstance(raw, list):
        raise SystemExit("repo_profile.pr_readiness.risk_classes must be a list")
    classes = [item for item in raw if isinstance(item, dict)]
    classes = classes or fallback_risk_classes(profile)
    if not classes:
        raise SystemExit("repo profile has no PR risk classes and no domains.high_risk fallback")
    return classes


def compile_pattern(pattern: str, class_name: str) -> re.Pattern[str]:
    try:
        return re.compile(pattern, re.IGNORECASE)
    except re.error as exc:
        raise SystemExit(f"invalid risk path pattern in {class_name}: {pattern}: {exc}")


def path_tokens(path: str) -> set[str]:
    expanded = CAMEL_BOUNDARY_RE.sub(" ", path)
    tokens = {token.lower() for token in TOKEN_RE.findall(expanded)}
    singulars = {token[:-1] for token in tokens if len(token) > 3 and token.endswith("s")}
    return tokens | singulars


def class_matches_path(path: str, risk_class: dict[str, Any]) -> bool:
    class_name = str(risk_class.get("name", "unnamed-risk-class")).strip()
    patterns = risk_class.get("path_patterns", [])
    if not isinstance(patterns, list):
        raise SystemExit(f"risk class {class_name} path_patterns must be a list")
    for pattern in patterns:
        if compile_pattern(str(pattern), class_name).search(path):
            return True

    terms = risk_class.get("path_terms", [])
    if terms is None:
        terms = []
    if not isinstance(terms, list):
        raise SystemExit(f"risk class {class_name} path_terms must be a list")
    normalized_terms = {str(term).strip().lower() for term in terms if str(term).strip()}
    return bool(normalized_terms.intersection(path_tokens(path)))


def classify_high_risk_paths(files: list[str], classes: list[dict[str, Any]]) -> tuple[list[str], list[dict[str, Any]]]:
    high_risk_paths: list[str] = []
    details: list[dict[str, Any]] = []
    for path in files:
        matched_classes: list[str] = []
        for risk_class in classes:
            class_name = str(risk_class.get("name", "unnamed-risk-class")).strip()
            if class_matches_path(path, risk_class):
                matched_classes.append(class_name)
        if matched_classes:
            high_risk_paths.append(path)
            details.append({"path": path, "risk_classes": sorted(set(matched_classes))})
    return high_risk_paths, details


def advisory_terms_from_profile(classes: list[dict[str, Any]]) -> set[str]:
    terms = set(DEFAULT_ADVISORY_TERMS)
    for risk_class in classes:
        for term in risk_class.get("advisory_terms", []) or []:
            value = str(term).strip().lower()
            if value:
                terms.add(value)
    return terms


def advisory_is_correctness_risk(thread: dict[str, Any], terms: set[str]) -> bool:
    text = thread_text(thread).lower()
    return any(term in text for term in terms)


def is_copilot_thread(thread: dict[str, Any]) -> bool:
    comments = thread.get("comments", {}).get("nodes", [])
    authors = [str(comment.get("author", {}).get("login", "")).lower() for comment in comments]
    return any("copilot" in author or "github-actions" in author for author in authors)


def thread_text(thread: dict[str, Any]) -> str:
    comments = thread.get("comments", {}).get("nodes", [])
    return "\n".join(str(comment.get("body", "")) for comment in comments)


def readiness_record(evidence_paths: list[Path]) -> dict[str, Any] | None:
    if not evidence_paths:
        return None
    text = read_text_files(evidence_paths)
    records = collect_records(text, ("enterprise_pr_readiness", "pr_readiness"))
    return records[0] if records else None


def main() -> int:
    parser = argparse.ArgumentParser(description="Fail if PR readiness, review threads, or advisory routing is unsafe.")
    parser.add_argument("--pr", help="PR number or URL. Defaults to current branch PR.")
    parser.add_argument("--repo", help="owner/name. Defaults to current gh repo.")
    parser.add_argument(
        "--repo-profile",
        type=Path,
        default=Path(".codex/enterprise-state/repo-profile.json"),
        help="Repo profile containing pr_readiness.risk_classes.",
    )
    parser.add_argument("--evidence", action="append", type=Path, default=[])
    parser.add_argument(
        "--receipt-log",
        action="append",
        type=Path,
        default=[],
        help="Optional JSONL command receipts. Required for high-risk non-draft open exceptions.",
    )
    args = parser.parse_args()

    owner, name = repo_slug(args.repo)
    number = pr_number(args.pr)
    pr = pr_threads(owner, name, number)
    files = [node["path"] for node in pr.get("files", {}).get("nodes", [])]
    profile = load_repo_profile(args.repo_profile)
    risk_classes = risk_classes_from_profile(profile)
    high_risk_paths, high_risk_details = classify_high_risk_paths(files, risk_classes)
    advisory_terms = advisory_terms_from_profile(risk_classes)
    unresolved = [
        thread
        for thread in pr.get("reviewThreads", {}).get("nodes", [])
        if not thread.get("isResolved") and not thread.get("isOutdated")
    ]
    unresolved_blocking = [thread for thread in unresolved if not is_copilot_thread(thread)]
    unresolved_advisory = [thread for thread in unresolved if is_copilot_thread(thread)]
    risky_advisory = [thread for thread in unresolved_advisory if advisory_is_correctness_risk(thread, advisory_terms)]
    record = readiness_record(args.evidence)
    receipts = load_receipts(args.receipt_log) if args.receipt_log else {}
    missing: list[str] = []
    evidence_text = read_text_files(args.evidence) if args.evidence else ""
    failed_evidence = [pattern.pattern for pattern in FAILED_PROOF_PATTERNS if pattern.search(evidence_text)]
    failed_evidence.extend(unsafe_secret_or_db_labels(evidence_text))
    if failed_evidence:
        missing.append("evidence contains partial/unproved/failed/unsafe proof state")
    if args.evidence:
        release_readiness = validate_release_readiness_text(
            evidence_text,
            "PR readiness evidence",
            expected_head=pr.get("headRefOid"),
            expected_base_sha=pr.get("baseRefOid"),
        )
        if release_readiness.get("result") != "PASS":
            missing.append(
                "passing release readiness evidence: "
                + "; ".join(str(item) for item in release_readiness.get("missing", []))
            )

    if unresolved_blocking:
        missing.append(f"{len(unresolved_blocking)} unresolved non-advisory review thread(s)")
    if risky_advisory:
        missing.append(f"{len(risky_advisory)} unresolved Copilot/advisory correctness-risk thread(s)")

    if record is None:
        if high_risk_paths or unresolved_advisory:
            missing.append("structured enterprise_pr_readiness evidence")
    else:
        record_head = str(record.get("head_sha", "")).strip()
        if record_head != pr.get("headRefOid"):
            missing.append("enterprise_pr_readiness head_sha matches current PR head")
        record_base = str(record.get("base_sha") or record.get("base_ref_oid") or "").strip()
        if record_base != pr.get("baseRefOid"):
            missing.append("enterprise_pr_readiness base_sha matches current PR base")
        mode = str(record.get("mode", "")).strip()
        if mode not in {"normal-open", "high-risk-draft", "advisory-harvest", "not-applicable"}:
            missing.append("valid PR readiness mode")
        advisory_disposition = str(record.get("advisory_disposition", "")).strip()
        if unresolved_advisory and not advisory_disposition:
            missing.append("advisory_disposition for Copilot/advisory comments")
        if high_risk_paths and not pr.get("isDraft"):
            open_exception = str(record.get("open_exception", "")).strip()
            gate_evidence = record.get("gate_evidence")
            if not open_exception:
                missing.append("open_exception for high-risk non-draft PR")
            if not isinstance(gate_evidence, list) or not gate_evidence:
                missing.append("gate_evidence for high-risk non-draft PR")
            if not args.receipt_log:
                missing.append("receipt-log for high-risk non-draft PR gate evidence")
            else:
                missing.extend(receipt_errors(record, receipts, pr.get("headRefOid")))

    result = {
        "result": "FAIL" if missing else "PASS",
        "repo": f"{owner}/{name}",
        "pr": number,
        "head_sha": pr.get("headRefOid"),
        "base_sha": pr.get("baseRefOid"),
        "is_draft": pr.get("isDraft"),
        "merge_state": pr.get("mergeStateStatus"),
        "review_decision": pr.get("reviewDecision"),
        "high_risk_paths": high_risk_paths,
        "high_risk_details": high_risk_details,
        "risk_classes_loaded": [str(item.get("name", "unnamed-risk-class")) for item in risk_classes],
        "unresolved_blocking_threads": [thread.get("id") for thread in unresolved_blocking],
        "unresolved_advisory_threads": [thread.get("id") for thread in unresolved_advisory],
        "missing": missing,
    }
    print(json.dumps(result, indent=2))
    return 1 if missing else 0


if __name__ == "__main__":
    sys.exit(main())
