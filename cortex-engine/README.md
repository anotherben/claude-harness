# Cortex Engine

**Code intelligence MCP server that makes AI agents 100x faster at understanding codebases.**

Instead of reading entire files (thousands of tokens), agents query specific symbols, search by semantic tags, and get git-aware context — all in under 1ms.

## The Problem

An AI agent working on a codebase pays for every token of code it reads. A 400-line service file costs ~4,000 tokens, but the agent usually only needs one 15-line function (~150 tokens). That's a 96% waste on every file read.

Existing tools like jcodemunch solve this with AST-based indexing, but they treat the codebase as a static document — the index goes stale after edits, there's no git awareness, and they can't tell you *what the code does*, only *what it's named*.

Cortex Engine fixes all of this.

## What Makes It Different

| Capability | Traditional | Cortex Engine |
|-----------|-------------|---------------|
| Index freshness | Manual reindex after edits | **Real-time** file watcher — index updates in milliseconds |
| Query speed | 2-160ms | **<1ms** — SQLite with precomputed scores |
| Semantic understanding | Names and signatures only | **Rule-based tags**: `db_read`, `db_write`, `unscoped_query`, `route_handler`, `tenant_scoped` |
| Git awareness | None | **Blame, hotspots, diff, log** — "who changed this and why?" |
| Knowledge persistence | None | **Annotations survive across sessions** — agents learn from each other |
| Multi-repo | Varies | **Built-in** — query across N projects simultaneously |
| Languages | Varies | **10 extensions** — JS, TS, TSX, JSX, CJS, Python, Bash, SQL, CSS |

## Quick Start

```bash
# Install
cd cortex-engine
npm install

# Run as MCP server (stdio)
node src/server.js /path/to/your/project

# Or use the CLI
npx cortex-engine /path/to/your/project
```

### Claude Code

Add to `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "cortex-engine": {
      "command": "node",
      "args": ["/path/to/cortex-engine/src/server.js", "/path/to/your/project"]
    }
  }
}
```

### Codex

```bash
codex mcp add cortex-engine -- node /path/to/cortex-engine/src/server.js /path/to/your/project
```

## 25 MCP Tools

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
| `cortex_find_importers` | Find files that import a given file |
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

## Semantic Tags

During indexing, Cortex classifies every function with semantic tags. These are rule-based (deterministic, free, no API calls):

| Tag | What it means | Why it matters |
|-----|--------------|----------------|
| `db_read` | Contains `SELECT` query | Data access function |
| `db_write` | Contains `INSERT`/`UPDATE`/`DELETE` | Mutates data — review carefully |
| `tenant_scoped` | Query includes `tenant_id` | Multi-tenant safe |
| `unscoped_query` | DB query WITHOUT `tenant_id` | **Security risk** — potential data leak |
| `route_handler` | Inside `router.get/post/put/delete` | API endpoint |
| `async` | Uses async/await | Async function |
| `error_handler` | Has try/catch | Has error handling |
| `no_error_handling` | DB/API call without try/catch | Missing error handling |
| `exported` | In module.exports | Part of public API |

Custom tags are configurable per project via `cortex.config.js`:

```js
module.exports = {
  tagRules: {
    customRules: [
      { tag: 'shopify_api', pattern: /shopifyClient\./ },
      { tag: 'rex_soap', pattern: /rexClient\.call/ },
    ],
  },
};
```

## Multi-Repo

Index multiple projects simultaneously:

```js
const MultiRepoEngine = require('cortex-engine/src/multirepo');

const engine = new MultiRepoEngine([
  { name: 'backend', root: '/path/to/api' },
  { name: 'frontend', root: '/path/to/admin' },
  { name: 'shared', root: '/path/to/packages' },
]);

// Search across all repos — results tagged with repo name
const results = engine.findSymbol('handleOrder');
// [{ name: 'handleOrder', repo: 'backend', score: 100, ... }]
```

## Knowledge Store

Cortex accumulates knowledge over time. Agents can annotate files and symbols with lessons, patterns, and warnings that persist across sessions:

```
cortex_annotate({
  target: "services/orderService.js",
  note: "4 tenant_id bugs in last month — always check scoping",
  tags: ["lesson", "tenant_id"]
})

// Later, any agent asks:
cortex_recall({ target: "services/orderService.js" })
// → "4 tenant_id bugs in last month — always check scoping"
```

Annotations sync to Obsidian vault for human visibility.

## Architecture

```
┌─────────────────────────────────────────────┐
│              MCP Interface (25 tools)        │
│         @modelcontextprotocol/sdk            │
└──────────────────┬──────────────────────────┘
                   │
┌──────────────────┴──────────────────────────┐
│              Index Engine                    │
│  Coordinates: Store + Parser + Watcher       │
│  Real-time updates on file changes           │
└──────────────────┬──────────────────────────┘
                   │
┌─────────┬────────┴────────┬─────────────────┐
│ Parser  │    Store        │   Watcher       │
│ tree-   │    SQLite       │   chokidar      │
│ sitter  │    (WAL mode)   │   (real-time)   │
│ + regex │    + FTS        │                 │
│ fallback│                 │                 │
└─────────┴─────────────────┴─────────────────┘
```

## Tech Stack

| Component | Choice | Why |
|-----------|--------|-----|
| Runtime | Node.js 20+ | Same stack as your project |
| AST Parser | tree-sitter | Battle-tested (GitHub, Neovim), 40+ languages |
| Storage | better-sqlite3 | Synchronous reads, embedded, WAL mode |
| File Watcher | chokidar v3 | De facto Node.js watcher, macOS FSEvents |
| Git | simple-git | Clean API, all git operations |
| MCP SDK | @modelcontextprotocol/sdk | Official protocol, stdio transport |

## Tests

```bash
npm test          # 97 tests across 14 suites
```

## License

MIT
