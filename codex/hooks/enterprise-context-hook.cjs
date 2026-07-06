#!/usr/bin/env node
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const EVENT = (process.argv[2] || "").toLowerCase();
const HOME = os.homedir();
const CODEX_HOME = process.env.CODEX_HOME || path.join(HOME, ".codex");
const DEFAULT_REPO =
  process.env.CODEX_DEFAULT_REPO || path.join(HOME, "Projects", "helpdesk");
const VAULT_ROOT =
  process.env.VAULT_ROOT || path.join(HOME, "Documents", "Product Ideas");
const PROJECT_SLUG = process.env.CODEX_PROJECT_SLUG || "helpdesk";
const HELPDESK_ROOTS = parsePathList(process.env.HELPDESK_ROOTS, [
  path.join(HOME, "helpdesk"),
  path.join(HOME, "Projects", "helpdesk"),
]).map((root) => path.resolve(root));
const ERROR_LOG = path.join(
  CODEX_HOME,
  "hooks",
  "enterprise-context-hook-error.log",
);
const HOOK_LEDGER_DIRNAME = "hook-ledger";

const SECRET_NAME_RE =
  /(TOKEN|KEY|SECRET|PASSWORD|DATABASE_URL|SHOPIFY_ACCESS_TOKEN|GITHUB.*TOKEN|RENDER_API_KEY)/i;
const SAFE_ENV_KEYS = [
  "CLAUDE_PROJECT_DIR",
  "PWD",
  "HOME",
  "SHELL",
  "RIPGREP_CONFIG_PATH",
  "SKILLS_INDEX_RUNTIME",
  "CODEX_MEM_DATA_DIR",
  "CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC",
  "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS",
  "CODEX_THREAD_ID",
  "CODEX_ENTERPRISE_AGENT_ID",
];
const SECRET_ENV_KEYS = [
  "CODEX_GITHUB_PERSONAL_ACCESS_TOKEN",
  "CODEX_PR_GITHUB_TOKEN",
  "RENDER_API_KEY",
  "LLM_API_KEY",
  "OPENCLAW_KIMI_GATEWAY_TOKEN",
  "DATABASE_URL",
  "SHOPIFY_ACCESS_TOKEN",
];

