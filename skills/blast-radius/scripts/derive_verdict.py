#!/usr/bin/env python3
"""Derive a blast-radius verdict from explicit risk flags."""

from __future__ import annotations

import argparse


def nonnegative_int(value: str) -> int:
    parsed = int(value)
    if parsed < 0:
        raise argparse.ArgumentTypeError("value must be non-negative")
    return parsed


def derive_verdict(args: argparse.Namespace) -> tuple[str, list[str]]:
    reasons: list[str] = []

    if args.unresolved_threads > 0:
        reasons.append(f"{args.unresolved_threads} unresolved PR review thread(s)")
        return "DO NOT MERGE / REVIEW THREADS OPEN", reasons

    if args.critical > 0:
        reasons.append(f"{args.critical} CRITICAL finding(s)")
    if args.high > 0:
        reasons.append(f"{args.high} HIGH finding(s)")
    if args.prior_unclosed in {"critical", "high"}:
        reasons.append(f"prior unclosed {args.prior_unclosed.upper()} finding")
    if args.untested_important == "do_not_merge":
        reasons.append("important untested adversarial cell on a merge-blocking boundary")

    if reasons:
        return "DO NOT MERGE", reasons

    if args.medium > 0:
        reasons.append(f"{args.medium} MEDIUM finding(s)")
    if args.prior_unclosed == "medium":
        reasons.append("prior unclosed MEDIUM finding")
    if args.live_schema == "blocked":
        reasons.append("live schema verification blocked")
    if args.untested_important == "review":
        reasons.append("important untested adversarial cell")
    if args.mandatory_patterns == "failed":
        reasons.append("mandatory pattern sweep incomplete or failed")

    if reasons:
        return "NEEDS REVIEW", reasons

    return "SAFE TO PROCEED", [
        "no CRITICAL/HIGH/MEDIUM findings, mandatory patterns passed, and required proof is complete"
    ]


def recommend_diagnose_status(args: argparse.Namespace, verdict: str) -> tuple[str, list[str]]:
    blockers: list[str] = []
    if args.unresolved_threads > 0:
        blockers.append(f"unresolved_threads={args.unresolved_threads}")
    if args.live_schema == "blocked":
        blockers.append("live_schema=blocked")
    if args.untested_important != "none":
        blockers.append(f"untested_important={args.untested_important}")
    if args.mandatory_patterns == "failed":
        blockers.append("mandatory_patterns=failed")
    if args.prior_unclosed != "none":
        blockers.append(f"prior_unclosed={args.prior_unclosed}")

    if blockers:
        return "blocked", blockers

    if args.critical > 0 or args.high > 0 or args.medium > 0:
        evidence = []
        if args.critical > 0:
            evidence.append(f"critical={args.critical}")
        if args.high > 0:
            evidence.append(f"high={args.high}")
        if args.medium > 0:
            evidence.append(f"medium={args.medium}")
        return "root_cause_ready", evidence

    if verdict == "SAFE TO PROCEED":
        return "fixed_pending_verify", ["no blocking blast-radius findings"]

    return "blocked", ["verdict did not map cleanly"]


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Apply blast-radius verdict precedence mechanically.",
    )
    parser.add_argument("--critical", type=nonnegative_int, default=0)
    parser.add_argument("--high", type=nonnegative_int, default=0)
    parser.add_argument("--medium", type=nonnegative_int, default=0)
    parser.add_argument("--low", type=nonnegative_int, default=0)
    parser.add_argument(
        "--live-schema",
        choices=("verified", "blocked", "not_applicable"),
        default="not_applicable",
    )
    parser.add_argument("--unresolved-threads", type=nonnegative_int, default=0)
    parser.add_argument(
        "--prior-unclosed",
        choices=("none", "medium", "high", "critical"),
        default="none",
    )
    parser.add_argument(
        "--untested-important",
        choices=("none", "review", "do_not_merge"),
        default="none",
    )
    parser.add_argument(
        "--mandatory-patterns",
        choices=("passed", "failed"),
        default="passed",
    )
    parser.add_argument(
        "--emit-diagnose-status",
        action="store_true",
        help="Also print a diagnose.build_packet.v1 status recommendation for handoffs.",
    )
    args = parser.parse_args()

    verdict, reasons = derive_verdict(args)
    print(f"Verdict: {verdict}")
    print("Rationale: " + "; ".join(reasons))
    if args.emit_diagnose_status:
        status, evidence = recommend_diagnose_status(args, verdict)
        print(f"Diagnose status recommendation: {status}")
        print("Blocking evidence: " + "; ".join(evidence))


if __name__ == "__main__":
    main()
