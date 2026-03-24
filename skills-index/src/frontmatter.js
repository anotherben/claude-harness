import YAML from 'yaml';

export function parseFrontmatter(text) {
  if (!text.startsWith('---\n')) {
    return { attributes: {}, body: text, warnings: [] };
  }

  const endIndex = text.indexOf('\n---\n', 4);
  if (endIndex === -1) {
    return { attributes: {}, body: text, warnings: ['frontmatter_not_closed'] };
  }

  const raw = text.slice(4, endIndex);
  const body = text.slice(endIndex + 5);
  try {
    const attributes = YAML.parse(raw) || {};
    return { attributes, body, warnings: [] };
  } catch (error) {
    return {
      attributes: {},
      body,
      warnings: [`frontmatter_parse_error:${error.message}`],
    };
  }
}
