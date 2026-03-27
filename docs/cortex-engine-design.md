# Cortex Engine — Code Intelligence MCP Server

## The Problem (First Principles)

An AI agent working on a codebase has a fundamental constraint: **every token of code it reads costs money, time, and context window space.** The agent needs to understand enough code to make correct changes, but reading entire files is wasteful — a 400-line service file might have 30 functions when the agent only needs 1.

jcodemunch solved this with AST-based symbol extraction: index the codebase, let agents query individual symbols. This works, but it treats the codebase as a **static document** — a book you look things up in. The index goes stale after edits, doesn't know about git history, and can't tell you *what the code does*, only *what it's named*.

The real problem isn't "how do I read less code?" It's **"how does an agent build the right mental model of a codebase with minimum token cost?"**

## Design Philosophy

### 1. The Index Is Never Stale

jcodemunch requires manual `index_folder(incremental=true)` after every edit. This creates a correctness gap — agents query stale data between edits and reindexes. The window is small but the bugs are subtle.

**Cortex uses filesystem watchers.** When a file changes (from any source — agent edit, git checkout, manual save), the index updates within milliseconds. No manual reindex step. The agent always sees current state.

### 2. Git Is a First-Class Citizen

Code doesn't exist in isolation — it has history. An agent making changes needs to know:
- What branch am I on?
- What files have uncommitted changes?
- Who last changed this function and why? (blame)
- What changed between this branch and main? (diff)
- How often has this file been modified recently? (hotspot detection)

jcodemunch has zero git awareness. Cortex makes git a core data source — branch context, diff awareness, blame integration, and change frequency analysis are built into every query.

### 3. Semantic Understanding, Not Just Syntax

