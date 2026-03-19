const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

// Map file extensions to source_type categories
const EXTENSION_TO_SOURCE_TYPE = {
  '.ts': 'code', '.tsx': 'code', '.js': 'code', '.jsx': 'code',
  '.cjs': 'code', '.mjs': 'code', '.py': 'code', '.sh': 'code', '.bash': 'code',
  '.json': 'config', '.yaml': 'config', '.yml': 'config', '.toml': 'config',
  '.sql': 'query', '.graphql': 'query', '.gql': 'query',
  '.md': 'docs',
  '.html': 'markup', '.xml': 'markup', '.vue': 'markup', '.svelte': 'markup',
  '.css': 'style', '.scss': 'style', '.less': 'style',
};

function getSourceType(filePath) {
  const ext = '.' + filePath.split('.').pop().toLowerCase();
  return EXTENSION_TO_SOURCE_TYPE[ext] || 'code';
}

class Store {
  constructor(dbPath) {
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
  }

  migrate() {
    const schema = fs.readFileSync(
      path.join(__dirname, 'queries', 'schema.sql'),
      'utf-8'
    );
    this.db.exec(schema);

    // Migration: add source_type column if it doesn't exist (for existing DBs)
    const cols = this.db.pragma('table_info(symbols)');
    const hasSourceType = cols.some(c => c.name === 'source_type');
    if (!hasSourceType) {
      this.db.exec("ALTER TABLE symbols ADD COLUMN source_type TEXT NOT NULL DEFAULT 'code'");
      try {
        this.db.exec("CREATE INDEX IF NOT EXISTS idx_symbols_source_type ON symbols(source_type)");
      } catch { /* index may already exist */ }
    }
  }

  // --- Files ---

  upsertFile({ path: filePath, language, hash, sizeBytes, lineCount }) {
    const stmt = this.db.prepare(`
      INSERT INTO files (path, language, hash, size_bytes, line_count, indexed_at)
      VALUES (@path, @language, @hash, @sizeBytes, @lineCount, datetime('now'))
      ON CONFLICT(path) DO UPDATE SET
        language = @language,
        hash = @hash,
        size_bytes = @sizeBytes,
        line_count = @lineCount,
        indexed_at = datetime('now')
    `);
    const info = stmt.run({ path: filePath, language, hash, sizeBytes, lineCount });
    const id = info.changes > 0
      ? this.db.prepare('SELECT id FROM files WHERE path = ?').get(filePath).id
      : null;
    return { id, path: filePath, language, hash, sizeBytes, lineCount };
  }

  getFile(filePath) {
    const row = this.db.prepare('SELECT * FROM files WHERE path = ?').get(filePath);
    if (!row) return null;
    return {
      id: row.id,
      path: row.path,
      language: row.language,
      hash: row.hash,
      sizeBytes: row.size_bytes,
      lineCount: row.line_count,
      indexedAt: row.indexed_at,
    };
  }

  deleteFile(filePath) {
    this.db.prepare('DELETE FROM files WHERE path = ?').run(filePath);
  }

  // --- Symbols ---

  upsertSymbols(fileId, symbols, sourceType = 'code') {
    const del = this.db.prepare('DELETE FROM symbols WHERE file_id = ?');
    const ins = this.db.prepare(`
      INSERT INTO symbols (file_id, name, kind, signature, start_line, end_line, exported, async, parent_class, source_type)
      VALUES (@fileId, @name, @kind, @signature, @startLine, @endLine, @exported, @async, @parentClass, @sourceType)
    `);

    const tx = this.db.transaction(() => {
      del.run(fileId);
      for (const sym of symbols) {
        ins.run({
          fileId,
          name: sym.name,
          kind: sym.kind,
          signature: sym.signature || '',
          startLine: sym.startLine,
          endLine: sym.endLine,
          exported: sym.exported ? 1 : 0,
          async: sym.async ? 1 : 0,
          parentClass: sym.parentClass || null,
          sourceType: sym.sourceType || sourceType,
        });
      }
    });
    tx();
  }

