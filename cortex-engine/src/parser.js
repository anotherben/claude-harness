const TreeSitter = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');
const TypeScriptLang = require('tree-sitter-typescript');

const EXTENSION_TO_LANGUAGE = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.cjs': 'javascript',
  '.mjs': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'tsx',
  '.py': 'python',
  '.sh': 'bash',
  '.bash': 'bash',
  '.sql': 'sql',
  '.css': 'css',
};

// Languages with tree-sitter AST support
const TREE_SITTER_LANGUAGES = new Set(['javascript', 'typescript', 'tsx']);

// Languages using regex fallback
const REGEX_LANGUAGES = new Set(['python', 'bash', 'sql', 'css']);

class Parser {
  constructor() {
    this.languages = {
      javascript: JavaScript,
      typescript: TypeScriptLang.typescript,
      tsx: TypeScriptLang.tsx,
    };
    this._lastLang = null;
    this._parser = null;
  }

  _getParser(lang) {
    // Create fresh parser when language changes to avoid native binding corruption
    if (this._lastLang !== lang || !this._parser) {
      this._parser = new TreeSitter();
      this._parser.setLanguage(this.languages[lang]);
      this._lastLang = lang;
    }
    return this._parser;
  }

  detectLanguage(filePath) {
    const ext = '.' + filePath.split('.').pop();
    return EXTENSION_TO_LANGUAGE[ext] || null;
  }

  parse(filePath, content) {
    const lang = this.detectLanguage(filePath);
    if (!lang) return { symbols: [], imports: [] };

    if (TREE_SITTER_LANGUAGES.has(lang)) {
      return this._parseTreeSitter(filePath, content, lang);
    }
    if (REGEX_LANGUAGES.has(lang)) {
      return this._parseRegex(filePath, content, lang);
    }
    return { symbols: [], imports: [] };
  }

  _parseTreeSitter(filePath, content, lang) {
    if (!this.languages[lang]) return { symbols: [], imports: [] };

    const parser = this._getParser(lang);

    let tree;
    try {
      tree = parser.parse(content);
    } catch {
      return { symbols: [], imports: [] };
    }

    const symbols = [];
    const imports = [];

    this._walk(tree.rootNode, content, symbols, imports);

    return { symbols, imports };
  }

