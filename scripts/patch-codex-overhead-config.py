#!/usr/bin/env python3
"""Render scope-aligned Codex config while preserving unrelated TOML."""

from __future__ import annotations

import json
import re
import sys
import tomllib
from dataclasses import dataclass
from pathlib import Path


HEADER_LINE_RE = re.compile(r"^[ \t]*(\[\[?[^\]\n]+\]\]?)[ \t]*(?:#.*)?(?:\n)?$")


@dataclass(frozen=True)
class Header:
    line: int
    text: str


def toml_string(value: str) -> str:
    return json.dumps(value)


def scan_headers(lines: list[str]) -> list[Header]:
    """Return table headers that occur outside TOML multiline strings."""
    headers: list[Header] = []
    multiline: str | None = None

    for line_number, line in enumerate(lines):
        if multiline is None:
            match = HEADER_LINE_RE.match(line)
            if match:
                headers.append(Header(line_number, match.group(1).strip()))

        index = 0
        quote: str | None = None
        escaped = False
        while index < len(line):
            if multiline is not None:
                closing = line.find(multiline, index)
                if closing == -1:
                    break
                index = closing + 3
                multiline = None
                continue

            char = line[index]
            if quote == '"':
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    quote = None
                index += 1
                continue
            if quote == "'":
                if char == "'":
                    quote = None
                index += 1
                continue
            if char == "#":
                break
            token = line[index : index + 3]
            if token in ('"""', "'''"):
                multiline = token
                index += 3
                continue
            if char in ('"', "'"):
                quote = char
            index += 1

    if multiline is not None:
        raise ValueError(f"unterminated TOML multiline string {multiline}")
    return headers


def key_line_pattern(key: str) -> re.Pattern[str]:
    return re.compile(rf"^[ \t]*{re.escape(key)}[ \t]*=[ \t]*(.*?)(?:\n)?$")


def replace_key(lines: list[str], key: str, value: str) -> list[str]:
    pattern = key_line_pattern(key)
    matches = [index for index, line in enumerate(lines) if pattern.match(line)]
    if len(matches) > 1:
        raise ValueError(f"duplicate TOML key in patch span: {key}")
    if matches:
        index = matches[0]
        rhs = pattern.match(lines[index]).group(1)
        if '"""' in rhs or "'''" in rhs:
            raise ValueError(f"refusing to rewrite multiline TOML key: {key}")
        indent = re.match(r"^[ \t]*", lines[index]).group(0)
        lines[index] = f"{indent}{key} = {value}\n"
        return lines
    if lines and not lines[-1].endswith("\n"):
        lines[-1] += "\n"
    lines.append(f"{key} = {value}\n")
    return lines


def remove_key(lines: list[str], key: str) -> list[str]:
    pattern = key_line_pattern(key)
    matches = [index for index, line in enumerate(lines) if pattern.match(line)]
    if len(matches) > 1:
        raise ValueError(f"duplicate TOML key in patch span: {key}")
    if not matches:
        return lines
    index = matches[0]
    rhs = pattern.match(lines[index]).group(1)
    if '"""' in rhs or "'''" in rhs:
        raise ValueError(f"refusing to remove multiline TOML key: {key}")
    del lines[index]
    return lines


def table_span(lines: list[str], name: str) -> tuple[int, int] | None:
    headers = scan_headers(lines)
    wanted = f"[{name}]"
    for index, header in enumerate(headers):
        if header.text != wanted:
            continue
        end = headers[index + 1].line if index + 1 < len(headers) else len(lines)
        return header.line, end
    return None


def upsert_root(lines: list[str], settings: dict[str, str]) -> list[str]:
    headers = scan_headers(lines)
    end = headers[0].line if headers else len(lines)
    block = lines[:end]
    for key, value in settings.items():
        block = replace_key(block, key, value)
    return block + lines[end:]