  getSymbolsByFile(fileId) {
    return this.db.prepare(`
      SELECT id, file_id, name, kind, signature, start_line AS startLine,
             end_line AS endLine, exported, async, parent_class AS parentClass,
             source_type AS sourceType
      FROM symbols WHERE file_id = ?
    `).all(fileId);
  }

  // --- Imports ---

  upsertImports(fileId, imports) {
    const del = this.db.prepare('DELETE FROM imports WHERE file_id = ?');
    const ins = this.db.prepare(`
      INSERT INTO imports (file_id, source, identifiers, line)
      VALUES (@fileId, @source, @identifiers, @line)
    `);

    const tx = this.db.transaction(() => {
      del.run(fileId);
      for (const imp of imports) {
        ins.run({
          fileId,
          source: imp.source,
          identifiers: JSON.stringify(imp.identifiers || []),
          line: imp.line || 0,
        });
      }
    });
    tx();
  }

  getImportsByFile(fileId) {
    return this.db.prepare('SELECT * FROM imports WHERE file_id = ?').all(fileId);
  }

  // --- Search ---


  getOutlineNested(fileId) {
    const all = this.getSymbolsByFile(fileId);
    const classes = new Map();
    const topLevel = [];

    // First pass: identify classes
    for (const sym of all) {
      if (sym.kind === 'class') {
        classes.set(sym.name, { ...sym, children: [] });
      }
    }

    // Second pass: assign methods to classes, rest to top level
    for (const sym of all) {
      if (sym.kind === 'class') {
        topLevel.push(classes.get(sym.name));
      } else if (sym.parentClass && classes.has(sym.parentClass)) {
        classes.get(sym.parentClass).children.push(sym);
      } else {
        topLevel.push(sym);
      }
    }

    return topLevel;
  }

  findSymbols({ query, kind, exportedOnly, limit, sourceTypes } = {}) {
    // Default to code + query source types for search
    const types = sourceTypes || ['code', 'query'];

    let sql = `
      SELECT s.*, s.source_type AS sourceType, f.path AS filePath,
        CASE
          WHEN LOWER(s.name) = LOWER(@exact) THEN 100
          WHEN LOWER(s.name) LIKE LOWER(@prefix) THEN 75
          WHEN LOWER(s.name) LIKE LOWER(@pattern) THEN 50
          ELSE 0
        END AS score
      FROM symbols s
      JOIN files f ON f.id = s.file_id
      WHERE s.name LIKE @pattern
    `;
    const params = {
      pattern: `%${query}%`,
      prefix: `${query}%`,
      exact: query,
    };

    // source_type filter
    if (types.length > 0) {
      const placeholders = types.map((_, i) => `@st_${i}`).join(', ');
      sql += ` AND s.source_type IN (${placeholders})`;
      types.forEach((t, i) => { params[`st_${i}`] = t; });
    }

    if (kind) {
      sql += ' AND s.kind = @kind';
      params.kind = kind;
    }
    if (exportedOnly) {
      sql += ' AND s.exported = 1';
    }
    sql += ' ORDER BY score DESC, s.name';
    if (limit) {
      sql += ' LIMIT @limit';
      params.limit = limit;
    }

    return this.db.prepare(sql).all(params);
  }

  findImporters(filePath) {
    const EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];

    let base = filePath;
    for (const ext of EXTENSIONS) {
      if (base.endsWith(ext)) {
        base = base.slice(0, -ext.length);
        break;
      }
    }

    const isIndex = base.endsWith('/index') || base === 'index';
    const barrelBase = isIndex ? base.slice(0, base.lastIndexOf('/index')) : null;

    const suffixes = new Set();

