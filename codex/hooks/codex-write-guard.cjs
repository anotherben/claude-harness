#!/usr/bin/env node
"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");

const HOME = os.homedir();
const HELPDESK_ROOTS = new Set(
  parsePathList(process.env.HELPDESK_ROOTS, [
    path.join(HOME, "helpdesk"),
    path.join(HOME, "Projects", "helpdesk"),
  ]).map((root) => path.resolve(root)),
);

function parsePathList(value, fallback) {
  if (!value) return fallback;
  return value
    .split(path.delimiter)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readPayload() {
  const input = fs.readFileSync(0, "utf8");
  if (!input.trim()) return {};
  try {
    return JSON.parse(input);
  } catch (_) {
    return {};
  }
}

function collectStrings(value, out = []) {
  if (value == null) return out;
  if (typeof value === "string") {
    out.push(value);
    return out;
  }
  if (typeof value !== "object") return out;
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out);
    return out;
  }
  for (const inner of Object.values(value)) collectStrings(inner, out);
  return out;
}

function toolInputCandidates(payload) {
  const candidates = [
    payload.tool_input,
    payload.toolInput,
    payload.input,
    payload.arguments,
  ];
  if (payload.tool && typeof payload.tool === "object") {
    candidates.push(
      payload.tool.tool_input,
      payload.tool.toolInput,
      payload.tool.input,
      payload.tool.arguments,
    );
  }
  return candidates.filter((value) => value != null);
}

function toolInputObjects(payload) {
  return toolInputCandidates(payload).filter(
    (value) => typeof value === "object" && !Array.isArray(value),
  );
}

function toolName(payload) {
  const candidates = [payload.tool_name, payload.name];
  if (typeof payload.tool === "string") candidates.push(payload.tool);
  if (payload.tool && typeof payload.tool === "object") {
    candidates.push(payload.tool.name, payload.tool.tool_name, payload.tool.id);
  }
  return String(
    candidates.find((value) => typeof value === "string" && value.trim()) || "",
  );
}