function parsePathList(value, fallback) {
  if (!value) return fallback;
  return value
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isHelpdeskRepoRoot(repoRoot) {
  const resolved = path.resolve(repoRoot || "");
  return HELPDESK_ROOTS.some((root) => resolved === root);
}

function appendError(error) {
  try {
    fs.mkdirSync(path.dirname(ERROR_LOG), { recursive: true });
    fs.appendFileSync(
      ERROR_LOG,
      `[${new Date().toISOString()}] ${error && error.stack ? error.stack : String(error)}\n`,
    );
  } catch (_) {
    // Best effort only. Hooks must never fail closed for context capture.
  }
}

function emitContinue(extra = {}) {
  const allowedKeys = new Set([
    "continue",
    "suppressOutput",
    "stopReason",
    "decision",
    "systemMessage",
    "reason",
    "hookSpecificOutput",
  ]);
  const output = { continue: true };
  for (const [key, value] of Object.entries(extra)) {
    if (allowedKeys.has(key) && value !== undefined) {
      output[key] = value;
    }
  }
  process.stdout.write(`${JSON.stringify(output)}\n`);
}

function readStdinJson() {
  const input = fs.readFileSync(0, "utf8").trim();
  if (!input) return {};
  try {
    return JSON.parse(input);
  } catch (_) {
    return {
      raw_input_hash: sha256(input),
      raw_input_excerpt: redactText(input).slice(0, 500),
    };
  }
}

function sha256(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex");
}

function redactText(value) {
  if (typeof value !== "string") return value;
  return value
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]+/g, "$1[redacted]")
    .replace(/shpat_[A-Za-z0-9]+/g, "shpat_[redacted]")
    .replace(
      /github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9_]+/g,
      "[github-token-redacted]",
    )
    .replace(/postgres(?:ql)?:\/\/[^\s'"]+/gi, "postgresql://[redacted]")
    .replace(
      /\b(DATABASE_URL|SHOPIFY_ACCESS_TOKEN|CODEX_GITHUB_PERSONAL_ACCESS_TOKEN|CODEX_PR_GITHUB_TOKEN|RENDER_API_KEY|LLM_API_KEY|OPENCLAW_KIMI_GATEWAY_TOKEN|TOKEN|KEY|SECRET|PASSWORD)=([^\s'"]+)/gi,
      "$1=[redacted]",
    );
}

function sanitize(value, depth = 0) {
  if (depth > 6) return "[max-depth]";
  if (value == null) return value;
  if (typeof value === "string") return redactText(value);
  if (typeof value !== "object") return value;
  if (Array.isArray(value))
    return value.slice(0, 50).map((item) => sanitize(item, depth + 1));

  const out = {};
  for (const [key, inner] of Object.entries(value)) {
    if (SECRET_NAME_RE.test(key)) {
      out[key] = inner ? "[present-redacted]" : "[missing]";
    } else {
      out[key] = sanitize(inner, depth + 1);
    }
  }
  return out;
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    timeout: 2500,
    maxBuffer: 256 * 1024,
  });
  if (result.error || result.status !== 0) return "";
  return (result.stdout || "").trim();
}

function commandExists(command) {
  return Boolean(run("which", [command], process.cwd()));
}

function resolveCwd(payload) {
  return (
    payload.cwd ||
    payload.project_dir ||
    process.env.CLAUDE_PROJECT_DIR ||
    process.env.PWD ||
    DEFAULT_REPO
  );
}

function resolveRepoRoot(cwd) {
  const root = run("git", ["rev-parse", "--show-toplevel"], cwd);
  return root || (fs.existsSync(DEFAULT_REPO) ? DEFAULT_REPO : cwd);
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function stateDir(repoRoot) {
  return path.join(repoRoot, ".codex", "enterprise-state");
}

function ledgerDir(repoRoot) {
  return path.join(stateDir(repoRoot), HOOK_LEDGER_DIRNAME);
}

function writeJson(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function appendJsonl(filePath, value) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(value)}\n`);
}

function timestampSlug() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function safeSlug(value) {
  return (
    String(value || "unknown")
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .slice(0, 96) || "unknown"
  );
}

function collectGit(repoRoot) {
  const statusLines = run("git", ["status", "--short"], repoRoot)
    .split("\n")
    .filter(Boolean);
  const mergeHead = run(
    "git",
    ["rev-parse", "--verify", "-q", "MERGE_HEAD"],
    repoRoot,
  );
  return {
    branch: run("git", ["branch", "--show-current"], repoRoot) || "(detached)",
    commit: run("git", ["rev-parse", "--short=12", "HEAD"], repoRoot) || null,
    upstream:
      run(
        "git",
        ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
        repoRoot,
      ) || null,
    dirty_count: statusLines.length,
    dirty_sample: statusLines.slice(0, 80).map(redactText),
    in_merge: Boolean(mergeHead),
  };
}

function collectEnterpriseStates(repoRoot) {
  const stateDir = path.join(repoRoot, ".codex", "enterprise-state");
  if (!fs.existsSync(stateDir)) {
    return { state_dir: stateDir, active: [], recent: [] };
  }

  const states = fs
    .readdirSync(stateDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => {
      const fullPath = path.join(stateDir, entry.name);
      try {
        const parsed = JSON.parse(fs.readFileSync(fullPath, "utf8"));
        if (!parsed.stages && !parsed.slug) return null;
        const stages = parsed.stages || {};
        return {
          file: fullPath,
          mtime: fs.statSync(fullPath).mtime.toISOString(),
          slug: parsed.slug || entry.name.replace(/\.json$/, ""),
          tier: parsed.tier || null,
          mode: parsed.mode || null,
          branch: parsed.branch || null,
          active_stages: Object.entries(stages)
            .filter(([, stage]) => stage && stage.status === "in_progress")
            .map(([name]) => name),
          completed_stages: Object.entries(stages)
            .filter(([, stage]) => stage && stage.status === "complete")
            .map(([name]) => name),
          next_pending_stages: Object.entries(stages)
            .filter(([, stage]) => stage && stage.status === "pending")
            .slice(0, 3)
            .map(([name]) => name),
          artifacts: Object.fromEntries(
            Object.entries(stages)
              .filter(([, stage]) => stage && stage.artifact)
              .map(([name, stage]) => [name, stage.artifact]),
          ),
        };
      } catch (_) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => {
      const activeDelta =
        Number(b.active_stages.length > 0) - Number(a.active_stages.length > 0);
      if (activeDelta) return activeDelta;
      return String(b.mtime).localeCompare(String(a.mtime));
    });

  return {
    state_dir: stateDir,
    active: states
      .filter((state) => state.active_stages.length > 0)
      .slice(0, 8),
    recent: states.slice(0, 8),
  };
}

function collectTestEvidence(repoRoot) {
  const candidates = [
    path.join(
      repoRoot,
      ".codex",
      "enterprise-state",
      HOOK_LEDGER_DIRNAME,
      "latest-test-evidence.json",
    ),
    path.join(repoRoot, ".claude", "evidence", "last-test-run.json"),
    path.join(repoRoot, ".codex", "enterprise-state", "last-test-run.json"),
  ];
  for (const candidate of candidates) {
    if (!fs.existsSync(candidate)) continue;
    try {
      return {
        path: candidate,
        mtime: fs.statSync(candidate).mtime.toISOString(),
        data: sanitize(JSON.parse(fs.readFileSync(candidate, "utf8"))),
      };
    } catch (error) {
      return { path: candidate, error: String(error.message || error) };
    }
  }
  return { path: null, note: "No last-test-run evidence file found." };
}

function collectEnv() {
  const safe = {};
  for (const key of SAFE_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(process.env, key)) {
      safe[key] = redactText(process.env[key]);
    }
  }

  const secrets = {};
  for (const key of SECRET_ENV_KEYS) {
    secrets[key] = process.env[key] ? "[present-redacted]" : "[missing]";
  }

  return {
    safe,
    secrets,
    capabilities: {
      local_bin_in_path: (process.env.PATH || "")
        .split(path.delimiter)
        .includes(path.join(HOME, ".local", "bin")),
      homebrew_bin_in_path: (process.env.PATH || "")
        .split(path.delimiter)
        .includes("/opt/homebrew/bin"),
      commands: Object.fromEntries(
        [
          "git",
          "node",
          "python3",
          "enterprise-precheck",
          "enterprise-agent-session",
          "enterprise-required-gates",
          "enterprise-containment",
        ].map((command) => [command, commandExists(command)]),
      ),
    },
  };
}

function collectMcpConfig() {
  const configPath = path.join(HOME, ".codex", "config.toml");
  if (!fs.existsSync(configPath))
    return { config_path: configPath, servers: [] };

  const text = fs.readFileSync(configPath, "utf8");
  const serverBlocks = [];
  const blockRe = /^\[mcp_servers\.([^\]]+)\]\n([\s\S]*?)(?=^\[|\z)/gm;
  let match;
  while ((match = blockRe.exec(text)) !== null) {
    const [, name, body] = match;
    if (name.includes(".")) continue;
    serverBlocks.push({
      name,
      enabled: !/^\s*enabled\s*=\s*false\s*$/m.test(body),
      command: firstTomlString(body, "command"),
      url: redactText(firstTomlString(body, "url")),
      bearer_token_env_var: firstTomlString(body, "bearer_token_env_var"),
      env_keys: Array.from(body.matchAll(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/gm))
        .map((entry) => entry[1])
        .filter(
          (key) =>
            ![
              "command",
              "url",
              "args",
              "env",
              "bearer_token_env_var",
              "enabled",
            ].includes(key),
        ),
    });
  }

  return {
    config_path: configPath,
    servers: serverBlocks,
  };
}

function firstTomlString(body, key) {
  const match = body.match(
    new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"\\s*$`, "m"),
  );
  return match ? match[1] : null;
}

