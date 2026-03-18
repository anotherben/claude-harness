const Parser = require('../src/parser');
const fs = require('fs');
const path = require('path');

describe('Multi-language Parser', () => {
  let parser;

  beforeAll(() => {
    parser = new Parser();
  });

  // PC-7: TypeScript support
  describe('TypeScript', () => {
    it('parses .ts files', () => {
      const code = `
interface User {
  id: number;
  name: string;
}

function getUser(id: number): User {
  return { id, name: 'test' };
}

export const userService = {
  get: getUser,
};
`.trim();
      const result = parser.parse('user.ts', code);
      const names = result.symbols.map((s) => s.name);
      expect(names).toContain('getUser');
    });

    it('parses .tsx files', () => {
      const code = `
function MyComponent({ name }: { name: string }) {
  return <div>{name}</div>;
}
`.trim();
      const result = parser.parse('Component.tsx', code);
      expect(result.symbols.some((s) => s.name === 'MyComponent')).toBe(true);
    });
  });

  // PC-8: Language detection
  describe('language detection', () => {
    it('detects all supported extensions', () => {
      expect(parser.detectLanguage('a.js')).toBe('javascript');
      expect(parser.detectLanguage('a.jsx')).toBe('javascript');
      expect(parser.detectLanguage('a.cjs')).toBe('javascript');
      expect(parser.detectLanguage('a.mjs')).toBe('javascript');
      expect(parser.detectLanguage('a.ts')).toBe('typescript');
      expect(parser.detectLanguage('a.tsx')).toBe('tsx');
      expect(parser.detectLanguage('a.py')).toBe('python');
      expect(parser.detectLanguage('a.sh')).toBe('bash');
      expect(parser.detectLanguage('a.sql')).toBe('sql');
      expect(parser.detectLanguage('a.css')).toBe('css');
    });
  });

  // PC-9: Regex fallback for non-tree-sitter languages
  describe('regex fallback', () => {
    it('extracts Python functions and classes', () => {
      const code = `
import os
from pathlib import Path

class UserService:
    def __init__(self, db):
        self.db = db

    def get_user(self, user_id):
        return self.db.query(user_id)

def create_app():
    return Flask(__name__)
`.trim();
      const result = parser.parse('app.py', code);
      const names = result.symbols.map((s) => s.name);
      expect(names).toContain('UserService');
      expect(names).toContain('create_app');
      expect(result.imports.length).toBeGreaterThanOrEqual(1);
    });

    it('extracts Bash functions', () => {
      const code = `
#!/bin/bash
source ./utils.sh

deploy() {
  echo "deploying..."
}

function rollback() {
  echo "rolling back..."
}
`.trim();
      const result = parser.parse('deploy.sh', code);
      const names = result.symbols.map((s) => s.name);
      expect(names).toContain('deploy');
      expect(names).toContain('rollback');
    });

    it('extracts SQL table/view definitions', () => {
      const code = `
CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL
);

CREATE VIEW active_users AS
  SELECT * FROM users WHERE active = true;
`.trim();
      const result = parser.parse('schema.sql', code);
      const names = result.symbols.map((s) => s.name);
      expect(names).toContain('users');
      expect(names).toContain('active_users');
    });

    it('extracts CSS selectors', () => {
      const code = `
.header {
  background: #fff;
}

#main-content {
  padding: 20px;
}

@media (max-width: 768px) {
  .header { display: none; }
}
`.trim();
      const result = parser.parse('styles.css', code);
      expect(result.symbols.length).toBeGreaterThanOrEqual(2);
    });
  });

  // Symbol cap enforcement for non-code files
  describe('non-code symbol extraction', () => {
    it('HTML file produces < 10 symbols (only script/style blocks)', () => {
      const html = Array.from({ length: 200 }, (_, i) =>
        `<div class="item-${i}"><span>content</span></div>`
      ).join('\n');
      const fullHtml = `<html><head><style>.main { color: red; }</style></head><body>\n${html}\n<script>function init() {}</script></body></html>`;
      const result = parser.parse('page.html', fullHtml);
      expect(result.symbols.length).toBeLessThan(10);
      // Should only have script and style block boundaries
      const names = result.symbols.map(s => s.name);
      expect(names).toContain('style');
      expect(names).toContain('script');
    });

    it('JSON file extracts ALL keys at all nesting levels', () => {
      const json = JSON.stringify({
        name: "test-project",
        version: "1.0.0",
        dependencies: {
          express: "^4.18.0",
          lodash: "^4.17.21",
        },
        devDependencies: {
          jest: "^29.0.0",
        },
        scripts: {
          test: "jest",
          build: "tsc",
        }
      }, null, 2);
      const result = parser.parse('package.json', json);
      const names = result.symbols.map(s => s.name);
      // Top-level keys
      expect(names).toContain('name');
      expect(names).toContain('version');
      expect(names).toContain('dependencies');
      // Nested keys are now extracted (caps reverted)
      expect(names).toContain('express');
      expect(names).toContain('lodash');
      expect(names).toContain('jest');
      expect(names).toContain('test');
      expect(names).toContain('build');
    });

    it('Markdown file only produces # and ## headings', () => {
      const md = [
        '# Main Title',
        '## Section One',
        '### Subsection A',
        '#### Deep heading',
        '## Section Two',
        '### Subsection B',
        '##### Very deep',
        '###### Deepest',
        '## Section Three',
      ].join('\n');
      const result = parser.parse('doc.md', md);
      const names = result.symbols.map(s => s.name);
      expect(names).toContain('Main Title');
      expect(names).toContain('Section One');
      expect(names).toContain('Section Two');
      expect(names).toContain('Section Three');
      // Should NOT include ### or deeper
      expect(names).not.toContain('Subsection A');
      expect(names).not.toContain('Deep heading');
      expect(names).not.toContain('Subsection B');
      expect(names).not.toContain('Very deep');
      expect(names).not.toContain('Deepest');
    });

    it('CSS extracts all selectors without cap', () => {
      const lines = Array.from({ length: 100 }, (_, i) =>
        `.class-${i} {\n  color: red;\n}`
      ).join('\n');
      const result = parser.parse('big.css', lines);
      expect(result.symbols.length).toBe(100);
    });

    it('TOML extracts section headers AND key=value pairs', () => {
      const toml = [
        '[package]',
        'name = "myapp"',
        'version = "0.1.0"',
        '',
        '[dependencies]',
        'serde = "1.0"',
        'tokio = "1.0"',
        '',
        '[dev-dependencies]',
        'criterion = "0.4"',
      ].join('\n');
      const result = parser.parse('Cargo.toml', toml);
      const names = result.symbols.map(s => s.name);
      // Section headers
      expect(names).toContain('package');
      expect(names).toContain('dependencies');
      expect(names).toContain('dev-dependencies');
      // Key=value entries (caps reverted)
      expect(names).toContain('name');
      expect(names).toContain('version');
      expect(names).toContain('serde');
      expect(names).toContain('tokio');
      expect(names).toContain('criterion');
    });
  });
});
