# Cortex Engine

**Code intelligence MCP server that makes AI agents 100x faster at understanding codebases.**

Instead of reading entire files (thousands of tokens), agents query specific symbols, search by semantic tags, and get git-aware context — all in under 1ms. Every response includes token-savings telemetry so you can measure the impact.

## The Problem

An AI agent working on a codebase pays for every token of code it reads. A 400-line service file costs ~3,300 tokens, but the agent usually only needs one 30-line function (~380 tokens). That's an **89% waste on every file read**.

Multiply that by hundreds of reads per session, across multiple agents, and you're burning thousands of dollars on tokens the agent didn't need.

Cortex Engine fixes this.

## What Makes It Different

| Capability | Traditional Tools | Cortex Engine |
|-----------|-------------------|---------------|
| Index freshness | Manual reindex after edits | **Real-time** file watcher — updates in milliseconds |
| Query speed | 10-160ms | **<1ms** — SQLite with precomputed scores |
| Semantic understanding | Names and signatures only | **Rule-based tags**: `db_write`, `unscoped_query`, `route_handler`, `auth`, `validated` |
| Symbol depth | Top-level exports only | **Nested extraction**: factory methods, local helpers, inner types, interface members |
| File types | 5-7 | **20** — JS, TS, Python, SQL, JSON, YAML, GraphQL, Markdown, HTML, CSS, Vue, Svelte, + more |
| Symbol categories | None | **6 types**: code, config, docs, markup, style, query — search filters by default |
| Token telemetry | Varies | **Every response** includes tokens_saved, cost_avoided, cumulative stats |
| Git awareness | None | **Blame, hotspots, diff, log** — "who changed this and why?" |
| Knowledge persistence | None | **Annotations survive across sessions** — agents learn from each other |
| Import graph | Varies | **Cross-extension resolution** (.js→.ts), barrel exports, path normalization |
| Multi-repo | Varies | **Built-in** — query across N projects simultaneously |

## Quick Start

```bash
cd cortex-engine
npm install
```

**Claude Code** — add to `~/.claude.json`:
```json
{
  "mcpServers": {
    "cortex-engine": {
      "type": "stdio",
      "command": "/path/to/.codex/bin/cortex-engine-wrapper.sh",
      "args": []
    }
  }
}
```

**Codex CLI:**
```bash
codex mcp add cortex-engine -- /path/to/.codex/bin/cortex-engine-wrapper.sh
```

No project path needed — Cortex uses the working directory automatically.

## E2E Use Case: "Add retry logic to the payment webhook"

Here's what happens when an AI agent uses Cortex to implement a feature, vs reading files directly:

```
Agent's task: "Add retry logic to the payment webhook handler"

Step 1 — Find the handler
  Without Cortex: grep for "payment" → read 8 files → 26,000 tokens
  With Cortex:    cortex_find_symbol("payment webhook") → 3 results, 200 tokens
  Saved: 25,800 tokens ($0.39 on Opus)

Step 2 — Read the handler code
  Without Cortex: Read full webhook file (400 lines) → 3,300 tokens
  With Cortex:    cortex_read_symbol("handlePaymentWebhook") → 380 tokens
  Saved: 2,920 tokens ($0.04)

Step 3 — Check what imports this file (blast radius)
  Without Cortex: grep for imports, read each file → 15,000 tokens
  With Cortex:    cortex_find_importers("webhooks/payment.js") → 2 files, 150 tokens
  Saved: 14,850 tokens ($0.22)

Step 4 — Check for existing retry patterns
  Without Cortex: search and read multiple files → 8,000 tokens
  With Cortex:    cortex_find_by_tag("error_handler") → 12 symbols, 400 tokens
  Saved: 7,600 tokens ($0.11)

Step 5 — Check git history for past webhook bugs
  Without Cortex: git log + read diffs manually → 5,000 tokens
  With Cortex:    cortex_git_hotspots() + cortex_git_log(file) → 800 tokens
  Saved: 4,200 tokens ($0.06)

Step 6 — Annotate the fix for future agents
  Without Cortex: write a comment, hope someone reads it
  With Cortex:    cortex_annotate("webhooks/payment.js", "Added 3-retry with backoff, see PR #142")
                  Future agents: cortex_recall("webhooks/payment.js") → instant context

Total for this feature:
  Without Cortex: ~57,300 tokens ($0.86 on Opus)
  With Cortex:    ~1,930 tokens ($0.03 on Opus)
  Saved: 55,370 tokens (97%), $0.83 per feature
```

At 20 features/day across 3 agents: **$50/day saved, $1,500/month**.

## Token Telemetry

Every Cortex response includes a `_meta` object with savings data:

```json
{
  "_meta": {
    "timing_ms": 0.42,
    "tokens_saved": 2933,
    "file_tokens": 3314,
    "response_tokens": 381,
    "cost_avoided": {
      "claude_opus_4_6": 0.044,
      "claude_sonnet_4_6": 0.0088,
      "claude_haiku_4_5": 0.0023
    },
    "cumulative": {
      "total_queries": 847,
      "total_tokens_saved": 1423000,
      "total_cost_avoided": {
        "claude_opus_4_6": 21.35,
        "claude_sonnet_4_6": 4.27,
        "claude_haiku_4_5": 1.14
      }
    }
  }
}
```

Use `cortex_telemetry()` for a full session report.

## 30 MCP Tools

### File & Structure
| Tool | What it does |
|------|-------------|
| `cortex_tree` | File tree with path prefix filter |
| `cortex_outline` | All symbols in a file — functions, classes, methods with line ranges |
| `cortex_read_symbol` | Full source code of one specific function/class |
| `cortex_read_symbols` | Batch read multiple symbols in one call |
| `cortex_read_range` | Read specific line range from a file |
| `cortex_context` | Symbol + its imports + file outline in one call |