function collectPrompt(payload) {
  const candidates = [
    "prompt",
    "user_prompt",
    "last_user_message",
    "message",
    "userPrompt",
    "input",
  ];
  for (const key of candidates) {
    if (typeof payload[key] === "string" && payload[key].trim()) {
      return {
        field: key,
        hash: sha256(payload[key]),
        excerpt: redactText(payload[key]).slice(0, 500),
        retained_full_prompt: false,
      };
    }
  }
  return {
    retained_full_prompt: false,
    note: "No prompt field present in hook payload.",
  };
}

function nextAction(packet) {
  const active = packet.enterprise.active[0];
  if (active) {
    const stage =
      active.active_stages[0] ||
      active.next_pending_stages[0] ||
      "next enterprise stage";
    return `Resume ${active.slug} at ${stage}; read ${active.file} first.`;
  }
  if (packet.git.dirty_count > 0) {
    return "Review dirty worktree state before starting new implementation.";
  }
  return "No active enterprise stage found; bootstrap policy/vault/cortex before substantive work.";
}

function createPacket(payload) {
  const cwd = resolveCwd(payload);
  const repoRoot = resolveRepoRoot(cwd);
  const sessionId =
    payload.session_id || payload.sessionId || process.env.SESSION_ID || null;
  const codexThreadId = process.env.CODEX_THREAD_ID || null;
  const git = collectGit(repoRoot);
  const enterprise = collectEnterpriseStates(repoRoot);
  const packet = {
    schema_version: 1,
    event: "precompact",
    generated_at: new Date().toISOString(),
    host: os.hostname(),
    session: {
      session_id: sessionId,
      codex_thread_id: codexThreadId,
      agent_id: process.env.CODEX_ENTERPRISE_AGENT_ID || null,
    },
    paths: {
      cwd,
      repo_root: repoRoot,
      state_dir: path.join(repoRoot, ".codex", "enterprise-state"),
      compaction_dir: path.join(
        repoRoot,
        ".codex",
        "enterprise-state",
        "session-compactions",
      ),
      vault_evidence: path.join(
        VAULT_ROOT,
        "_evidence",
        `${PROJECT_SLUG}-context-compaction-latest.md`,
      ),
    },
    prompt: collectPrompt(payload),
    git,
    enterprise,
    test_evidence: collectTestEvidence(repoRoot),
    env: collectEnv(),
    mcp: collectMcpConfig(),
    hook_payload_summary: sanitize({
      keys: Object.keys(payload).sort(),
      source: payload.hook_event_name || payload.event || null,
    }),
  };
  packet.next_action = nextAction(packet);
  return packet;
}

function writePacket(packet) {
  const dir = packet.paths.compaction_dir;
  ensureDir(dir);

  const id = safeSlug(
    packet.session.session_id || packet.session.codex_thread_id || "session",
  );
  const packetPath = path.join(dir, `${id}-${timestampSlug()}.json`);
  const latestPath = path.join(dir, "latest.json");
  const cardPath = path.join(dir, "latest.md");

  packet.paths.packet = packetPath;
  packet.paths.latest = latestPath;
  packet.paths.resume_card = cardPath;

  const json = `${JSON.stringify(packet, null, 2)}\n`;
  fs.writeFileSync(packetPath, json);
  fs.writeFileSync(latestPath, json);
  fs.writeFileSync(cardPath, makeResumeCard(packet));
  writeVaultEvidence(packet);

  return { packetPath, latestPath, cardPath };
}

function makeResumeCard(packet) {
  const active = packet.enterprise.active.length
    ? packet.enterprise.active
        .map(
          (state) =>
            `- ${state.slug}: active=${state.active_stages.join(", ") || "none"} branch=${state.branch || "unknown"} file=${state.file}`,
        )
        .join("\n")
    : "- none";
  const evidence = packet.test_evidence.path
    ? `${packet.test_evidence.path} (${packet.test_evidence.mtime || "mtime unknown"})`
    : packet.test_evidence.note;
  const secretPresence = Object.entries(packet.env.secrets)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ");
  const mcpServers = packet.mcp.servers
    .map((server) => `${server.name}${server.enabled ? "" : " (disabled)"}`)
    .join(", ");

  return `# Codex Context Resume Card

Generated: ${packet.generated_at}
Repo: ${packet.paths.repo_root}
Branch: ${packet.git.branch} @ ${packet.git.commit || "unknown"}
Dirty files: ${packet.git.dirty_count}
Session: ${packet.session.session_id || "unknown"}
Codex thread: ${packet.session.codex_thread_id || "unknown"}

## Next Action
${packet.next_action}

## Active Enterprise State
${active}

## Latest Test Evidence
${evidence}

## Prompt Retention
Full original prompt retained: no
Prompt hash: ${packet.prompt.hash || "n/a"}
Prompt excerpt: ${packet.prompt.excerpt || packet.prompt.note || "n/a"}

## Environment
Secrets: ${secretPresence}
Commands: ${Object.entries(packet.env.capabilities.commands)
    .map(([key, value]) => `${key}=${value}`)
    .join(", ")}

## MCP Servers
${mcpServers || "No MCP server config found."}

## Packet
${packet.paths.packet}
`;
}

function yamlString(value) {
  return JSON.stringify(String(value == null ? "" : value));
}

