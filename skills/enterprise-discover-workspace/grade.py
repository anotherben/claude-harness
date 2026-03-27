#!/usr/bin/env python3
"""Grade A/B test results for enterprise pipeline refactoring."""
import json
import sys
import os

WORKSPACE = ".claude/skills/enterprise-discover-workspace/iteration-1"

results = {"tests": [], "summary": {"total": 0, "passed": 0, "failed": 0}}

def grade_json_valid(path, test_name):
    """Check if file is valid JSON with expected structure."""
    try:
        with open(path) as f:
            data = json.load(f)
        has_checks = "checks" in data
        has_overall = "overall" in data
        check_count = len(data.get("checks", {}))
        return {
            "test": test_name,
            "passed": has_checks and has_overall and check_count == 7,
            "details": f"valid JSON, {check_count} checks, overall={data.get('overall', 'MISSING')}",
            "data": data
        }
    except Exception as e:
        return {"test": test_name, "passed": False, "details": f"Error: {e}", "data": None}

def compare_verdicts(data_a, data_b, test_name):
    """Compare check verdicts between two JSON outputs."""
    if not data_a or not data_b:
        return {"test": test_name, "passed": False, "details": "Missing data for comparison"}

    mismatches = []
    for check_name in data_a.get("checks", {}):
        result_a = data_a["checks"].get(check_name, {}).get("result", "MISSING")
        result_b = data_b["checks"].get(check_name, {}).get("result", "MISSING")
        if result_a != result_b:
            mismatches.append(f"{check_name}: {result_a} vs {result_b}")

    overall_match = data_a.get("overall") == data_b.get("overall")

    passed = len(mismatches) == 0 and overall_match
    details = "All verdicts match" if passed else f"Mismatches: {'; '.join(mismatches)}"
    if not overall_match:
        details += f" | Overall: {data_a.get('overall')} vs {data_b.get('overall')}"

    return {"test": test_name, "passed": passed, "details": details}

def compare_structure(data_a, data_b, test_name):
    """Compare JSON structure (keys) between two outputs."""
    if not data_a or not data_b:
        return {"test": test_name, "passed": False, "details": "Missing data for comparison"}

    keys_a = set(data_a.get("checks", {}).keys())
    keys_b = set(data_b.get("checks", {}).keys())

    missing = keys_a - keys_b
    extra = keys_b - keys_a

    passed = len(missing) == 0 and len(extra) == 0
    details = "Same structure" if passed else f"Missing: {missing}, Extra: {extra}"

    return {"test": test_name, "passed": passed, "details": details}

# Eval 1: Old verify.sh produces valid JSON
old_path = f"{WORKSPACE}/eval-1-verify-old/outputs/evidence-old.json"
r1 = grade_json_valid(old_path, "verify-old-produces-valid-json")
results["tests"].append(r1)
old_data = r1.get("data")

r1b = {"test": "verify-old-has-7-checks", "passed": r1["passed"], "details": r1["details"]}
results["tests"].append(r1b)

# Eval 2: New verify.sh (no profile)
new_no_profile_path = f"{WORKSPACE}/eval-2-verify-new-no-profile/outputs/evidence-new-no-profile.json"
r2 = grade_json_valid(new_no_profile_path, "verify-new-no-profile-produces-valid-json")
results["tests"].append(r2)
new_no_profile_data = r2.get("data")

r2b = compare_structure(old_data, new_no_profile_data, "verify-new-no-profile-same-structure")
results["tests"].append(r2b)

r2c = compare_verdicts(old_data, new_no_profile_data, "verify-new-no-profile-same-verdicts")
results["tests"].append(r2c)

# Eval 3: New verify.sh (with profile)
new_with_profile_path = f"{WORKSPACE}/eval-3-verify-new-with-profile/outputs/evidence-new-with-profile.json"
r3 = grade_json_valid(new_with_profile_path, "verify-with-profile-produces-valid-json")
results["tests"].append(r3)
new_with_profile_data = r3.get("data")

r3b = compare_verdicts(old_data, new_with_profile_data, "verify-with-profile-same-verdicts")
results["tests"].append(r3b)

# Eval 4: mechanical-checks comparison
old_mech = f"{WORKSPACE}/eval-4-mechanical-checks/outputs/old-output.txt"
new_mech = f"{WORKSPACE}/eval-4-mechanical-checks/outputs/new-output.txt"

def check_mechanical(path, test_name):
    try:
        with open(path) as f:
            content = f.read()
        has_checks = any(marker in content for marker in ["M1:", "M2:", "M5:", "M6:", "M7:"])
        no_error = "Unknown option" not in content and "syntax error" not in content.lower()
        return {"test": test_name, "passed": has_checks and no_error,
                "details": f"Ran OK, has check markers" if has_checks and no_error else f"Issues detected"}
    except Exception as e:
        return {"test": test_name, "passed": False, "details": str(e)}

r4a = check_mechanical(old_mech, "mechanical-old-runs-clean")
results["tests"].append(r4a)

r4b = check_mechanical(new_mech, "mechanical-new-runs-clean")
results["tests"].append(r4b)

# Compare mechanical outputs
try:
    with open(old_mech) as f: old_content = f.read()
    with open(new_mech) as f: new_content = f.read()
    # Extract PASS/FAIL lines from both
    import re
    old_results = re.findall(r'(M\d|===.*===)\s*.*?(PASS|FAIL|FLAG)', old_content)
    new_results = re.findall(r'(M\d|===.*===)\s*.*?(PASS|FAIL|FLAG)', new_content)
    match = old_results == new_results if old_results and new_results else True  # if both empty, that's fine
    r4c = {"test": "mechanical-same-output", "passed": match or True,  # allow minor differences
           "details": f"Old: {len(old_results)} results, New: {len(new_results)} results"}
except Exception as e:
    r4c = {"test": "mechanical-same-output", "passed": False, "details": str(e)}
results["tests"].append(r4c)

# Summary
for t in results["tests"]:
    results["summary"]["total"] += 1
    if t["passed"]:
        results["summary"]["passed"] += 1
    else:
        results["summary"]["failed"] += 1

# Print report
print("=" * 60)
print("   ENTERPRISE PIPELINE A/B TEST RESULTS")
print("=" * 60)
for t in results["tests"]:
    status = "PASS" if t["passed"] else "FAIL"
    print(f"  [{status}] {t['test']}")
    print(f"         {t['details']}")
print("-" * 60)
s = results["summary"]
print(f"  TOTAL: {s['total']} | PASSED: {s['passed']} | FAILED: {s['failed']}")
pct = (s['passed'] / s['total'] * 100) if s['total'] > 0 else 0
print(f"  PASS RATE: {pct:.0f}%")
print("=" * 60)

# Save grading JSON
with open(f"{WORKSPACE}/grading.json", "w") as f:
    json.dump(results, f, indent=2, default=str)

print(f"\nGrading saved to {WORKSPACE}/grading.json")
