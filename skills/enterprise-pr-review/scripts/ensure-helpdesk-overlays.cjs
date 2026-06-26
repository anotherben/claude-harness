#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const args = new Set(process.argv.slice(2));
const checkOnly = args.has("--check");

function runGit(args) {
  return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function findRepoRoot() {
  try {
    return runGit(["rev-parse", "--show-toplevel"]);
  } catch {
    return null;
  }
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function isHelpdeskRepo(repoRoot) {
  if (!repoRoot) {
    return false;
  }
  const packageJson = readJsonIfExists(path.join(repoRoot, "package.json"));
  if (packageJson?.name === "hunt-the-night-platform") {
    return true;
  }
  const profile = readJsonIfExists(path.join(repoRoot, ".codex", "enterprise-state", "repo-profile.json"));
  return profile?.repo_slug === "helpdesk" || profile?.repo_display_name === "Helpdesk";
}

function writeFileIfNeeded(filePath, content, changes) {
  const current = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : null;
  if (current === content) {
    return;
  }
  changes.push(path.relative(process.cwd(), filePath));
  if (!checkOnly) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, content, "utf8");
  }
}

const sharedHardRules = `## Required Context

- Read \`.codex/enterprise-state/repo-profile.json\`
- Read \`.codex/enterprise-state/repo-traps.json\`
- Read \`.codex/enterprise-state/repo-best-practices.json\` if it exists
- Read \`.codex/enterprise-state/local-machine.json\` only when command availability or this computer matters
- Read your own gitignored agent-session file under \`.codex/enterprise-state/agent-sessions/<agent-id>.json\` once stage work begins

## Repo-Local Hard Rules

- Use the GPT-5.5 fresh baseline: outcome, success criteria, constraints, evidence, and stop rules come before legacy prompt ceremony.
- It is acceptable for planning and contract work to consume most of the lane when schema, tenant, identity, workflow, or file-boundary proof is unclear.
- Schema, query, and data-sensitive claims require current runtime code reads plus live/integration database proof. Mock-only proof, migration-only proof, and diff-only proof do not count.
- All verification and browser work must be headless. Manual GUI proof is supporting context only, never completion evidence.
- Mirror required CI and repo-specific local gates before PR, using commands from the current repository profile or repo-local config rather than assuming a fixed command list.
- Repo-local overlay freshness must be proven by \`.codex/repo-skills/*-manifest.json\` hashes. If the manifest is stale, rerun discover before relying on overlays.
- Codex headless is the default enterprise worker runtime for delegated build, review, forge, and verify slices. Probe \`codex mcp list --json\` before dispatch and fail closed if required MCP servers are missing.
- Do not use cmux panes, OpenCode, Kimi, or other runtimes as primary enterprise automation unless MCP, skills, repo policy, and structured-output parity are proven for this repo.
- Delegated worker prompts must be compact packet files with stage, PC/lens ids, owned paths, forbidden paths, required commands, output paths, and stop rules. Do not pass a whole chat transcript.
- Repo-local gate commands from the committed repo profile: \`node scripts/enterprise-delivery-gate.cjs\` for enterprise-delivery-gate (before PR or final review); \`GITHUB_BASE_REF=dev node scripts/ci/ensureNoNewMockTests.cjs\` for no-new-mock gate (when test files change); \`node scripts/db-write-enforcement.cjs --base origin/dev --head HEAD --event pull_request\` for DB ownership gate (when SQL or write paths change); \`node scripts/review/local-review.cjs --live-db required\` for live-proof review gate (when changed paths require live proof).
- If CI or a local gate forces a code pivot, prior review/forge evidence for affected files expires. Re-run the attack on the current final diff.
- If merge blockers, PR body requirements, live-proof commands, or ownership gates are unknown, stop before build instead of learning them from failed CI.
- Apply the PR reviewer trap matrix when relevant: migration runner compatibility, SQL literal/precedence/sargability/type hazards, atomic concurrency/idempotence, state-transition metadata cleanup, live-test safety, mock shape vs real query shape, UI/rendered-output parity and escaping, exact docs/contracts/paths, valid falsy values, and original-vs-transformed identity fields.
`;

function overlaySkill({ name, title, description, targetSkill, extraRules }) {
  return `---
name: ${name}
description: ${description}
---
# ${title}

Repo-local overlay for the Helpdesk repository.

Generated/refreshable by \`enterprise-pr-review/scripts/ensure-helpdesk-overlays.cjs\`.

## Global Precheck

Before reading further, writing artifacts, delegating, or changing files, run:

\`\`\`bash
enterprise-precheck --skill ${name}
\`\`\`

If it exits non-zero, stop and report stderr verbatim. Do not hand-craft packet files or evidence markers to bypass it.

${sharedHardRules}${extraRules}
## Required Workflow

1. Resolve commands, relative paths, workspace packages, and source-of-truth docs from the committed repo profile.
2. If the committed profile is missing, stale, or contradicted by reality, run the repo-local discover wrapper first.
3. Invoke \`${targetSkill}\`.
4. Keep repo-specific learnings in committed \`.codex/enterprise-state/\` files, and keep machine-only facts out of git.
5. Use your own gitignored agent session under \`.codex/enterprise-state/agent-sessions\` as the only source of in-flight stage truth.
`;
}

