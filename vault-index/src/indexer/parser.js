import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';

/**
 * Parse a markdown file with YAML frontmatter.
 * Returns { frontmatter: {}, body: string, hash: string }
 */
export async function parseVaultFile(filePath) {
  const content = await readFile(filePath, 'utf-8');
  const hash = createHash('md5').update(content).digest('hex');

  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) {
    return { frontmatter: {}, body: content.trim(), hash };
  }

  const frontmatter = parseYamlSimple(fmMatch[1]);
  const body = fmMatch[2].trim();

  return { frontmatter, body, hash };
}

/**
 * Simple YAML parser for flat key-value frontmatter.
 * Handles strings, arrays (inline [...] and multi-line - items).
 */
function parseYamlSimple(yaml) {
  const result = {};
  const lines = yaml.split('\n');

  let currentKey = null;
  let collectingArray = false;

  for (const line of lines) {
    // Multi-line array item
    if (collectingArray && /^\s+-\s+/.test(line)) {
      const val = line.replace(/^\s+-\s+/, '').replace(/^["']|["']$/g, '').trim();
      if (val) result[currentKey].push(val);
      continue;
    } else if (collectingArray) {
      collectingArray = false;
    }

    const kvMatch = line.match(/^(\w[\w-]*)\s*:\s*(.*)$/);
    if (!kvMatch) continue;

    const [, key, rawValue] = kvMatch;
    const value = rawValue.trim();

    // Inline array: [item1, item2]
    if (value.startsWith('[')) {
      const inner = value.slice(1, -1).trim();
      result[key] = inner
        ? inner.split(',').map(s => s.trim().replace(/^["']|["']$/g, ''))
        : [];
      currentKey = key;
      continue;
    }

    // Empty value followed by array items
    if (value === '' || value === '[]') {
      result[key] = [];
      currentKey = key;
      collectingArray = true;
      continue;
    }

    // Strip quotes
    result[key] = value.replace(/^["']|["']$/g, '');
    currentKey = key;
    collectingArray = false;
  }

  return result;
}

/**
 * Extract the first N characters of body as an excerpt.
 */
export function bodyExcerpt(body, maxLen = 200) {
  if (!body) return '';
  const clean = body.replace(/\n+/g, ' ').trim();
  return clean.length > maxLen ? clean.slice(0, maxLen) + '...' : clean;
}