function writeVaultEvidence(packet) {
  const evidenceDir = path.join(VAULT_ROOT, "_evidence");
  if (!fs.existsSync(VAULT_ROOT)) return;
  ensureDir(evidenceDir);

  const notePath = packet.paths.vault_evidence;
  const updated = packet.generated_at;
  const body = `---
id: ${PROJECT_SLUG.replace(/[^A-Za-z0-9_]+/g, "_")}_context_compaction_latest
type: evidence
priority: low
project: ${PROJECT_SLUG}
module: agent-context
status: done
complexity: low
owner_family: codex
owner_instance: ${yamlString(packet.session.codex_thread_id || packet.session.session_id || "unknown")}
branch: ${yamlString(packet.git.branch)}
worktree_path: ${yamlString(packet.paths.cwd)}
proof_state: context-snapshot
blocked_by: []
related: []
next_action: ${yamlString(packet.next_action)}
created: ${yamlString(updated)}
updated: ${yamlString(updated)}
tags:
  - context-compaction
  - automated
---

# Helpdesk Context Compaction Latest

Generated: ${packet.generated_at}

Packet: ${packet.paths.packet}
Resume card: ${packet.paths.resume_card}
Repo: ${packet.paths.repo_root}
Branch: ${packet.git.branch} @ ${packet.git.commit || "unknown"}
Dirty files: ${packet.git.dirty_count}

## Next Action
${packet.next_action}

## Active Enterprise State
${packet.enterprise.active.length ? packet.enterprise.active.map((state) => `- ${state.slug}: ${state.active_stages.join(", ") || "none"} (${state.file})`).join("\n") : "- none"}

## Test Evidence
${packet.test_evidence.path || packet.test_evidence.note}

## Environment Presence
${Object.entries(packet.env.secrets)
  .map(([key, value]) => `- ${key}: ${value}`)
  .join("\n")}

## MCP Servers
${packet.mcp.servers.map((server) => `- ${server.name}: ${server.enabled ? "enabled" : "disabled"}${server.bearer_token_env_var ? `; token env ${server.bearer_token_env_var}` : ""}`).join("\n") || "- none"}
`;

  fs.writeFileSync(notePath, body);
  fs.writeFileSync(path.join(evidenceDir, ".needs-reindex"), `${updated}\n`);
}

function readLatestPacket(payload) {
  const cwd = resolveCwd(payload);
  const repoRoot = resolveRepoRoot(cwd);
  const latestPath = path.join(
    repoRoot,
    ".codex",
    "enterprise-state",
    "session-compactions",
    "latest.json",
  );
  if (!fs.existsSync(latestPath)) return { latestPath, packet: null };
  const packet = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  return { latestPath, packet };
}

function extractPromptText(payload) {
  const direct = collectPrompt(payload);
  if (direct.hash) {
    const value = payload[direct.field];
    return typeof value === "string" ? value : "";
  }
  const nested = [
    payload.user,
    payload.input,
    payload.tool_input,
    payload.toolInput,
    payload.request,
  ].filter((item) => item && typeof item === "object");
  for (const candidate of nested) {
    const prompt = collectPrompt(candidate);
    if (prompt.hash && typeof candidate[prompt.field] === "string")
      return candidate[prompt.field];
  }
  return "";
}

