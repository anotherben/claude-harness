#!/usr/bin/env python3
"""Build a fail-closed enterprise intake packet from a GitHub issue."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


GH_FIELDS = (
    "number",
    "title",
    "state",
    "labels",
    "body",
    "assignees",
    "createdAt",
    "updatedAt",
    "url",
)

SOURCE_PATH_RE = re.compile(
    r"(?:`|\b)((?:apps|packages|scripts|tools|docs|tests|src|server|client)/"
    r"[A-Za-z0-9_.\-/]+(?::\d+)?)",
)
STACK_FRAME_RE = re.compile(r"\(([^()\s]+?\.(?:js|ts|tsx|mjs|cjs):\d+)(?::\d+)?\)")

RISK_PATTERNS: dict[str, re.Pattern[str]] = {
    "production_log": re.compile(r"\b(?:render production|production logs?|live logs?)\b", re.I),
    "schema_query_data": re.compile(
        r"\b(?:databaseerror|sql|postgres|numeric|insert|update|delete|upsert|migration|"
        r"schema|table|column|query|returning|affected row)\b",
        re.I,
    ),
    "external_integration": re.compile(r"\b(?:shopify|rex|webhook|external integration|supplier)\b", re.I),
    "concurrency_or_transaction": re.compile(r"\b(?:lock|transaction|underlock|race|concurrent)\b", re.I),
    "money_pricing_inventory": re.compile(r"\b(?:price|pricing|money|invoice|inventory|order|stock)\b", re.I),
    "suggested_fix_present": re.compile(r"\b(?:fix|smallest safe fix|alternative|clamp|widen)\b", re.I),
}


def run_gh_issue_view(repo: str, issue: str) -> dict[str, Any]:
    command = [
        "gh",
        "issue",
        "view",
        issue,
        "--repo",
        repo,
        "--json",
        ",".join(GH_FIELDS),
    ]
    try:
        output = subprocess.check_output(command, text=True, stderr=subprocess.STDOUT)
    except FileNotFoundError:
        raise SystemExit("gh command not found; cannot fetch GitHub issue intake")
    except subprocess.CalledProcessError as exc:
        raise SystemExit(f"gh issue view failed:\n{exc.output.strip()}")
    try:
        data = json.loads(output)
    except json.JSONDecodeError as exc:
        raise SystemExit(f"gh issue view returned invalid JSON: {exc}")
    if not isinstance(data, dict):
        raise SystemExit("gh issue view returned non-object JSON")
    return data


def label_names(issue: dict[str, Any]) -> list[str]:
    labels = issue.get("labels") or []
    names: list[str] = []
    for label in labels:
        if isinstance(label, dict) and label.get("name"):
            names.append(str(label["name"]))
    return names


def extract_source_targets(body: str) -> list[str]:
    targets: set[str] = set()
    for match in SOURCE_PATH_RE.finditer(body):
        targets.add(match.group(1).rstrip("`),."))
    for match in STACK_FRAME_RE.finditer(body):
        targets.add(match.group(1).rstrip("`),."))
    return sorted(targets)


def classify_risk(issue: dict[str, Any], labels: list[str], source_targets: list[str]) -> dict[str, Any]:
    body = str(issue.get("body") or "")
    title = str(issue.get("title") or "")
    text = f"{title}\n{body}"
    lower_labels = {label.lower() for label in labels}
    risk_flags = sorted(name for name, pattern in RISK_PATTERNS.items() if pattern.search(text))
    is_bug = "bug" in lower_labels or "bug" in title.lower()
    is_ready = "ready-for-agent" in lower_labels or "ready for agent" in lower_labels
    high_risk = bool(
        {
            "production_log",
            "schema_query_data",
            "external_integration",
            "concurrency_or_transaction",
            "money_pricing_inventory",
        }
        & set(risk_flags)
    )
    if str(issue.get("state", "")).upper() != "OPEN":
        route = "NO_EDIT_VERIFY_ISSUE_STATE"
    elif is_bug and high_risk:
        route = "DEBUG_THEN_STANDARD_AFTER_SOURCE_VERIFICATION"
    elif is_bug:
        route = "DEBUG_OR_STANDARD_AFTER_SOURCE_VERIFICATION"
    elif is_ready and source_targets:
        route = "STANDARD_AFTER_SOURCE_VERIFICATION"
    else:
        route = "DISCOVER_OR_BRAINSTORM_BEFORE_PLAN"
    return {
        "labels_normalized": sorted(lower_labels),
        "is_bug": is_bug,
        "is_ready_for_agent": is_ready,
        "high_risk": high_risk,
        "risk_flags": risk_flags,
        "recommended_enterprise_route": route,
        "issue_body_is_proof": False,
    }


def build_packet(repo: str, issue_id: str, issue: dict[str, Any]) -> dict[str, Any]:
    body = str(issue.get("body") or "")
    labels = label_names(issue)
    source_targets = extract_source_targets(body)
    risk = classify_risk(issue, labels, source_targets)
    return {
        "packet_type": "enterprise_github_issue_intake",
        "generated_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "repo": repo,
        "issue": {
            "number": issue.get("number") or issue_id,
            "title": issue.get("title"),
            "state": issue.get("state"),
            "url": issue.get("url"),
            "labels": labels,
            "assignees": issue.get("assignees") or [],
            "created_at": issue.get("createdAt"),
            "updated_at": issue.get("updatedAt"),
        },
        "risk": risk,
        "source_read_targets": source_targets,
        "required_next_steps": [
            "Treat the issue body as intake, not proof.",
            "Verify issue state, labels, and URL live before planning or build.",
            "Read every source_read_target and current consumers before accepting root cause.",
            "For schema/query/data-sensitive claims, require current code plus local/dev DB or migrated integration proof.",
            "For suggested fixes, compare issue proposal against at least one alternative and lock the decision in plan/contract.",
            "Do not begin source edits until the enterprise path, agent session, plan/contract or QUICK packet, and required gates allow it.",
        ],
        "issue_body_excerpt": body[:4000],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo", required=True, help="GitHub repository, for example anotherben/helpdesk")
    parser.add_argument("--issue", required=True, help="GitHub issue number")
    parser.add_argument("--output", type=Path, help="Optional output JSON path")
    parser.add_argument("--json", action="store_true", help="Print JSON packet")
    args = parser.parse_args()

    issue = run_gh_issue_view(args.repo, args.issue)
    packet = build_packet(args.repo, args.issue, issue)
    text = json.dumps(packet, indent=2, sort_keys=True)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    if args.json or not args.output:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
