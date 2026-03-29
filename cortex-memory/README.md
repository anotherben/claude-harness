# cortex-memory

MCP server for semantic search over agent session transcripts across platforms.

Provides a shared recall layer for Claude and Codex session history so agents can find prior decisions, debugging context, and implementation notes without treating transcripts as the source of truth.

## Setup

```bash
npm install
```

## Usage

```bash
npm start                # starts MCP server (stdio transport)
npm test -- --run        # runs tests via vitest
node cli.js status       # show index statistics
node cli.js index --all  # backfill all configured transcript sources
node cli.js search "TDZ error"
```

## Default Sources

- Claude Code: `~/.claude/projects`
- Codex CLI: `~/.codex/archived_sessions`

Override or extend them with:

```bash
export CORTEX_MEMORY_SESSION_SOURCES='claude=/path/to/claude;sourcemap=/path/to/other/platform'
```

## Structure

```
src/
  server.js                 # MCP server entry point
  session-sources.js        # Platform/source discovery and normalization
  indexer/                  # Transcript parsing, chunking, embeddings
  search/                   # Semantic ranking and recency scoring
  storage/                  # SQLite database layer
tests/                      # Vitest coverage
hooks/                      # Optional runtime hooks
cli.js                      # Index/search/status CLI
```

## Origin

Copied from `~/.cortex-memory/` (runtime instance). Runtime databases and `node_modules/` are excluded from the repo copy.
