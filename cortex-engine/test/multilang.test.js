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
});