function promptIntake(promptText) {
  const text = redactText(promptText || "").trim();
  const lower = text.toLowerCase();
  const mentionsLocalMaintenance =
    /\b(local machine|machine-local|local env(?:ironment)?|startup|overhead|token(?:s)?|cheap(?:er)?|trim(?:ming)?|agent-platform|codex|hook|config|local tooling|AGENTS\.md)\b/i.test(
      text,
    );
  const suppressRemoteWorkflow =
    /\b(?:no|don't|dont|do not|without|skip|avoid)\s+(?:github|gh|prs?|pull requests?|ci|checks?|workflows?|watch(?:ers)?|network)\b/i.test(
      text,
    ) ||
    /\b(?:local[- ]only|no[- ]network|no[- ]github|no[- ]ci|no[- ]prs?|no[- ]watchers?)\b/i.test(
      text,
    );
  const mentionsPr =
    !suppressRemoteWorkflow &&
    /\bpr\s*#?\d+\b|\bprs?\b|\bpull requests?\b|\bgithub\b|\bhelpdesk-pr-queue-closeout\b|\bmerge-(?:dev|ready)\b|\b(?:queue\s+)?closeout\b/i.test(
      text,
    );
  const mentionsCi =
    !suppressRemoteWorkflow &&
    /\bci\b|checks?|workflow|failed|failing|gh run/i.test(text);
  const mentionsUi =
    /\bui\b|browser|playwright|screen|page|modal|frontend|react/i.test(text);
  const mentionsDb = /\bdb\b|database|sql|migration|postgres|psql|schema/i.test(
    text,
  );
  const mentionsEnterprise =
    /\$?enterprise|governed|contract|forge|verify|merge readiness/i.test(text);
  const mentionsCode =
    /\bfix|bug|implement|build|make|create|change|improve|refactor|review|debug|test|hook|script|config|route|service|component|ship|merge|drain|close\s*out|closeout|push|commit|rebase|resolve/i.test(
      text,
    );
  const mentionsExplicitDeepThink = /(?:^|\s)[$/]?deep[- ]think\b/i.test(text);
  const mentionsExplicitZoomOut =
    /(?:^|\s)[$/]?zoom[- ]out\b|\bbigger picture\b|\bsystem shape\b/i.test(
      text,
    );
  const mentionsDurable =
    mentionsPr ||
    mentionsCi ||
    mentionsEnterprise ||
    /\bprod|deploy|main|dev|branch|worktree|vault|release|incident|ship/i.test(
      text,
    );
  const vagueSignals =
    /\b(it|this|that|thing|stuff|issue|problem|better|clean|sort|look at|figure out|handle)\b/i.test(
      text,
    );
  const hasConcretePointer =
    /\/[\w./ -]+|\b[A-Za-z0-9_.-]+\.(js|jsx|ts|tsx|cjs|json|md|sql)\b|#\d+|\b[A-Z]+-\d+\b/.test(
      text,
    );
  const workTopicSignals =
    mentionsCode ||
    mentionsEnterprise ||
    mentionsDb ||
    mentionsUi ||
    mentionsDurable ||
    hasConcretePointer ||
    (!mentionsLocalMaintenance &&
      /\b(skill|tool|pipeline|workflow|system|feature|release|deploy|branch|worktree)\b/i.test(
        text,
      ));
  const mentionsPlanning =
    /\b(plan|planning|approach|design|architecture|proposal|strategy|roadmap|test plan|implementation plan)\b/i.test(
      text,
    ) ||
    (/\b(should we|can we|would it|do you suggest|suggestions?)\b/i.test(
      text,
    ) &&
      workTopicSignals);
  const mentionsBugOrDebug =
    /\b(bug|debug|broken|breaks?|failing|failed|error|regression|root cause|wrong|not working|symptom|incident)\b/i.test(
      text,
    ) ||
    (/\b(issue|problem)\b/i.test(text) && workTopicSignals);
  const mentionsReview =
    /\b(review|audit|verdict|approve|revise|reject|merge ready|safe to merge)\b/i.test(
      text,
    );
  const mentionsRefactor =
    /\b(refactor|cleanup|simplify|split|extract|srp|ownership|seam)\b/i.test(
      text,
    );
  const localMaintenanceNeedsHeavy =
    mentionsLocalMaintenance &&
    (mentionsExplicitDeepThink ||
      mentionsBugOrDebug ||
      mentionsReview ||
      mentionsDb ||
      mentionsUi ||
      /\b(security|auth|tenant|payment|inventory|order|invoice|pricing|production|prod|root cause)\b/i.test(
        text,
      ));
  const isVague = text.length > 0 && vagueSignals && !hasConcretePointer;
  const deepThinkRequired = Boolean(
    text.length > 0 &&
    (mentionsExplicitDeepThink ||
      mentionsEnterprise ||
      ((!mentionsLocalMaintenance || localMaintenanceNeedsHeavy) &&
        (mentionsPlanning ||
          mentionsBugOrDebug ||
          mentionsReview ||
          mentionsRefactor ||
          mentionsDb ||
          mentionsUi)) ||
      (mentionsCode && mentionsDurable && !mentionsLocalMaintenance)),
  );
  const zoomOutRequired = Boolean(
    deepThinkRequired &&
    (mentionsExplicitZoomOut ||
      mentionsPlanning ||
      mentionsBugOrDebug ||
      mentionsRefactor ||
      /\b(workflow|lifecycle|status|callers?|consumers?|blast radius|ownership)\b/i.test(
        text,
      )),
  );

  let route = "direct";
  if (mentionsPr) route = "pr-review-or-closeout";
  else if (mentionsCi) route = "ci-debug";
  else if (
    mentionsLocalMaintenance &&
    mentionsCode &&
    !localMaintenanceNeedsHeavy
  )
    route = "local-maintenance";
  else if (mentionsBugOrDebug) route = "deep-think-debug";
  else if (mentionsPlanning || mentionsReview || mentionsRefactor)
    route = "deep-think-precheck";
  else if (isVague && mentionsCode) route = "reshape-before-tooling";
  else if (mentionsEnterprise || (mentionsCode && mentionsDurable))
    route = "enterprise-bootstrap";
  else if (!mentionsCode && !deepThinkRequired) route = "conversation";

  const contextWhenNeeded = [];
  if (deepThinkRequired)
    contextWhenNeeded.push(
      "deep-think: read-only precheck before conclusions or edits",
    );
  if (
    (mentionsCode || mentionsEnterprise || mentionsDurable) &&
    !mentionsLocalMaintenance
  )
    contextWhenNeeded.push("skills-index: task_bootstrap/get_policy_bundle");
  if (mentionsDurable || isVague)
    contextWhenNeeded.push("vault-index: search for related task/state");
  if (mentionsCode && !/\bhook|config|local tooling\b/i.test(text))
    contextWhenNeeded.push(
      "cortex-engine: source outline/read before file reads",
    );
  if (mentionsPr || mentionsCi)
    contextWhenNeeded.push("github/gh: live PR/check context");
  if (mentionsUi)
    contextWhenNeeded.push("browser/playwright only when UI proof is needed");
  if (mentionsDb)
    contextWhenNeeded.push(
      "sql/db tools only after mutation boundary is clear",
    );

  const objective = text.length
    ? text.slice(0, 240)
    : "No prompt text visible in hook payload.";
  const reshapedPrompt = [
    `Objective: ${objective}`,
    `Route: ${route}`,
    isVague
      ? "Clarify/reshape first: identify target, success condition, evidence source, and stop rule before loading heavy context."
      : "First move: load only the policy/task context needed for this prompt, then read source truth before acting.",
    contextWhenNeeded.length
      ? `Load on demand: ${contextWhenNeeded.join("; ")}`
      : "Load on demand: none unless the next step becomes substantive.",
  ].join("\n");

  return {
    prompt_hash: sha256(promptText || ""),
    prompt_excerpt: text.slice(0, 500),
    retained_full_prompt: false,
    is_vague: Boolean(isVague),
    route,
    signals: {
      mentions_pr: mentionsPr,
      mentions_ci: mentionsCi,
      mentions_ui: mentionsUi,
      mentions_db: mentionsDb,
      mentions_enterprise: mentionsEnterprise,
      mentions_code: mentionsCode,
      mentions_planning: mentionsPlanning,
      mentions_bug_or_debug: mentionsBugOrDebug,
      mentions_review: mentionsReview,
      mentions_refactor: mentionsRefactor,
      mentions_local_maintenance: mentionsLocalMaintenance,
      local_maintenance_needs_heavy: localMaintenanceNeedsHeavy,
      mentions_explicit_deep_think: mentionsExplicitDeepThink,
      mentions_explicit_zoom_out: mentionsExplicitZoomOut,
      durable: mentionsDurable,
      has_concrete_pointer: hasConcretePointer,
    },
    enforcement: {
      deep_think_required: deepThinkRequired,
      zoom_out_required: zoomOutRequired,
      required_skills: deepThinkRequired ? ["deep-think"] : [],
      required_subroutines: zoomOutRequired ? ["zoom-out-map"] : [],
    },
    context_when_needed: contextWhenNeeded,
    reshaped_prompt: reshapedPrompt,
  };
}

