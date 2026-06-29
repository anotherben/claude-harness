#!/usr/bin/env python3
import json
import sys
from pathlib import Path


REQUIRED_COVERAGE = {
    "source_truth_before_action",
    "root_cause_not_symptom",
    "blast_radius_and_ownership",
    "schema_live_db_not_mock_or_diff",
    "headless_ui_pdf_file_proof",
    "governed_artifact_scope",
    "srp_refactor_classification",
    "edge_cases_and_failure_modes",
    "verification_proof_level",
    "enterprise_routing_before_edits",
    "enterprise_forge_before_verify",
    "broader_context_workflow_business",
    "zoom_out_broader_system_map",
    "state_status_lifecycle_sweep",
    "read_only_planner_no_edits",
    "plan_review_quality",
    "plan_readiness_stop",
    "alternatives_contrarian",
}


def main() -> int:
    skill_root = Path(__file__).resolve().parents[1]
    eval_path = skill_root / "evals" / "evals.json"
    data = json.loads(eval_path.read_text())

    errors = []
    evals = data.get("evals", [])
    if len(evals) < 6:
        errors.append(f"expected at least 6 evals, found {len(evals)}")

    declared = set(data.get("definition_of_100_percent", []))
    missing_declared = REQUIRED_COVERAGE - declared
    if missing_declared:
        errors.append("definition_of_100_percent missing: " + ", ".join(sorted(missing_declared)))

    covered = set()
    for item in evals:
        item_id = item.get("id", "<missing-id>")
        for field in ("prompt", "expected_output"):
            if not str(item.get(field, "")).strip():
                errors.append(f"{item_id}: missing {field}")
        assertions = item.get("assertions", [])
        if not assertions:
            errors.append(f"{item_id}: missing assertions")
        for assertion in assertions:
            assertion_id = assertion.get("id")
            if assertion_id:
                covered.add(assertion_id)
            terms = assertion.get("must_include", [])
            if not assertion_id:
                errors.append(f"{item_id}: assertion missing id")
            if not terms or not all(str(term).strip() for term in terms):
                errors.append(f"{item_id}: assertion {assertion_id} missing must_include terms")

    missing_coverage = REQUIRED_COVERAGE - covered
    if missing_coverage:
        errors.append("assertion coverage missing: " + ", ".join(sorted(missing_coverage)))

    if errors:
        print("FAIL")
        for error in errors:
            print(f"- {error}")
        return 1

    print("PASS")
    print(f"evals={len(evals)}")
    print("coverage=" + ",".join(sorted(covered)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
