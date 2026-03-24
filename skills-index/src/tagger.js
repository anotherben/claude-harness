const STOP_WORDS = new Set([
  'the',
  'and',
  'for',
  'with',
  'that',
  'this',
  'from',
  'into',
  'when',
  'then',
  'your',
  'have',
  'will',
  'only',
  'must',
  'should',
  'skill',
]);

function toTag(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function addTokens(target, value) {
  for (const raw of String(value || '').split(/[^a-zA-Z0-9]+/)) {
    const token = toTag(raw);
    if (!token || token.length < 3 || STOP_WORDS.has(token)) {
      continue;
    }
    target.add(token);
  }
}

export function deriveTags(document) {
  const skillTags = new Set();
  addTokens(skillTags, document.id);
  addTokens(skillTags, document.name);
  addTokens(skillTags, document.description);
  addTokens(skillTags, document.relativePath);
  addTokens(skillTags, document.precedenceScope);

  if (Array.isArray(document.attributes?.tags)) {
    for (const tag of document.attributes.tags) {
      const normalized = toTag(tag);
      if (normalized) {
        skillTags.add(normalized);
      }
    }
  }

  if (Array.isArray(document.attributes?.aliases)) {
    for (const alias of document.attributes.aliases) {
      addTokens(skillTags, alias);
    }
  }

  if (Array.isArray(document.attributes?.triggers)) {
    for (const trigger of document.attributes.triggers) {
      addTokens(skillTags, trigger);
    }
  }

  const sections = document.sections.map((section) => {
    const sectionTags = new Set();
    sectionTags.add(section.kind);
    addTokens(sectionTags, section.heading);
    return {
      sectionSlug: section.slug,
      tags: [...sectionTags],
    };
  });

  return {
    skill: [...skillTags],
    sections,
  };
}