function promptAdditionalContext(intake) {
  const enforcement = intake && intake.enforcement ? intake.enforcement : {};
  if (!enforcement.deep_think_required) return null;

  const zoomOut = enforcement.zoom_out_required
    ? " Include a bounded zoom-out map: focus, callers/consumers, sibling flows, lifecycle/status cohort, ownership boundary, risky edges, and proof path."
    : "";

  return [
    `[PROMPT INTAKE] Route=${intake.route}; deep-think is required before conclusions, edits, branches, PRs, or mutating commands.`,
    `Run a read-only Deep Think precheck, read source truth, then classify next action as NO_EDIT, QUICK_DIRECT, or ENTERPRISE_REQUIRED.${zoomOut}`,
  ].join(" ");
}

function routeCardFromIntake({ repoRoot, cwd, git, intake }) {
  const promptSignals = intake?.signals || {};
  const hookRoute = intake?.route || "direct";
  const branch = git.branch || "(detached)";
  const isPrimaryBranch = ["main", "master", "dev"].includes(branch);
  const isDirty = Number(git.dirty_count || 0) > 0;
  const isHelpdeskRepo = isHelpdeskRepoRoot(repoRoot);
  const isCodexWorktree = repoRoot.startsWith(
    path.join(os.homedir(), ".codex", "worktrees") + path.sep,
  );
  const activePrCloseoutMerge =
    hookRoute === "pr-review-or-closeout" &&
    isCodexWorktree &&
    git.in_merge &&
    !isPrimaryBranch;
  const isPrCloseoutRoute = hookRoute === "pr-review-or-closeout";
  const localMaintenance =
    (promptSignals.mentions_local_maintenance || promptSignals.mentions_code) &&
    /\b(hook|config|local tooling|machine-kit|agent-platform|codex)\b/i.test(
      intake?.prompt_excerpt || "",
    );
  const startupMaintenance =
    promptSignals.mentions_local_maintenance &&
    /\b(startup|overhead|token(?:s)?|cheap(?:er)?|trim(?:ming)?|local machine|machine-local|AGENTS\.md)\b/i.test(
      intake?.prompt_excerpt || "",
    );

  let route = "QUICK_DIRECT";
  if (
    hookRoute === "conversation" ||
    (!promptSignals.mentions_code && !isPrCloseoutRoute)
  )
    route = "NO_EDIT";
  else if (
    (localMaintenance || startupMaintenance) &&
    !promptSignals.local_maintenance_needs_heavy
  )
    route = "LOCAL_AGENT_MAINTENANCE";
  else if (
    promptSignals.mentions_enterprise ||
    promptSignals.mentions_db ||
    promptSignals.durable ||
    promptSignals.mentions_planning ||
    promptSignals.mentions_bug_or_debug ||
    promptSignals.mentions_review ||
    promptSignals.mentions_refactor ||
    isHelpdeskRepo
  ) {
    route = "ENTERPRISE_REQUIRED";
  }

  const needsCleanWorktree =
    route !== "NO_EDIT" &&
    route !== "LOCAL_AGENT_MAINTENANCE" &&
    ((isDirty && !activePrCloseoutMerge) ||
      isPrimaryBranch ||
      branch === "(detached)");
  const allowedToEditHere =
    route === "LOCAL_AGENT_MAINTENANCE" ||
    (route !== "NO_EDIT" && !needsCleanWorktree);

  return {
    schema_version: 1,
    generated_at: new Date().toISOString(),
    source: "enterprise-context-hook",
    repo_root: repoRoot,
    cwd,
    route,
    hook_route: hookRoute,
    allowed_to_edit_here: allowedToEditHere,
    needs_clean_worktree: needsCleanWorktree,
    base_ref: "origin/dev",
    git: {
      branch,
      commit: git.commit,
      dirty_count: git.dirty_count,
      in_merge: git.in_merge,
      upstream: git.upstream || null,
    },
    reasons: [
      `hook_route=${hookRoute}`,
      `branch=${branch}`,
      `dirty_count=${git.dirty_count}`,
      `in_merge=${git.in_merge}`,
      `is_helpdesk_repo=${isHelpdeskRepo}`,
      `active_pr_closeout_merge=${activePrCloseoutMerge}`,
    ],
    signals: promptSignals,
  };
}

function writeRouteCard(repoRoot, card) {
  const dir = ledgerDir(repoRoot);
  const latestPath = path.join(dir, "latest-route-card.json");
  let previous = null;
  try {
    previous = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  } catch (_) {
    previous = null;
  }
  writeJson(latestPath, card);
  if (!previous || routeCardAppendKey(previous) !== routeCardAppendKey(card)) {
    appendJsonl(path.join(dir, "route-card.jsonl"), card);
  }
}

function routeCardAppendKey(card) {
  return JSON.stringify({
    route: card?.route || null,
    hook_route: card?.hook_route || null,
    allowed_to_edit_here: Boolean(card?.allowed_to_edit_here),
    needs_clean_worktree: Boolean(card?.needs_clean_worktree),
    signals: card?.signals || {},
  });
}

function handleUserPromptSubmit(payload) {
  const cwd = resolveCwd(payload);
  const repoRoot = resolveRepoRoot(cwd);
  const git = collectGit(repoRoot);
  const promptText = extractPromptText(payload);
  const intake = {
    schema_version: 1,
    event: "userpromptsubmit",
    generated_at: new Date().toISOString(),
    session_id:
      payload.session_id || payload.sessionId || process.env.SESSION_ID || null,
    codex_thread_id: process.env.CODEX_THREAD_ID || null,
    repo_root: repoRoot,
    cwd,
    git: {
      branch: git.branch,
      commit: git.commit,
      dirty_count: git.dirty_count,
    },
    intake: promptIntake(promptText),
  };

  const dir = ledgerDir(repoRoot);
  writeRouteCard(
    repoRoot,
    routeCardFromIntake({ repoRoot, cwd, git, intake: intake.intake }),
  );
  writeJson(path.join(dir, "latest-prompt-intake.json"), intake);
  appendJsonl(path.join(dir, "prompt-intake.jsonl"), intake);

  const additionalContext = promptAdditionalContext(intake.intake);
  if (additionalContext) {
    process.stdout.write(
      `${JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext,
        },
      })}\n`,
    );
    return;
  }
}