def upsert_table(
    lines: list[str],
    name: str,
    settings: dict[str, str],
    remove: tuple[str, ...] = (),
) -> list[str]:
    span = table_span(lines, name)
    if span is None:
        if lines and lines[-1].strip():
            lines.append("\n")
        lines.append(f"[{name}]\n")
        for key, value in settings.items():
            lines.append(f"{key} = {value}\n")
        return lines

    start, end = span
    block = lines[start + 1 : end]
    for key in remove:
        block = remove_key(block, key)
    for key, value in settings.items():
        block = replace_key(block, key, value)
    return lines[: start + 1] + block + lines[end:]


def array_table_spans(lines: list[str], name: str) -> list[tuple[int, int]]:
    headers = scan_headers(lines)
    wanted = f"[[{name}]]"
    spans: list[tuple[int, int]] = []
    for index, header in enumerate(headers):
        if header.text != wanted:
            continue
        end = headers[index + 1].line if index + 1 < len(headers) else len(lines)
        spans.append((header.line, end))
    return spans


def parse_skill_config_block(block: list[str]) -> dict[str, object]:
    parsed = tomllib.loads("".join(block))
    entries = parsed.get("skills", {}).get("config", [])
    if len(entries) != 1 or not isinstance(entries[0], dict):
        raise ValueError("invalid [[skills.config]] block")
    return entries[0]


def disable_duplicate_skills(lines: list[str], user_home: Path) -> list[str]:
    targets = [
        user_home / ".agents" / "skills" / name / "SKILL.md"
        for name in ("blast-radius", "diagnose", "patch-or-fix")
    ]

    for target in targets:
        found = False
        for start, end in reversed(array_table_spans(lines, "skills.config")):
            block = lines[start:end]
            entry = parse_skill_config_block(block)
            configured = entry.get("path")
            if not isinstance(configured, str):
                continue
            if Path(configured).expanduser().resolve() != target.resolve():
                continue
            block = replace_key(block, "enabled", "false")
            lines = lines[:start] + block + lines[end:]
            found = True

        if not found and target.exists():
            if lines and lines[-1].strip():
                lines.append("\n")
            lines.extend(
                [
                    "[[skills.config]]\n",
                    f"path = {toml_string(str(target))}\n",
                    "enabled = false\n",
                ]
            )
    return lines


def render(config: Path, user_home: Path) -> str:
    original = config.read_text(encoding="utf-8") if config.exists() else ""
    if original:
        tomllib.loads(original)
    lines = original.splitlines(keepends=True)
    lines = upsert_root(
        lines,
        {
            "approval_policy": toml_string("on-request"),
            "model_reasoning_effort": toml_string("high"),
            "plan_mode_reasoning_effort": toml_string("xhigh"),
            "sandbox_mode": toml_string("workspace-write"),
            "model": toml_string("gpt-5.6-sol"),
            "tool_output_token_limit": "2500",
            "model_reasoning_summary": toml_string("concise"),
            "model_verbosity": toml_string("medium"),
        },
    )
    lines = upsert_table(
        lines,
        "agents",
        {
            "job_max_runtime_seconds": "1800",
            "max_depth": "1",
            "max_concurrent_threads_per_session": "4",
        },
        remove=("max_threads",),
    )
    lines = upsert_table(
        lines,
        "features",
        {
            "apps": "true",
            "hooks": "true",
            "multi_agent": "true",
            "memories": "true",
            "goals": "true",
            "plugins": "true",
        },
    )
    lines = disable_duplicate_skills(lines, user_home)
    body = "".join(lines)
    if body and not body.endswith("\n"):
        body += "\n"
    tomllib.loads(body)
    return body


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: patch-codex-overhead-config.py <config.toml> <user-home>", file=sys.stderr)
        return 2
    config = Path(sys.argv[1])
    user_home = Path(sys.argv[2]).expanduser()
    sys.stdout.write(render(config, user_home))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
