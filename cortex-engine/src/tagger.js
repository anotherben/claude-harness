const DB_READ_PATTERN = /pool\.query\s*\(\s*['"`]SELECT/i;
const DB_WRITE_PATTERN = /pool\.query\s*\(\s*['"`](INSERT|UPDATE|DELETE)/i;
const DB_CALL_PATTERN = /pool\.query/;
const TENANT_SCOPED_PATTERN = /tenant_id/;
const TRY_CATCH_PATTERN = /\btry\s*\{/;
const ROUTE_PATTERN = /router\.(get|post|put|delete|patch)\s*\(/;
const MODULE_EXPORTS_PATTERN = /module\.exports\s*=\s*\{([^}]+)\}/;
const EXPORTS_PATTERN = /exports\.(\w+)/g;

class Tagger {
  constructor(config = {}) {
    this.customRules = config.customRules || [];
  }

  /**
   * Tag symbols based on the source code they contain.
   * Returns a Map<symbolName, string[]> of tags per symbol.
   */
  tagSymbols(symbols, fullSource) {
    const lines = fullSource.split('\n');
    const result = new Map();

    for (const sym of symbols) {
      const tags = [];
      const symSource = lines.slice(sym.startLine - 1, sym.endLine).join('\n');

      // Async
      if (sym.async) tags.push('async');

      // DB patterns
      if (DB_READ_PATTERN.test(symSource)) tags.push('db_read');
      if (DB_WRITE_PATTERN.test(symSource)) tags.push('db_write');

      // Tenant scoping
      if (DB_CALL_PATTERN.test(symSource)) {
        if (TENANT_SCOPED_PATTERN.test(symSource)) {
          tags.push('tenant_scoped');
        } else {
          tags.push('unscoped_query');
        }
      }

      // Error handling
      if (TRY_CATCH_PATTERN.test(symSource)) {
        tags.push('error_handler');
      } else if (DB_CALL_PATTERN.test(symSource) || /await\s+fetch/.test(symSource)) {
        tags.push('no_error_handling');
      }

      // Custom rules
      for (const rule of this.customRules) {
        if (rule.pattern.test(symSource)) {
          tags.push(rule.tag);
        }
      }

      result.set(sym.name, tags);
    }

    return result;
  }

  /**
   * Tag source-level patterns (not symbol-scoped).
   * Returns an array of {tag, name?, line?} entries.
   */
  tagSource(source) {
    const tags = [];
    const lines = source.split('\n');

    // Route handlers
    lines.forEach((line, i) => {
      if (ROUTE_PATTERN.test(line)) {
        const match = line.match(ROUTE_PATTERN);
        tags.push({
          tag: 'route_handler',
          name: match ? `${match[1].toUpperCase()} route` : 'route',
          line: i + 1,
        });
      }
    });

    // module.exports
    const exportsMatch = source.match(MODULE_EXPORTS_PATTERN);
    if (exportsMatch) {
      const names = exportsMatch[1].split(',').map((s) => s.trim()).filter(Boolean);
      for (const name of names) {
        tags.push({ tag: 'exported', name, line: null });
      }
    }

    // exports.X
    let m;
    const exportsRegex = new RegExp(EXPORTS_PATTERN.source, 'g');
    while ((m = exportsRegex.exec(source)) !== null) {
      tags.push({ tag: 'exported', name: m[1], line: null });
    }

    return tags;
  }

  /**
   * Get all tags for a file — combines symbol-level and source-level tags.
   */
  tagFile(symbols, source) {
    const symbolTags = this.tagSymbols(symbols, source);
    const sourceTags = this.tagSource(source);
    return { symbolTags, sourceTags };
  }
}

module.exports = Tagger;