function handleSessionStart(payload) {
  const cwd = resolveCwd(payload);
  const repoRoot = resolveRepoRoot(cwd);
  const git = collectGit(repoRoot);
  const enterprise = collectEnterpriseStates(repoRoot);
  const latestCompaction = path.join(
    repoRoot,
    ".codex",
    "enterprise-state",
    "session-compactions",
    "latest.md",
  );
  const latestPrompt = path.join(
    repoRoot,
    ".codex",
    "enterprise-state",
    HOOK_LEDGER_DIRNAME,
    "latest-prompt-intake.json",
  );
  const summary = {
    schema_version: 1,
    event: "sessionstart",
    generated_at: new Date().toISOString(),
    session_id:
      payload.session_id || payload.sessionId || process.env.SESSION_ID || null,
    codex_thread_id: process.env.CODEX_THREAD_ID || null,
    repo_root: repoRoot,
    cwd,
    git: {
      branch: git.branch,
      commit: git.commit,
      dirty_count: git.dirty_count,
    },
    active_enterprise: enterprise.active.map((state) => ({
      slug: state.slug,
      stages: state.active_stages,
      file: state.file,
    })),
    pointers: {
      latest_compaction_card: fs.existsSync(latestCompaction)
        ? latestCompaction
        : null,
      latest_prompt_intake: fs.existsSync(latestPrompt) ? latestPrompt : null,
    },
    note: "Pointer-only startup. Do not load MCP/skill bodies until a submitted prompt needs them.",
  };

  writeJson(
    path.join(ledgerDir(repoRoot), "latest-session-start.json"),
    summary,
  );
  emitContinue({
    message: `Lean session pointer ready. Branch ${git.branch}, dirty ${git.dirty_count}, active enterprise states ${summary.active_enterprise.length}.`,
  });
}

function extractToolCommand(payload) {
  const candidates = [
    payload.command,
    payload.tool_input && payload.tool_input.command,
    payload.toolInput && payload.toolInput.command,
    payload.input && payload.input.command,
    payload.arguments && payload.arguments.command,
  ];
  return (
    candidates.find((value) => typeof value === "string" && value.trim()) || ""
  );
}

function extractToolName(payload) {
  return (
    payload.tool_name ||
    payload.toolName ||
    payload.tool ||
    payload.name ||
    payload.tool_input?.name ||
    payload.toolInput?.name ||
    ""
  );
}

function extractToolResponse(payload) {
  const response =
    payload.tool_response ??
    payload.toolResponse ??
    payload.response ??
    payload.result ??
    payload.output ??
    "";
  if (typeof response === "string") return response;
  return JSON.stringify(sanitize(response));
}

function extractExitCode(payload) {
  const response =
    payload.tool_response ??
    payload.toolResponse ??
    payload.response ??
    payload.result ??
    {};
  if (response && typeof response === "object") {
    for (const key of ["exit_code", "exitCode", "status"]) {
      if (Number.isInteger(response[key])) return response[key];
    }
  }
  if (Number.isInteger(payload.exit_code)) return payload.exit_code;
  if (Number.isInteger(payload.exitCode)) return payload.exitCode;
  return null;
}

function commandKind(command, toolName) {
  const cmd = command.trim();
  if (!cmd && !toolName) return null;
  if (
    /\b(npx\s+(jest|vitest|playwright)|npm\s+(run\s+test|test)|vitest\s+run|jest\s|playwright\s+test|node_modules\/\.bin\/jest)\b/i.test(
      cmd,
    )
  ) {
    return "test";
  }
  if (
    /\bgit\s+(checkout|switch|merge|rebase|cherry-pick|reset|apply|pull|commit|restore)\b/i.test(
      cmd,
    )
  ) {
    return "git-state-change";
  }
  if (
    /\bgh\s+(pr\s+(view|checks|list)|run\s+view|api\s+graphql)\b/i.test(cmd)
  ) {
    return "github-context";
  }
  if (
    /\b(enterprise-agent-session|enterprise-required-gates|enterprise-containment|enterprise-precheck)\b/i.test(
      cmd,
    )
  ) {
    return "enterprise-gate";
  }
  return null;
}

function parseTestCounts(output) {
  const text = output || "";
  const suiteLine = text.match(/Test Suites:\s+([^\n]+)/);
  const testLine = text.match(/Tests:\s+([^\n]+)/);
  const counts = {
    suites_passed: 0,
    suites_failed: 0,
    suites_skipped: 0,
    tests_passed: 0,
    tests_failed: 0,
    counts_verified: false,
  };

  if (suiteLine) {
    counts.counts_verified = true;
    counts.suites_passed = numberBefore(suiteLine[1], "passed");
    counts.suites_failed = numberBefore(suiteLine[1], "failed");
    counts.suites_skipped = numberBefore(suiteLine[1], "skipped");
  }
  if (testLine) {
    counts.counts_verified = true;
    counts.tests_passed = numberBefore(testLine[1], "passed");
    counts.tests_failed = numberBefore(testLine[1], "failed");
  }
  return counts;
}

function numberBefore(line, word) {
  const match = line.match(new RegExp(`(\\d+)\\s+${word}`));
  return match ? Number(match[1]) : 0;
}

function tailLines(text, limit) {
  return String(text || "")
    .split("\n")
    .slice(-limit)
    .join("\n");
}