function expectedManifest() {
  return {
    repo_slug: "helpdesk",
    repo_display_name: "Helpdesk",
    generated_skills: [
      "helpdesk-enterprise",
      "helpdesk-enterprise-discover",
      "helpdesk-enterprise-brainstorm",
      "helpdesk-enterprise-plan",
      "helpdesk-enterprise-contract",
      "helpdesk-enterprise-build",
      "helpdesk-enterprise-review",
      "helpdesk-enterprise-pr-review",
      "helpdesk-enterprise-stack-review",
      "helpdesk-enterprise-forge",
      "helpdesk-enterprise-verify",
      "helpdesk-enterprise-harness",
      "helpdesk-enterprise-compound",
      "helpdesk-enterprise-debug",
    ],
    profile_path: ".codex/enterprise-state/repo-profile.json",
    traps_path: ".codex/enterprise-state/repo-traps.json",
    best_practices_path: ".codex/enterprise-state/repo-best-practices.json",
    machine_path: ".codex/enterprise-state/local-machine.json",
    agent_session_root: ".codex/enterprise-state/agent-sessions",
  };
}

function main() {
  const repoRoot = findRepoRoot();
  if (!isHelpdeskRepo(repoRoot)) {
    console.log("SKIP not a Helpdesk repo");
    return;
  }

  const repoSkillsRoot = path.join(repoRoot, ".codex", "repo-skills");
  const changes = [];
  writeFileIfNeeded(
    path.join(repoSkillsRoot, "helpdesk-enterprise-pr-review", "SKILL.md"),
    overlaySkill({
      name: "helpdesk-enterprise-pr-review",
      title: "Helpdesk Enterprise PR Review",
      description:
        "Use when working in the Helpdesk repo and PR conversation closeout and failed-review learning must be anchored to the repo-local profile, traps, and source-of-truth docs",
      targetSkill: "enterprise-pr-review",
      extraRules: `- Use blocking-closeout for merge-blocking conversations and advisory-harvest for useful but non-blocking Copilot/GitHub comments.
- Read live GitHub review threads and current PR head before classifying anything; unresolved blocking conversation state is the merge blocker source of truth.
- Before any merge command, run \`node /Users/ben/.codex/skills/enterprise-pr-review/scripts/pre-merge-review-sweep.cjs <PR>\` and stop if any check/review job is pending, failed, missing, or any review thread is unresolved.
- Do not make every PR draft by default. Use draft for high-risk lanes, or globally only after confirming Copilot reviews draft PRs in this repo.
- Reply with current-head evidence before resolving threads. Do not resolve review conversations as administrative cleanup unless the user explicitly narrows the task to that.
- Real or useful advisory review findings must feed regression proof or compound learning that recommends a trap, gate, script, contract invariant/postcondition, plan rule, or eval.

`,
    }),
    changes,
  );

  writeFileIfNeeded(
    path.join(repoSkillsRoot, "helpdesk-enterprise-stack-review", "SKILL.md"),
    overlaySkill({
      name: "helpdesk-enterprise-stack-review",
      title: "Helpdesk Enterprise Stack Review",
      description:
        "Use when working in the Helpdesk repo and technology decision locking must be anchored to the repo-local profile, traps, and source-of-truth docs",
      targetSkill: "enterprise-stack-review",
      extraRules: `- Stack review must preserve the incumbent stack unless the TDD proves a new technology domain is required.
- Stack review decisions must be recorded as portable repo artifacts and kept in the overlay manifest hash chain.
- Stack review must finish before plan for FULL lanes that need technology decision locking.

`,
    }),
    changes,
  );

  writeFileIfNeeded(
    path.join(repoSkillsRoot, "helpdesk-enterprise-manifest.json"),
    `${JSON.stringify(expectedManifest(), null, 2)}\n`,
    changes,
  );

  if (checkOnly && changes.length > 0) {
    console.error(`FAIL Helpdesk enterprise overlays are missing or stale: ${changes.join(", ")}`);
    process.exit(1);
  }

  if (changes.length > 0) {
    console.log(`${checkOnly ? "STALE" : "UPDATED"} ${changes.join(", ")}`);
  } else {
    console.log("PASS Helpdesk enterprise overlays are current");
  }
}

main();