  _walk(node, content, symbols, imports) {
    if (!node) return;
    switch (node.type) {
      case 'function_declaration':
        this._extractFunction(node, content, symbols);
        break;

      case 'lexical_declaration':
      case 'variable_declaration':
        this._extractVariableDecl(node, content, symbols, imports);
        break;

      case 'class_declaration':
        this._extractClass(node, content, symbols);
        break;

      case 'expression_statement':
        this._extractExpressionImport(node, content, imports);
        break;

      // TypeScript-specific: import declarations
      case 'import_statement':
        this._extractTsImport(node, imports);
        break;
    }

    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (node.type !== 'function_declaration' &&
          node.type !== 'class_declaration' &&
          node.type !== 'arrow_function' &&
          node.type !== 'method_definition') {
        this._walk(child, content, symbols, imports);
      }
    }
  }

  _extractFunction(node, content, symbols) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    const isAsync = node.children.some((c) => c.type === 'async');

    symbols.push({
      name: nameNode.text,
      kind: 'function',
      signature: this._getSignature(node, content),
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      exported: false,
      async: isAsync,
    });
  }

  _extractVariableDecl(node, content, symbols, imports) {
    for (let i = 0; i < node.childCount; i++) {
      const declarator = node.child(i);
      if (declarator.type !== 'variable_declarator') continue;

      const nameNode = declarator.childForFieldName('name');
      const valueNode = declarator.childForFieldName('value');

      if (!nameNode || !valueNode) continue;

      if (valueNode.type === 'arrow_function' || valueNode.type === 'function_expression') {
        const isAsync = valueNode.children.some((c) => c.type === 'async');
        const name = nameNode.type === 'identifier' ? nameNode.text : null;
        if (name) {
          symbols.push({
            name,
            kind: 'function',
            signature: `${name}(${this._getParams(valueNode)})`,
            startLine: node.startPosition.row + 1,
            endLine: node.endPosition.row + 1,
            exported: false,
            async: isAsync,
          });
        }
      }

      if (valueNode.type === 'call_expression') {
        this._extractRequire(nameNode, valueNode, node, imports);
      }
    }
  }

  _extractRequire(nameNode, callNode, declNode, imports) {
    const funcNode = callNode.childForFieldName('function');
    if (!funcNode || funcNode.text !== 'require') return;

    const args = callNode.childForFieldName('arguments');
    if (!args || args.childCount < 2) return;

    let source = null;
    for (let i = 0; i < args.childCount; i++) {
      const arg = args.child(i);
      if (arg.type === 'string') {
        source = arg.text.replace(/^['"`]|['"`]$/g, '');
        break;
      }
    }
    if (!source) return;

    let identifiers = [];
    if (nameNode.type === 'object_pattern') {
      for (let i = 0; i < nameNode.childCount; i++) {
        const child = nameNode.child(i);
        if (child.type === 'shorthand_property_identifier_pattern' ||
            child.type === 'shorthand_property_identifier') {
          identifiers.push(child.text);
        } else if (child.type === 'pair_pattern') {
          const val = child.childForFieldName('value');
          if (val) identifiers.push(val.text);
        }
      }
    } else if (nameNode.type === 'identifier') {
      identifiers = [nameNode.text];
    }

    imports.push({ source, identifiers, line: declNode.startPosition.row + 1 });
  }

  _extractExpressionImport(node, content, imports) {
    // Standalone require() — skip for now
  }

  _extractTsImport(node, imports) {
    // import { x } from 'y' or import x from 'y'
    const sourceNode = node.childForFieldName('source');
    if (!sourceNode) return;
    const source = sourceNode.text.replace(/^['"`]|['"`]$/g, '');

    const identifiers = [];
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child.type === 'import_clause') {
        // Walk import clause for identifiers
        for (let j = 0; j < child.childCount; j++) {
          const spec = child.child(j);
          if (spec.type === 'identifier') {
            identifiers.push(spec.text);
          } else if (spec.type === 'named_imports') {
            for (let k = 0; k < spec.childCount; k++) {
              const named = spec.child(k);
              if (named.type === 'import_specifier') {
                const nameNode = named.childForFieldName('name');
                if (nameNode) identifiers.push(nameNode.text);
              }
            }
          }
        }
      }
    }

    imports.push({ source, identifiers, line: node.startPosition.row + 1 });
  }

  _extractClass(node, content, symbols) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    symbols.push({
      name: nameNode.text,
      kind: 'class',
      signature: `class ${nameNode.text}`,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      exported: false,
      async: false,
    });

    const body = node.childForFieldName('body');
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const member = body.child(i);
        if (member.type === 'method_definition') {
          const methodName = member.childForFieldName('name');
          if (methodName) {
            const isAsync = member.children.some((c) => c.type === 'async');
            symbols.push({
              name: methodName.text,
              kind: 'method',
              signature: `${methodName.text}(${this._getParams(member)})`,
              startLine: member.startPosition.row + 1,
              endLine: member.endPosition.row + 1,
              exported: false,
              async: isAsync,
              parentClass: nameNode.text,
            });
          }
        }
      }
    }
  }

  _getSignature(node, content) {
    const lines = content.split('\n');
    const startLine = node.startPosition.row;
    return lines[startLine] ? lines[startLine].trim() : '';
  }

  _getParams(node) {
    const params = node.childForFieldName('parameters');
    if (!params) return '';
    return params.text.replace(/^\(|\)$/g, '');
  }

  // --- Regex fallback for non-tree-sitter languages ---

  _parseRegex(filePath, content, lang) {
    switch (lang) {
      case 'python': return this._parsePython(content);
      case 'bash': return this._parseBash(content);
      case 'sql': return this._parseSql(content);
      case 'css': return this._parseCss(content);
      default: return { symbols: [], imports: [] };
    }
  }

  _parsePython(content) {
    const symbols = [];
    const imports = [];
    const lines = content.split('\n');

    lines.forEach((line, i) => {
      // Functions: def name(...)
      const funcMatch = line.match(/^(\s*)def\s+(\w+)\s*\(/);
      if (funcMatch) {
        const indent = funcMatch[1].length;
        symbols.push({
          name: funcMatch[2],
          kind: indent > 0 ? 'method' : 'function',
          signature: line.trim(),
          startLine: i + 1,
          endLine: i + 1, // Can't determine without indentation tracking
          exported: false,
          async: line.includes('async def'),
        });
      }

      // Classes: class Name:
      const classMatch = line.match(/^class\s+(\w+)/);
      if (classMatch) {
        symbols.push({
          name: classMatch[1],
          kind: 'class',
          signature: line.trim(),
          startLine: i + 1,
          endLine: i + 1,
          exported: false,
          async: false,
        });
      }

      // Imports: import x / from x import y
      const importMatch = line.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)/);
      if (importMatch) {
        const source = importMatch[1] || importMatch[2].split(',')[0].trim();
        const identifiers = importMatch[2].split(',').map((s) => s.trim());
        imports.push({ source, identifiers, line: i + 1 });
      }
    });

    return { symbols, imports };
  }

  _parseBash(content) {
    const symbols = [];
    const lines = content.split('\n');
    const imports = [];

    lines.forEach((line, i) => {
      // function name() or name() {
      const funcMatch = line.match(/^(?:function\s+)?(\w+)\s*\(\s*\)\s*\{?/);
      if (funcMatch && !line.startsWith('#') && funcMatch[1] !== 'if' && funcMatch[1] !== 'for' && funcMatch[1] !== 'while') {
        symbols.push({
          name: funcMatch[1],
          kind: 'function',
          signature: line.trim(),
          startLine: i + 1,
          endLine: i + 1,
          exported: false,
          async: false,
        });
      }

      // source ./file.sh
      const sourceMatch = line.match(/^(?:source|\.)\s+(.+)/);
      if (sourceMatch) {
        imports.push({ source: sourceMatch[1].trim(), identifiers: [], line: i + 1 });
      }
    });

    return { symbols, imports };
  }

  _parseSql(content) {
    const symbols = [];
    const lines = content.split('\n');

    const fullContent = content;
    // CREATE TABLE name
    const tablePattern = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(\w+)/gi;
    let m;
    while ((m = tablePattern.exec(fullContent)) !== null) {
      symbols.push({
        name: m[1],
        kind: 'class', // table as a "class" equivalent
        signature: `CREATE TABLE ${m[1]}`,
        startLine: fullContent.substring(0, m.index).split('\n').length,
        endLine: fullContent.substring(0, m.index).split('\n').length,
        exported: false,
        async: false,
      });
    }

    // CREATE VIEW name
    const viewPattern = /CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\s+(\w+)/gi;
    while ((m = viewPattern.exec(fullContent)) !== null) {
      symbols.push({
        name: m[1],
        kind: 'function', // view as a "function" equivalent
        signature: `CREATE VIEW ${m[1]}`,
        startLine: fullContent.substring(0, m.index).split('\n').length,
        endLine: fullContent.substring(0, m.index).split('\n').length,
        exported: false,
        async: false,
      });
    }

    return { symbols, imports: [] };
  }

  _parseCss(content) {
    const symbols = [];
    const lines = content.split('\n');

    lines.forEach((line, i) => {
      // Class and ID selectors at top level
      const selectorMatch = line.match(/^([.#][\w-]+)\s*\{/);
      if (selectorMatch) {
        symbols.push({
          name: selectorMatch[1],
          kind: 'class',
          signature: selectorMatch[1],
          startLine: i + 1,
          endLine: i + 1,
          exported: false,
          async: false,
        });
      }
    });

    return { symbols, imports: [] };
  }
}

module.exports = Parser;