function writeVaultTestEvidence(repoRoot, evidence) {
  if (!fs.existsSync(VAULT_ROOT)) return;
  const evidenceDir = path.join(VAULT_ROOT, "_evidence");
  ensureDir(evidenceDir);
  const notePath = path.join(
    evidenceDir,
    `${PROJECT_SLUG}-codex-test-evidence.md`,
  );
  const status = evidence.stale
    ? "stale"
    : evidence.exit_code === 0
      ? "green"
      : "red";
  const body = `---
id: evidence_${PROJECT_SLUG.replace(/[^A-Za-z0-9_]+/g, "_")}_codex_test_run
type: evidence
project: ${PROJECT_SLUG}
module: verification
status: ${status}
owner_family: codex
branch: ${yamlString(evidence.branch)}
commit: ${yamlString(evidence.commit)}
updated: ${yamlString(evidence.timestamp)}
tags:
  - codex
  - test-evidence
---

# Helpdesk Codex Test Evidence

Time: ${evidence.timestamp}
Branch: ${evidence.branch} @ ${evidence.commit}
Command: \`${redactText(evidence.command)}\`
Exit code: ${evidence.exit_code == null ? "unknown" : evidence.exit_code}
Stale: ${evidence.stale ? "true" : "false"}

Suites: ${evidence.counts.suites_passed} passed, ${evidence.counts.suites_failed} failed, ${evidence.counts.suites_skipped} skipped
Tests: ${evidence.counts.tests_passed} passed, ${evidence.counts.tests_failed} failed

Latest JSON: ${path.join(repoRoot, ".codex", "enterprise-state", HOOK_LEDGER_DIRNAME, "latest-test-evidence.json")}
`;
  fs.writeFileSync(notePath, body);
  fs.writeFileSync(
    path.join(evidenceDir, ".needs-reindex"),
    `${evidence.timestamp}\n`,
  );
}

function markLatestTestEvidenceStale(repoRoot, reason) {
  const latestPath = path.join(
    ledgerDir(repoRoot),
    "latest-test-evidence.json",
  );
  if (!fs.existsSync(latestPath)) return false;
  const existing = JSON.parse(fs.readFileSync(latestPath, "utf8"));
  existing.stale = true;
  existing.stale_reason = reason;
  existing.stale_at = new Date().toISOString();
  writeJson(latestPath, existing);
  writeVaultTestEvidence(repoRoot, existing);
  return true;
}

function handlePostToolUse(payload) {
  const command = redactText(extractToolCommand(payload));
  const toolName = extractToolName(payload);
  const kind = commandKind(command, toolName);
  if (!kind) {
    emitContinue();
    return;
  }

  const cwd = resolveCwd(payload);
  const repoRoot = resolveRepoRoot(cwd);
  const git = collectGit(repoRoot);
  const responseText = redactText(extractToolResponse(payload));
  const exitCode = extractExitCode(payload);
  const event = {
    schema_version: 1,
    event: "posttooluse",
    kind,
    timestamp: new Date().toISOString(),
    session_id:
      payload.session_id || payload.sessionId || process.env.SESSION_ID || null,
    codex_thread_id: process.env.CODEX_THREAD_ID || null,
    repo_root: repoRoot,
    cwd,
    branch: git.branch,
    commit: git.commit,
    tool_name: toolName,
    command,
    exit_code: exitCode,
  };

  appendJsonl(
    path.join(ledgerDir(repoRoot), "posttooluse-events.jsonl"),
    event,
  );

  if (kind === "test") {
    const evidence = {
      ...event,
      type: "test-run",
      counts: parseTestCounts(responseText),
      stale: false,
      output_tail: tailLines(responseText, 80),
    };
    writeJson(
      path.join(ledgerDir(repoRoot), "latest-test-evidence.json"),
      evidence,
    );
    writeVaultTestEvidence(repoRoot, evidence);
    emitContinue({
      message: `Recorded Codex test evidence: ${git.branch} @ ${git.commit}`,
    });
    return;
  }

  if (kind === "git-state-change") {
    const marked = markLatestTestEvidenceStale(
      repoRoot,
      `git state changed after: ${command}`,
    );
    emitContinue({
      message: marked
        ? "Marked Codex test evidence stale after git state change."
        : "Git state changed; no Codex test evidence to mark stale.",
    });
    return;
  }

  if (kind === "github-context") {
    const context = {
      ...event,
      type: "github-context",
      output_tail: tailLines(responseText, 80),
    };
    writeJson(
      path.join(ledgerDir(repoRoot), "latest-github-context.json"),
      context,
    );
    emitContinue({ message: "Recorded latest GitHub context pointer." });
    return;
  }

  if (kind === "enterprise-gate") {
    const gate = {
      ...event,
      type: "enterprise-gate",
      output_tail: tailLines(responseText, 80),
    };
    writeJson(
      path.join(ledgerDir(repoRoot), "latest-enterprise-gate.json"),
      gate,
    );
    emitContinue({ message: "Recorded latest enterprise gate command." });
    return;
  }

  emitContinue();
}

function handlePreCompact(payload) {
  const packet = createPacket(payload);
  const written = writePacket(packet);
  emitContinue({
    message: `Captured enterprise context packet: ${written.packetPath}`,
  });
}

function handlePostCompact(payload) {
  const { latestPath, packet } = readLatestPacket(payload);
  if (!packet) {
    emitContinue({
      message: `No enterprise context packet found at ${latestPath}`,
    });
    return;
  }

  const card = makeResumeCard(packet);
  ensureDir(path.dirname(packet.paths.resume_card));
  fs.writeFileSync(packet.paths.resume_card, card);

  emitContinue({
    message: `Enterprise context available: ${packet.paths.resume_card}. Next: ${packet.next_action}`,
  });
}

try {
  const payload = readStdinJson();
  if (EVENT === "session-start" || EVENT === "sessionstart") {
    handleSessionStart(payload);
  } else if (EVENT === "userpromptsubmit" || EVENT === "prompt-submit") {
    handleUserPromptSubmit(payload);
  } else if (EVENT === "posttooluse" || EVENT === "post-tool-use") {
    handlePostToolUse(payload);
  } else if (EVENT === "precompact") {
    handlePreCompact(payload);
  } else if (EVENT === "postcompact") {
    handlePostCompact(payload);
  } else {
    emitContinue({
      message: "enterprise-context-hook: no supported event supplied",
    });
  }
} catch (error) {
  appendError(error);
  emitContinue({
    message: "enterprise-context-hook failed open; see hook error log",
  });
}