    // Generate suffixes from path segments, but require at least 2 segments
    // to avoid false positives (e.g., 'auth' matching every auth-related import)
    const segments = base.split('/');
    const minSegments = segments.length >= 3 ? 2 : 1;
    for (let i = segments.length - 1; i >= 0; i--) {
      const suffix = segments.slice(i).join('/');
      const segmentCount = segments.length - i;
      if (segmentCount < minSegments) continue;
      suffixes.add(suffix);
      for (const ext of EXTENSIONS) {
        suffixes.add(suffix + ext);
      }
    }

    if (barrelBase !== null) {
      const barrelSegments = barrelBase.split('/');
      const barrelMinSegments = barrelSegments.length >= 3 ? 2 : 1;
      for (let i = barrelSegments.length - 1; i >= 0; i--) {
        const suffix = barrelSegments.slice(i).join('/');
        const segmentCount = barrelSegments.length - i;
        if (segmentCount < barrelMinSegments) continue;
        suffixes.add(suffix);
        suffixes.add(suffix + '/');
        for (const ext of EXTENSIONS) {
          suffixes.add(suffix + ext);
        }
      }
    }

    const conditions = [];
    const params = { filePath };

    let idx = 0;
    for (const suffix of suffixes) {
      const pExact = `p_exact_${idx}`;
      const pSlash = `p_slash_${idx}`;
      const pDot   = `p_dot_${idx}`;
      conditions.push(`(i.source = @${pExact} OR i.source LIKE @${pSlash} OR i.source = @${pDot})`);
      params[pExact] = suffix;
      params[pSlash] = '%/' + suffix;
      params[pDot]   = './' + suffix;
      idx++;
    }

    const whereClause = conditions.join(' OR ');

    const sql = `
      SELECT DISTINCT f.path, f.id
      FROM imports i
      JOIN files f ON f.id = i.file_id
      WHERE (${whereClause})
        AND f.path != @filePath
    `;

    return this.db.prepare(sql).all(params);
  }


  // --- Tags ---

  upsertTags(fileId, symbolTags) {
    const delByFile = this.db.prepare('DELETE FROM tags WHERE file_id = ?');
    const getSymbol = this.db.prepare('SELECT id FROM symbols WHERE file_id = ? AND name = ?');
    const ins = this.db.prepare(
      'INSERT INTO tags (symbol_id, file_id, symbol_name, tag) VALUES (@symbolId, @fileId, @symbolName, @tag)'
    );

    const tx = this.db.transaction(() => {
      delByFile.run(fileId);
      for (const [symbolName, tags] of symbolTags) {
        const sym = getSymbol.get(fileId, symbolName);
        if (!sym) continue;
        for (const tag of tags) {
          ins.run({ symbolId: sym.id, fileId, symbolName, tag });
        }
      }
    });
    tx();
  }

  findByTag(tag, limit) {
    let sql = `
      SELECT t.tag, t.symbol_name, s.kind, s.signature, s.start_line AS startLine,
             s.end_line AS endLine, f.path AS filePath
      FROM tags t
      JOIN symbols s ON s.id = t.symbol_id
      JOIN files f ON f.id = t.file_id
      WHERE t.tag = @tag
      ORDER BY f.path, s.start_line
    `;
    const params = { tag };
    if (limit) {
      sql += ' LIMIT @limit';
      params.limit = limit;
    }
    return this.db.prepare(sql).all(params);
  }

  getTagsForFile(fileId) {
    return this.db.prepare(
      'SELECT symbol_name, tag FROM tags WHERE file_id = ?'
    ).all(fileId);
  }

  // --- Stats ---

  getStats() {
    const fileCount = this.db.prepare('SELECT COUNT(*) as c FROM files').get().c;
    const symbolCount = this.db.prepare('SELECT COUNT(*) as c FROM symbols').get().c;
    const importCount = this.db.prepare('SELECT COUNT(*) as c FROM imports').get().c;
    const lastIndexed = this.db.prepare('SELECT MAX(indexed_at) as t FROM files').get().t;
    return { fileCount, symbolCount, importCount, indexedAt: lastIndexed };
  }

  close() {
    this.db.close();
  }
}

module.exports = Store;
module.exports.getSourceType = getSourceType;
