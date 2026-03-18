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
  // New text-based extensions
  '.json': 'text',
  '.yaml': 'text',
  '.yml': 'text',
  '.graphql': 'text',
  '.gql': 'text',
  '.md': 'text',
  '.toml': 'text',
  '.xml': 'text',
  '.html': 'text',
  '.scss': 'css',
  '.less': 'css',
  '.vue': 'text',
  '.svelte': 'text',
};

// Languages with tree-sitter AST support
const TREE_SITTER_LANGUAGES = new Set(['javascript', 'typescript', 'tsx']);

// Languages using regex fallback
const REGEX_LANGUAGES = new Set(['python', 'bash', 'sql', 'css', 'text']);

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

    this._walk(tree.rootNode, content, symbols, imports, null);

    // Build parent-child relationships: populate children arrays
    this._linkChildren(symbols);

    return { symbols, imports };
  }

  _walk(node, content, symbols, imports, parentScope) {
    if (!node) return;

    // Track whether this node defines a new scope for nested children
    let newScope = parentScope;

    switch (node.type) {
      case 'function_declaration':
        this._extractFunction(node, content, symbols, parentScope);
        newScope = this._getNodeName(node) || parentScope;
        break;

      case 'lexical_declaration':
      case 'variable_declaration':
        this._extractVariableDecl(node, content, symbols, imports, parentScope);
        break;

      case 'class_declaration':
        this._extractClass(node, content, symbols, parentScope);
        newScope = this._getNodeName(node) || parentScope;
        break;

      case 'expression_statement':
        this._extractExpressionImport(node, content, imports);
        break;

      // TypeScript-specific: import declarations
      case 'import_statement':
        this._extractTsImport(node, imports);
        break;

      // TypeScript-specific: type aliases, interfaces, enums
      case 'type_alias_declaration':
        this._extractTypeAlias(node, content, symbols, parentScope);
        break;

      case 'interface_declaration':
        this._extractInterface(node, content, symbols, parentScope);
        newScope = this._getNodeName(node) || parentScope;
        break;

      case 'enum_declaration':
        this._extractEnum(node, content, symbols, parentScope);
        newScope = this._getNodeName(node) || parentScope;
        break;

      case 'method_definition':
        // Methods inside classes are already extracted by _extractClass.
        // Set scope for recursion into method bodies.
        newScope = this._getNodeName(node) || parentScope;
        break;

      case 'arrow_function':
      case 'function_expression':
        // Anonymous arrow functions / function expressions encountered during walk.
        // Named ones are handled via variable_declaration. Just allow recursion.
        break;

      case 'variable_declarator': {
        // When a variable_declarator has an arrow_function or function_expression value,
        // use the variable name as scope for recursion into the function body.
        const varName = node.childForFieldName('name');
        const varValue = node.childForFieldName('value');
        if (varName && varValue &&
            (varValue.type === 'arrow_function' || varValue.type === 'function_expression')) {
          newScope = varName.text || parentScope;
        }
        break;
      }
    }

    // Recurse into children -- we now recurse into ALL node types to find nested symbols.
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      // For nodes that define a scope, pass the new scope to children
      if (node.type === 'function_declaration' ||
          node.type === 'class_declaration' ||
          node.type === 'arrow_function' ||
          node.type === 'method_definition' ||
          node.type === 'function_expression' ||
          node.type === 'interface_declaration' ||
          node.type === 'enum_declaration' ||
          node.type === 'variable_declarator') {
        this._walk(child, content, symbols, imports, newScope);
      } else {
        this._walk(child, content, symbols, imports, parentScope);
      }
    }
  }

  _getNodeName(node) {
    const nameNode = node.childForFieldName('name');
    return nameNode ? nameNode.text : null;
  }

  _extractFunction(node, content, symbols, parentScope) {
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
      parentClass: parentScope || null,
      children: [],
    });
  }

  _extractVariableDecl(node, content, symbols, imports, parentScope) {
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
            parentClass: parentScope || null,
            children: [],
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

  _extractClass(node, content, symbols, parentScope) {
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
      parentClass: parentScope || null,
      children: [],
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
              children: [],
            });
          }
        }
      }
    }
  }

  // --- TypeScript-specific extractors ---

  _extractTypeAlias(node, content, symbols, parentScope) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    symbols.push({
      name: nameNode.text,
      kind: 'type',
      signature: this._getSignature(node, content),
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      exported: false,
      async: false,
      parentClass: parentScope || null,
      children: [],
    });
  }

  _extractInterface(node, content, symbols, parentScope) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    symbols.push({
      name: nameNode.text,
      kind: 'interface',
      signature: `interface ${nameNode.text}`,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      exported: false,
      async: false,
      parentClass: parentScope || null,
      children: [],
    });

    // Extract interface methods/properties
    const body = node.childForFieldName('body');
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const member = body.child(i);
        if (member.type === 'method_signature' ||
            member.type === 'property_signature') {
          const memberName = member.childForFieldName('name');
          if (memberName) {
            const kind = member.type === 'method_signature' ? 'method' : 'property';
            symbols.push({
              name: memberName.text,
              kind,
              signature: member.text.replace(/;$/, '').trim(),
              startLine: member.startPosition.row + 1,
              endLine: member.endPosition.row + 1,
              exported: false,
              async: false,
              parentClass: nameNode.text,
              children: [],
            });
          }
        }
      }
    }
  }

  _extractEnum(node, content, symbols, parentScope) {
    const nameNode = node.childForFieldName('name');
    if (!nameNode) return;

    symbols.push({
      name: nameNode.text,
      kind: 'enum',
      signature: `enum ${nameNode.text}`,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      exported: false,
      async: false,
      parentClass: parentScope || null,
      children: [],
    });

    // Extract enum members
    const body = node.childForFieldName('body');
    if (body) {
      for (let i = 0; i < body.childCount; i++) {
        const member = body.child(i);
        if (member.type === 'enum_member' || member.type === 'enum_assignment' || member.type === 'property_identifier') {
          const memberName = member.childForFieldName('name') || member.children?.find(c => c.type === 'property_identifier') || member;
          const name = memberName.text;
          if (name && name !== ',' && name !== '{' && name !== '}') {
            symbols.push({
              name,
              kind: 'enum_member',
              signature: member.text.trim(),
              startLine: member.startPosition.row + 1,
              endLine: member.endPosition.row + 1,
              exported: false,
              async: false,
              parentClass: nameNode.text,
              children: [],
            });
          }
        }
      }
    }
  }

  // --- Parent-child linking ---

  _linkChildren(symbols) {
    const byName = new Map();
    // First pass: index all symbols by name, preferring top-level (no parent)
    for (const sym of symbols) {
      if (!sym.parentClass) {
        byName.set(sym.name, sym);
      }
    }
    // Second pass: index remaining symbols that aren't yet indexed
    for (const sym of symbols) {
      if (!byName.has(sym.name)) {
        byName.set(sym.name, sym);
      }
    }

    for (const sym of symbols) {
      if (sym.parentClass) {
        const parent = byName.get(sym.parentClass);
        if (parent && parent !== sym && parent.children) {
          // Avoid duplicates (class methods are already added by _extractClass)
          const isDuplicate = parent.children.some(
            (c) => c.name === sym.name && c.startLine === sym.startLine
          );
          if (!isDuplicate) {
            parent.children.push(sym);
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
      case 'css': return this._parseCss(content, filePath);
      case 'text': return this._parseText(filePath, content);
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

  _parseCss(content, filePath) {
    // No cap — extract all top-level class and ID selectors
    const symbols = [];
    const lines = content.split('\n');

    lines.forEach((line, i) => {
      // Top-level class and ID selectors only (no nesting, no pseudo-selectors)
      const selectorMatch = line.match(/^([.#][\w-]+)\s*\{/);
      if (selectorMatch) {
        const name = selectorMatch[1];
        // Skip pseudo-selectors and nested selectors
        if (name.includes(':') || name.includes('>') || name.includes('+') || name.includes('~')) return;
        symbols.push({
          name,
          kind: 'class',
          signature: name,
          startLine: i + 1,
          endLine: i + 1,
          exported: false,
          async: false,
        });
      }
    });

    return { symbols, imports: [] };
  }

  // --- Generic text-based parsers ---

  _parseText(filePath, content) {
    const ext = '.' + filePath.split('.').pop().toLowerCase();
    switch (ext) {
      case '.json': return this._parseJson(content);
      case '.yaml':
      case '.yml': return this._parseYaml(content);
      case '.graphql':
      case '.gql': return this._parseGraphql(content);
      case '.md': return this._parseMarkdown(content);
      case '.toml': return this._parseToml(content);
      case '.xml':
      case '.html': return this._parseXml(content);
      case '.vue':
      case '.svelte': return this._parseVueSvelte(content);
      default: return { symbols: [], imports: [] };
    }
  }

  _parseJson(content) {
    // Extract ALL keys at all nesting levels — no cap
    const symbols = [];
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      const keyMatch = line.match(/^\s*"([\w$-]+)"\s*:/);
      if (keyMatch) {
        symbols.push({
          name: keyMatch[1],
          kind: 'variable',
          signature: line.trim(),
          startLine: i + 1,
          endLine: i + 1,
          exported: false,
          async: false,
        });
      }
    });
    return { symbols, imports: [] };
  }

  _parseYaml(content) {
    // Extract ALL keys at all nesting levels — no cap
    const symbols = [];
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      // Any YAML key (at any indentation level)
      const keyMatch = line.match(/^(\s*)([\w$_-]+)\s*:/);
      if (keyMatch && !line.trimStart().startsWith('#')) {
        symbols.push({
          name: keyMatch[2],
          kind: 'variable',
          signature: line.trim(),
          startLine: i + 1,
          endLine: i + 1,
          exported: false,
          async: false,
        });
      }
    });
    return { symbols, imports: [] };
  }

  _parseGraphql(content) {
    // No cap — extract all type/operation definitions
    const symbols = [];
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      // type Name, input Name, enum Name, interface Name, union Name, scalar Name, directive Name
      const defMatch = line.match(/^(?:type|input|enum|interface|union|scalar|directive)\s+(\w+)/);
      if (defMatch) {
        symbols.push({
          name: defMatch[1],
          kind: 'class',
          signature: line.trim(),
          startLine: i + 1,
          endLine: i + 1,
          exported: false,
          async: false,
        });
      }
      // query/mutation/subscription definitions
      const opMatch = line.match(/^(?:query|mutation|subscription)\s+(\w+)/);
      if (opMatch) {
        symbols.push({
          name: opMatch[1],
          kind: 'function',
          signature: line.trim(),
          startLine: i + 1,
          endLine: i + 1,
          exported: false,
          async: false,
        });
      }
    });
    return { symbols, imports: [] };
  }

  _parseMarkdown(content) {
    // Quality filter: only # and ## headings — not a cap, a relevance filter
    const symbols = [];
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      // Only ## headings (level 1 and 2) — skip ###, ####, etc.
      const headingMatch = line.match(/^(#{1,2})\s+(.+)/);
      if (headingMatch) {
        const level = headingMatch[1].length;
        symbols.push({
          name: headingMatch[2].trim(),
          kind: level === 1 ? 'class' : 'function',
          signature: line.trim(),
          startLine: i + 1,
          endLine: i + 1,
          exported: false,
          async: false,
        });
      }
    });
    return { symbols, imports: [] };
  }

  _parseToml(content) {
    // Extract ALL keys: section headers AND key=value pairs — no cap
    const symbols = [];
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      // TOML section headers: [section] or [[array]]
      const sectionMatch = line.match(/^\[+([^\]]+)\]+/);
      if (sectionMatch) {
        symbols.push({
          name: sectionMatch[1].trim(),
          kind: 'class',
          signature: line.trim(),
          startLine: i + 1,
          endLine: i + 1,
          exported: false,
          async: false,
        });
        return;
      }
      // TOML key = value pairs
      const keyMatch = line.match(/^(\s*)([\w$_-]+)\s*=/);
      if (keyMatch && !line.trimStart().startsWith('#')) {
        symbols.push({
          name: keyMatch[2],
          kind: 'variable',
          signature: line.trim(),
          startLine: i + 1,
          endLine: i + 1,
          exported: false,
          async: false,
        });
      }
    });
    return { symbols, imports: [] };
  }

  _parseXml(content) {
    // Quality filter: only <script> and <style> block boundaries
    // Parsing every <div> as a symbol is genuinely useless
    const symbols = [];
    const lines = content.split('\n');
    lines.forEach((line, i) => {
      // Only <script> and <style> block boundaries — no other tags as symbols
      const blockMatch = line.match(/<(script|style)\b[^>]*>/i);
      if (blockMatch) {
        symbols.push({
          name: blockMatch[1].toLowerCase(),
          kind: 'class',
          signature: line.trim(),
          startLine: i + 1,
          endLine: i + 1,
          exported: false,
          async: false,
        });
      }
    });
    return { symbols, imports: [] };
  }

  _parseVueSvelte(content) {
    // No cap — extract all symbols from script sections
    const symbols = [];
    const lines = content.split('\n');
    // Extract script section symbols using simple regex
    let inScript = false;
    lines.forEach((line, i) => {
      if (/<script/.test(line)) { inScript = true; return; }
      if (/<\/script>/.test(line)) { inScript = false; return; }
      if (!inScript) return;

      // function declarations
      const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
      if (funcMatch) {
        symbols.push({
          name: funcMatch[1],
          kind: 'function',
          signature: line.trim(),
          startLine: i + 1,
          endLine: i + 1,
          exported: line.includes('export'),
          async: line.includes('async'),
        });
      }
      // const/let arrow functions
      const arrowMatch = line.match(/(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s+)?\(/);
      if (arrowMatch) {
        symbols.push({
          name: arrowMatch[1],
          kind: 'function',
          signature: line.trim(),
          startLine: i + 1,
          endLine: i + 1,
          exported: line.includes('export'),
          async: line.includes('async'),
        });
      }
    });
    return { symbols, imports: [] };
  }
}

module.exports = Parser;
