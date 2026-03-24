# vault-index

MCP server for structured Obsidian vault indexing and search.

Provides tools for indexing vault items (bugs, tasks, work items), semantic search via embeddings, and multi-agent coordination (claims, dispatch runs, orchestration).

## Setup

```bash
npm install
```

## Usage

```bash
npm start          # starts MCP server (stdio transport)
npm test           # runs tests via node --test
```

## Stack

- Node.js (ESM)
- MCP SDK (`@modelcontextprotocol/sdk`)
- SQLite via `better-sqlite3` + `sqlite-vec` (vector search)
- `@huggingface/transformers` for embeddings

## Structure

```
src/
  server.js                 # MCP server entry point
  coordination/             # Multi-agent claims, orchestration, registry
  indexer/                  # Vault parsing, embedding, pipeline
  storage/                  # SQLite database layer
tests/                      # Node built-in test runner
```

## Origin

Copied from `~/.vault-index/` (runtime instance). Database files (*.db) are excluded -- they are generated at runtime.