AST parsing tells you "there's a function called `listOrders` that takes `{status, page, limit}`." It doesn't tell you:
- This function queries the database (it's a data access function)
- It's missing tenant_id scoping (security concern)
- It's called from 3 routes and 1 background job
- The test coverage is 60% — the pagination path is untested
- Last 2 commits to this function were both bug fixes

Cortex adds a **semantic layer** on top of syntax. It classifies code by what it *does*, not just what it's *named*. This happens at index time, not query time, so it's free for the agent.

### 4. The Codebase Remembers

When an agent finishes work, the knowledge it gained (decisions made, bugs found, patterns noticed) evaporates. The next agent starts fresh. jcodemunch has no memory — it's a stateless index.

Cortex has a **knowledge store** that accumulates over time:
- File annotations: "This file has had 4 tenant_id bugs — always check scoping"
- Pattern markers: "Functions in this directory that query the DB should use the service pattern, not direct pool.query"
- Decision log: "We chose toLocaleString over manual regex for currency formatting — see PR #234"

This isn't AI summarization of every file. It's **targeted annotations attached by humans and agents** when they learn something worth preserving.

## Architecture

```
┌─────────────────────────────────────────────────┐
│                  MCP Interface                    │
│         (@modelcontextprotocol/sdk)               │
│                                                   │
│  Tools exposed to Claude:                        │
│  ├─ File & Structure                             │
│  ├─ Symbol Navigation                            │
│  ├─ Search                                       │
│  ├─ Git Context                                  │
│  ├─ Dependency Graph                             │
│  └─ Knowledge Store                              │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────┴────────────────────────────────┐
│              Query Engine                         │
│                                                   │
│  Resolves tool calls against:                    │
│  ├─ Symbol Index (SQLite)                        │
│  ├─ File Cache (in-memory LRU)                   │
│  ├─ Git State (simple-git)                       │
│  └─ Knowledge Store (JSON append-log)            │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────┴────────────────────────────────┐
│              Index Engine                         │
│                                                   │
│  Maintains index freshness:                      │
│  ├─ File Watcher (chokidar)                      │
│  │   └─ On change → re-parse affected file       │
│  ├─ AST Parser (tree-sitter)                     │
│  │   └─ Multi-language symbol extraction          │
│  ├─ Semantic Tagger                              │
│  │   └─ Classifies: DB access, route, test, etc. │
│  └─ Git Monitor                                  │
│      └─ Branch changes, commit hooks             │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────┴────────────────────────────────┐
│              Storage Layer                        │
│                                                   │
│  SQLite database (.cortex/index.db):             │
│  ├─ files: path, hash, mtime, language, size     │
│  ├─ symbols: name, kind, signature, file, range  │
│  ├─ imports: source_file, target, identifiers    │
│  ├─ tags: symbol_id, tag (db_read, db_write,     │
│  │        route_handler, test, middleware, etc.)  │
│  ├─ git_blame: file, line_range, author, date    │
│  ├─ hotspots: file, edit_count_30d, bug_count    │
│  └─ knowledge: file_pattern, note, author, date  │
│                                                   │
│  In-memory:                                      │
│  ├─ File content LRU cache (configurable size)   │
│  └─ Dependency graph (adjacency list)            │
└─────────────────────────────────────────────────┘
```

## Tool API (MCP Interface)

### File & Structure

| Tool | Purpose | jcodemunch equivalent |
|------|---------|---------------------|
| `tree` | File tree with optional depth limit, glob filter | get_file_tree |
| `outline` | Symbols in a file with semantic tags | get_file_outline |
| `read_symbol` | Full source of one symbol | get_symbol |
| `read_symbols` | Batch read multiple symbols | get_symbols |
| `read_range` | Read specific line range of a file | get_file_content |
| `context` | Symbol + imports + related symbols in same file | get_context_bundle |

### Search

| Tool | Purpose | jcodemunch equivalent |
|------|---------|---------------------|
| `find_symbol` | Search symbols by name, kind, tag | search_symbols |
| `find_text` | Regex/literal search across files | search_text |
| `find_references` | Where is this symbol used? | find_references |
| `find_importers` | What files import this file? | find_importers |
| `find_callers` | What functions call this function? | NEW — call graph |
| `find_by_tag` | Find all DB-writing functions, all routes, etc. | NEW — semantic search |

### Git Context

| Tool | Purpose | jcodemunch equivalent |
|------|---------|---------------------|
| `git_status` | Branch, uncommitted changes, staged files | NEW |
| `git_diff` | Diff vs branch/commit with symbol-level granularity | NEW |
| `git_blame` | Who last changed this symbol and why? | NEW |
| `git_log` | Recent commits touching a file or symbol | NEW |
| `git_hotspots` | Files with most edits/bugs in last N days | NEW |

### Knowledge Store

| Tool | Purpose | jcodemunch equivalent |
|------|---------|---------------------|
| `annotate` | Add a note to a file/symbol/pattern | NEW |
| `recall` | Get all annotations for a file/symbol | NEW |
| `patterns` | Get common patterns/anti-patterns in a directory | NEW |
| `lessons` | Get lessons learned related to current work | NEW |

### Index Management

| Tool | Purpose | jcodemunch equivalent |
|------|---------|---------------------|
| `status` | Index health: file count, staleness, coverage | list_repos + get_repo_outline |
| `reindex` | Force full reindex (normally automatic) | index_folder |
| `configure` | Set watch paths, ignore patterns, languages | NEW |

## Semantic Tags

During AST parsing, Cortex classifies symbols with semantic tags. These aren't AI-generated — they're rule-based patterns that are fast and deterministic:

| Tag | Detection Rule | Value to Agent |
|-----|---------------|----------------|
| `db_read` | Contains `pool.query` with SELECT | "This function reads from the database" |
| `db_write` | Contains `pool.query` with INSERT/UPDATE/DELETE | "This function modifies data — check tenant_id" |
| `route_handler` | Inside `router.get/post/put/delete` | "This is an API endpoint" |
| `middleware` | Function signature matches Express middleware | "This runs on every request in its scope" |
| `test` | Inside `describe/it/test` block | "This is a test function" |
| `async` | Uses async/await or returns Promise | "This function is async" |
| `exported` | In module.exports or export statement | "This is part of the public API" |
| `tenant_scoped` | Query includes `tenant_id` parameter | "This respects multi-tenancy" |
| `unscoped_query` | DB query WITHOUT tenant_id | "WARNING: potential tenant leak" |
| `error_handler` | Contains try/catch or .catch() | "Has error handling" |
| `no_error_handling` | DB/API call without try/catch | "Missing error handling" |

These tags are project-configurable. The my-project project would add:
- `rex_soap` — calls to REX SOAP API
- `shopify_api` — calls to Shopify
- `queue_worker` — processes items from a queue

## What Makes This Better Than jcodemunch

| Dimension | jcodemunch | Cortex Engine |
|-----------|-----------|---------------|
| **Freshness** | Manual reindex after edits | Real-time file watcher |
| **Git awareness** | None | Branch, diff, blame, hotspots |
| **Semantic understanding** | AST only (names, signatures) | Rule-based semantic tags |
| **Knowledge accumulation** | None | Annotation store that grows over time |
| **File limit** | 2000 per index_folder call | No limit (SQLite scales) |
| **Language support** | JavaScript/TypeScript focus | tree-sitter (40+ languages) |
| **.cjs support** | No (needs staging bridge) | Yes (tree-sitter handles it) |
| **Dependency** | External Python package (uvx) | Node.js — same stack as project |
| **Startup** | Slow (Python, MCP handshake, full parse) | Fast (SQLite warm cache, incremental) |
| **Availability** | Flaky across session types | Embedded — always available |
| **Call graph** | Import-level only | Function-level call tracking |
| **Hotspot detection** | None | Git history analysis |
| **Multi-repo** | Yes (GitHub integration) | No (single project focus) |
| **AI summaries** | Optional (Anthropic/Google API) | No (rule-based — deterministic, free) |

## Implementation Plan

### Phase 1: Core Index Engine (replaces jcodemunch 1:1)

**Files:** `cortex-engine/src/index.js`, `cortex-engine/src/parser.js`, `cortex-engine/src/store.js`

- tree-sitter AST parsing for JS/TS/JSX/TSX
- SQLite storage for files, symbols, imports
- File watcher (chokidar) for real-time updates
- MCP server with: tree, outline, read_symbol, read_symbols, read_range, context, find_symbol, find_text, find_references, find_importers, status, reindex

**Acceptance:** Can replace jcodemunch in my-project project. suggest-jcodemunch.sh hook points to Cortex instead.

### Phase 2: Git Integration

**Files:** `cortex-engine/src/git.js`

- git_status, git_diff, git_blame, git_log, git_hotspots
- Symbol-level diff (not just file-level — "which functions changed?")
- Hotspot scoring: edits × recency × bug_fix_ratio

**Acceptance:** Agent can ask "what functions changed on this branch?" and "which files have the most churn?"

### Phase 3: Semantic Tags

**Files:** `cortex-engine/src/tagger.js`, `cortex-engine/cortex.config.js`

- Rule-based semantic classification during indexing
- Configurable per-project tag rules
- find_by_tag tool
- Automatic "unscoped_query" detection for multi-tenant projects

**Acceptance:** Agent can ask "show me all functions that write to the database without tenant_id scoping"

### Phase 4: Knowledge Store

**Files:** `cortex-engine/src/knowledge.js`

- Append-only annotation store
- annotate, recall, patterns, lessons tools
- Integration with conductor handovers (auto-extract lessons from worker handovers)
- Obsidian sync (write annotations to vault for human visibility)

**Acceptance:** Agent asks "what do I need to know about orderService.js?" and gets: "4 tenant_id bugs in last month, always use service pattern, see decision log entry #12"

### Phase 5: Conductor + Fleet Integration

- Workers auto-connect to Cortex Engine (MCP config in conductor dispatch)
- Worker handovers feed into knowledge store
- Orchestrator queries hotspots to prioritize reviews
- Fleet-wide "what did we learn today?" report

## Technology Choices

| Component | Choice | Why |
|-----------|--------|-----|
| **Runtime** | Node.js 20+ | Same stack as project, native async, fast startup |
| **AST Parser** | tree-sitter via node bindings | Battle-tested (GitHub, Neovim), 40+ languages, incremental parsing |
| **Storage** | better-sqlite3 | Synchronous (no async overhead for reads), embedded, fast, WAL mode for concurrent access |
| **File Watcher** | chokidar | De facto Node.js file watcher, handles macOS FSEvents |
| **Git** | simple-git | Clean API, well-maintained, handles all git operations |
| **MCP SDK** | @modelcontextprotocol/sdk | Official SDK, stdio transport |
| **Config** | cortex.config.js | JS config file — can express tag rules as functions |

## Project Structure

```
cortex-engine/
├── package.json
├── cortex.config.js          # Default config (overridable per-project)
├── src/
│   ├── server.js             # MCP server entry point
│   ├── index.js              # Index engine (coordinates parser, store, watcher)
│   ├── parser.js             # tree-sitter AST parsing + symbol extraction
│   ├── store.js              # SQLite storage layer
│   ├── watcher.js            # chokidar file watcher
│   ├── git.js                # Git integration (simple-git)
│   ├── tagger.js             # Semantic tag rules engine
│   ├── knowledge.js          # Annotation/knowledge store
│   ├── tools/                # MCP tool implementations
│   │   ├── file-tools.js     # tree, outline, read_symbol, read_range, context
│   │   ├── search-tools.js   # find_symbol, find_text, find_references, find_callers
│   │   ├── git-tools.js      # git_status, git_diff, git_blame, git_hotspots
│   │   ├── knowledge-tools.js # annotate, recall, patterns, lessons
│   │   └── admin-tools.js    # status, reindex, configure
│   └── queries/              # SQL queries (named, not inline)
│       ├── symbols.sql
│       ├── imports.sql
│       ├── search.sql
│       └── knowledge.sql
├── grammars/                 # tree-sitter grammar WASM files
│   ├── javascript.wasm
│   ├── typescript.wasm
│   └── ...
├── test/
│   ├── parser.test.js
│   ├── store.test.js
│   ├── tagger.test.js
│   └── integration.test.js
└── .cortex/                  # Runtime data (gitignored)
    ├── index.db              # SQLite index
    ├── knowledge.jsonl       # Append-only knowledge log
    └── cortex.log            # Debug log
```

## Non-Goals (Prototype)

- Multi-repo support (single project focus — simpler, faster)
- AI-generated summaries (rule-based is cheaper and deterministic)
- Browser/HTTP interface (MCP stdio only for now)
- TypeScript type checking (AST parsing, not type resolution)
- LSP compatibility (we're building for MCP, not editors)
