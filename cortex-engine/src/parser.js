const TreeSitter = require('tree-sitter');
const JavaScript = require('tree-sitter-javascript');

const EXTENSION_TO_LANGUAGE = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.cjs': 'javascript',
  '.mjs': 'javascript',
  // TypeScript support will use tree-sitter-typescript when needed
};

class Parser {
  constructor() {
    this.parser = new TreeSitter();
    this.languages = {
      javascript: JavaScript,
    };
    // Default to JavaScript
    this.parser.setLanguage(JavaScript);
  }

  detectLanguage(filePath) {
    const ext = '.' + filePath.split('.').pop();
    return EXTENSION_TO_LANGUAGE[ext] || null;
  }

  parse(filePath, content) {
    const lang = this.detectLanguage(filePath);
    if (!lang || !this.languages[lang]) {
      return { symbols: [], imports: [] };
    }

    this.parser.setLanguage(this.languages[lang]);

    let tree;
    try {
      tree = this.parser.parse(content);
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
    }

    // Recurse into children (but not into function/class bodies for top-level walk)
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      // Don't recurse into function/class bodies — we handle methods explicitly
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
      exported: false, // Will be updated by export analysis
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

      // Arrow function or function expression
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

      // Require call: const x = require('...')  or  const { x } = require('...')
      if (valueNode.type === 'call_expression') {
        this._extractRequire(nameNode, valueNode, node, imports);
      }
    }
  }

  _extractRequire(nameNode, callNode, declNode, imports) {
    const funcNode = callNode.childForFieldName('function');
    if (!funcNode || funcNode.text !== 'require') return;

    const args = callNode.childForFieldName('arguments');
    if (!args || args.childCount < 2) return; // ( and ) count as children

    // Find the string argument
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
      // Destructured: const { pool, query } = require('...')
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

    imports.push({
      source,
      identifiers,
      line: declNode.startPosition.row + 1,
    });
  }

  _extractExpressionImport(node, content, imports) {
    // Handle: require('...') as a standalone expression (no assignment)
    // Not common in real code, skip for now
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

    // Extract methods from class body
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
            });
          }
        }
      }
    }
  }

  _getSignature(node, content) {
    // Get the first line of the function for a simple signature
    const lines = content.split('\n');
    const startLine = node.startPosition.row;
    return lines[startLine] ? lines[startLine].trim() : '';
  }

  _getParams(node) {
    const params = node.childForFieldName('parameters');
    if (!params) return '';
    // Strip the parens from params text
    return params.text.replace(/^\(|\)$/g, '');
  }
}

module.exports = Parser;
