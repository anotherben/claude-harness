const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

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

  upsertSymbols(fileId, symbols) {
    const del = this.db.prepare('DELETE FROM symbols WHERE file_id = ?');
    const ins = this.db.prepare(`
      INSERT INTO symbols (file_id, name, kind, signature, start_line, end_line, exported, async)
      VALUES (@fileId, @name, @kind, @signature, @startLine, @endLine, @exported, @async)
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
        });
      }
    });
    tx();
  }

  getSymbolsByFile(fileId) {
    return this.db.prepare(`
      SELECT id, file_id, name, kind, signature, start_line AS startLine,
             end_line AS endLine, exported, async
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

  findSymbols({ query, kind, exportedOnly, limit } = {}) {
    let sql = `
      SELECT s.*, f.path AS filePath
      FROM symbols s
      JOIN files f ON f.id = s.file_id
      WHERE s.name LIKE @pattern
    `;
    const params = { pattern: `%${query}%` };

    if (kind) {
      sql += ' AND s.kind = @kind';
      params.kind = kind;
    }
    if (exportedOnly) {
      sql += ' AND s.exported = 1';
    }
    sql += ' ORDER BY s.name';
    if (limit) {
      sql += ' LIMIT @limit';
      params.limit = limit;
    }

    return this.db.prepare(sql).all(params);
  }

  findImporters(filePath) {
    // Match imports where source ends with the filename (without extension)
    // e.g., source='./b' matches filePath='b.js'
    const baseName = filePath.replace(/\.[^.]+$/, '');
    return this.db.prepare(`
      SELECT DISTINCT f.path, f.id
      FROM imports i
      JOIN files f ON f.id = i.file_id
      WHERE i.source LIKE @pattern
    `).all({ pattern: `%${baseName}` });
  }


  // --- Tags ---

  upsertTags(fileId, symbolTags) {
    // symbolTags is a Map<symbolName, string[]>
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