### Search
| Tool | What it does |
|------|-------------|
| `cortex_find_symbol` | Search symbols by name with relevance scoring (exact > prefix > contains) |
| `cortex_find_text` | Regex search across all indexed file contents |
| `cortex_find_references` | Find all references to an identifier |
| `cortex_find_importers` | Find files that import a given file (cross-extension, barrel-aware) |
| `cortex_find_by_tag` | Find symbols by semantic tag (`db_write`, `unscoped_query`, etc.) |

### Git Context
| Tool | What it does |
|------|-------------|
| `cortex_git_status` | Branch, uncommitted changes, staged files |
| `cortex_git_diff` | Diff vs branch/commit |
| `cortex_git_blame` | Who last changed each line and why |
| `cortex_git_log` | Recent commits, optionally filtered by file |
| `cortex_git_hotspots` | Files with most edits/bug fixes — churn detection |

### Knowledge Store
| Tool | What it does |
|------|-------------|
| `cortex_annotate` | Add a persistent note to a file, symbol, or pattern |
| `cortex_recall` | Get all annotations for a file or symbol |
| `cortex_patterns` | Get pattern annotations for a directory |
| `cortex_lessons` | Get lessons learned, filterable by tag |

### Fleet & Admin
| Tool | What it does |
|------|-------------|
| `cortex_ingest_handover` | Extract lessons from agent handovers into knowledge store |
| `cortex_learning_report` | Fleet-wide report: what did all agents learn? |
| `cortex_fleet_mcp_config` | Get MCP config for dispatching workers with cortex |
| `cortex_status` | Index health — file count, symbol count, staleness |
| `cortex_reindex` | Force reindex of specific file or all files |
| `cortex_telemetry` | Cumulative token savings report |

## Semantic Tags

Deterministic, free, no API calls. Configurable per project.

| Tag | What it means |
|-----|--------------|
| `db_read` | SELECT query (pool.query, prisma.findMany, knex.select, etc.) |
| `db_write` | INSERT/UPDATE/DELETE (pool.query, prisma.create, knex.insert, etc.) |
| `tenant_scoped` | Query includes tenant_id |
| `unscoped_query` | DB query WITHOUT tenant_id — security risk |
| `route_handler` | Express router.get/post or decorator @Get/@Post |
| `auth` | @Auth, @Guard, @UseGuards, authenticate, requireAuth |
| `validated` | @Body, @Param, @Query, validate(), schema.parse() |
| `async` | Uses async/await |
| `error_handler` | Has try/catch |
| `no_error_handling` | DB/API call without try/catch |
| `exported` | In module.exports or export |

Custom rules via `cortex.config.js`:
```js
module.exports = {
  tagRules: {
    customRules: [
      { tag: 'stripe_api', pattern: /stripe\./ },
      { tag: 'cache_hit', pattern: /redis\.get|cache\.get/ },
    ],
  },
};
```

## Symbol Categories

Every symbol is categorized by source file type. Search defaults to code + query.

| Category | File Types | In default search |
|----------|-----------|:-:|
| `code` | .ts, .tsx, .js, .jsx, .py, .sh | Yes |
| `query` | .sql, .graphql | Yes |
| `config` | .json, .yaml, .toml | No (opt-in) |
| `docs` | .md | No (opt-in) |
| `markup` | .html, .xml, .vue, .svelte | No (opt-in) |
| `style` | .css, .scss, .less | No (opt-in) |

Search all categories: `cortex_find_symbol("auth", source_types=["code","config","docs","markup","style","query"])`

## Architecture

```
┌──────────────────────────────────────────────┐
│           MCP Interface (26 tools)            │
│         @modelcontextprotocol/sdk             │
└──────────────────┬───────────────────────────┘
                   │
┌──────────────────┴───────────────────────────┐
│              Index Engine                     │
│  Coordinates: Store + Parser + Watcher        │
│  Real-time updates on file changes            │
└──────────────────┬───────────────────────────┘
                   │
┌────────┬─────────┴─────────┬─────────────────┐
│ Parser │     Store         │   Watcher        │
│ tree-  │     SQLite        │   chokidar       │
│ sitter │     (WAL mode)    │   (real-time)    │
│ + regex│     + FTS + tags  │                  │
│fallback│                   │                  │
└────────┴───────────────────┴─────────────────┘
         │
┌────────┴──────────────┐
│  Telemetry            │
│  Token savings,       │
│  cost tracking,       │
│  cumulative stats     │
└───────────────────────┘
```

## Dependencies

| Package | Version | Why |
|---------|---------|-----|
| `@modelcontextprotocol/sdk` | ^1.27.1 | MCP protocol (stdio transport) |
| `better-sqlite3` | ^12.8.0 | Embedded DB, WAL mode, synchronous reads |
| `chokidar` | ^3.6.0 | Real-time file watcher (pinned v3 — v5 is ESM-only) |
| `simple-git` | ^3.33.0 | Git blame, log, diff, status |
| `tree-sitter` | ^0.21.1 | AST parsing for JS/TS/TSX (pinned — peer deps) |
| `tree-sitter-javascript` | ^0.21.4 | JS grammar |
| `tree-sitter-typescript` | ^0.23.2 | TS + TSX grammars |
| `jest` | ^30.3.0 | Test runner (dev, maxWorkers=14 for tree-sitter isolation) |

## Tests

```bash
npm test    # 333 tests across 18 suites
```

## License

MIT