function extractCandidatePaths(payload) {
  const direct = [];
  for (const toolInput of toolInputObjects(payload)) {
    direct.push(
      toolInput.file_path,
      toolInput.path,
      toolInput.target_file,
      toolInput.dest,
      toolInput.destination,
    );
  }

  const text = collectStrings(toolInputCandidates(payload)).join("\n");
  const absolutePaths = Array.from(
    text.matchAll(/\/Users\/ben\/[^\s'"`),;]+/g),
    (match) => match[0],
  );
  const patchPaths = Array.from(
    text.matchAll(
      /^\*\*\* (?:Add File|Update File|Delete File|Move to):\s*(.+)$/gm,
    ),
    (match) => match[1].trim(),
  );
  const commandPaths = [];
  const commandText = toolInputObjects(payload)
    .flatMap((toolInput) => [toolInput.command, toolInput.cmd])
    .filter((value) => typeof value === "string")
    .join("\n");

  for (const match of commandText.matchAll(
    /(?:^|\s)(?:touch|chmod|chown|rm)\s+(?:-[^\s]+\s+)*([^\s'"`;&|<>]+)/g,
  )) {
    commandPaths.push(match[1]);
  }
  for (const match of commandText.matchAll(
    /(?:^|\s)(?:tee|cat)\s+(?:-[^\s]+\s+)*([^\s'"`;&|<>]+)/g,
  )) {
    commandPaths.push(match[1]);
  }
  for (const match of commandText.matchAll(
    /(?:^|[\s;|&])>{1,2}\s*([^\s'"`;&|<>]+)/g,
  )) {
    commandPaths.push(match[1]);
  }

  return Array.from(
    new Set([
      ...direct.filter((value) => typeof value === "string" && value.trim()),
      ...absolutePaths,
      ...patchPaths,
      ...commandPaths,
    ]),
  );
}

function isWriteLike(payload) {
  const name = toolName(payload).toLowerCase();
  const commands = [];
  for (const toolInput of toolInputObjects(payload)) {
    if (typeof toolInput.command === "string") commands.push(toolInput.command);
    if (typeof toolInput.cmd === "string") commands.push(toolInput.cmd);
  }
  if (/(^|\.)(apply_patch|write|edit|multiedit|str_replace)$/i.test(name))
    return true;
  if (!commands.length) return false;

  return /(^|\s)(apply_patch|tee|touch|chmod|chown|mv|cp|rm)\b|\bsed\s+-i\b|\bperl\s+-pi\b|(^|[\s;|&])>{1,2}\s*[^>]/i.test(
    commands.join("\n"),
  );
}

function isRouteCardRefreshCommand(payload) {
  const commandText = toolInputObjects(payload)
    .flatMap(function commandFields(toolInput) {
      return [toolInput.command, toolInput.cmd];
    })
    .filter(function isString(value) {
      return typeof value === "string";
    })
    .join("\n");

  return (
    /(?:^|\s|\/)enterprise-context-hook\.cjs\b/.test(commandText) &&
    /\bUserPromptSubmit\b|\buserpromptsubmit\b|\bprompt-submit\b/i.test(
      commandText,
    )
  );
}

function commandWorkdir(payload) {
  const commandText = toolInputObjects(payload)
    .flatMap(function commandFields(toolInput) {
      return [toolInput.command, toolInput.cmd];
    })
    .filter(function isString(value) {
      return typeof value === "string";
    })
    .join("\n");
  const match = commandText.match(/(?:^|\s)cd\s+([^;&|\n]+)/);
  if (!match) return null;
  const dir = match[1].trim().replace(/^['"]|['"]$/g, "");
  return path.isAbsolute(dir) ? dir : null;
}

function normalizePath(candidate, cwd) {
  if (!candidate || candidate.includes("\n")) return null;
  const trimmed = candidate.trim().replace(/^[<({]+|[>)}.,;:]+$/g, "");
  if (!trimmed || trimmed.startsWith("-") || /^[a-z]+:\/\//i.test(trimmed))
    return null;
  if (/^\d+$/.test(trimmed)) return null;
  if (/[\\[\]{}()]/.test(trimmed)) return null;
  if (
    /^[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*$/.test(trimmed) &&
    !/\.(?:cjs|css|env|html|js|json|jsx|md|mjs|sql|ts|tsx|ya?ml)$/i.test(
      trimmed,
    )
  ) {
    return null;
  }
  return path.resolve(
    path.isAbsolute(trimmed) ? trimmed : path.join(cwd, trimmed),
  );
}

function nearestHelpdeskRoot(filePath) {
  let matchedRoot = null;
  for (const root of HELP_DESK_ROOTS) {
    if (filePath === root || filePath.startsWith(`${root}${path.sep}`)) {
      if (!matchedRoot || root.length > matchedRoot.length) matchedRoot = root;
    }
  }
  if (!matchedRoot) return null;

  let dir = filePath;
  try {
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory())
      dir = path.dirname(dir);
  } catch (_) {
    dir = path.dirname(dir);
  }

  while (
    dir &&
    dir !== matchedRoot &&
    dir.startsWith(`${matchedRoot}${path.sep}`)
  ) {
    if (fs.existsSync(path.join(dir, ".git"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return matchedRoot;
}

function readRouteCard(root) {
  const routeCard = path.join(
    root,
    ".codex",
    "enterprise-state",
    "hook-ledger",
    "latest-route-card.json",
  );
  try {
    return JSON.parse(fs.readFileSync(routeCard, "utf8"));
  } catch (_) {
    return null;
  }
}

function block(message) {
  console.error(message);
  process.exit(2);
}

const payload = readPayload();
if (!isWriteLike(payload)) process.exit(0);
if (isRouteCardRefreshCommand(payload)) process.exit(0);

const workdir = toolInputObjects(payload)
  .map(function pickWorkdir(toolInput) {
    return toolInput.workdir || toolInput.cwd;
  })
  .find(function isNonEmptyString(value) {
    return typeof value === "string" && value.trim();
  });
const cwd =
  workdir ||
  commandWorkdir(payload) ||
  payload.cwd ||
  payload.project_dir ||
  process.env.PWD ||
  process.cwd();

for (const candidate of extractCandidatePaths(payload)) {
  const filePath = normalizePath(candidate, cwd);
  if (!filePath) continue;

  if (
    /(^|\/)\.env(\.local)?$/.test(filePath) ||
    /\/middleware\/auth\.js$/.test(filePath)
  ) {
    block(`BLOCKED: ${filePath} is protected. Ask Ben before editing it.`);
  }

  const helpdeskRoot = nearestHelpdeskRoot(filePath);
  if (!helpdeskRoot) continue;

  const routeCard = readRouteCard(helpdeskRoot);
  if (!routeCard || routeCard.allowed_to_edit_here !== true) {
    block(
      [
        `BLOCKED: ${filePath} is in guarded Helpdesk checkout ${helpdeskRoot}.`,
        "The latest route card does not allow edits here.",
        "Use a clean approved worktree or repair the route card before mutating Helpdesk files.",
      ].join("\n"),
    );
  }
}

process.exit(0);
