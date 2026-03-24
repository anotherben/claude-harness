function slugify(value) {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'section';
}

export function normalizeSectionKey(value) {
  return slugify(value);
}

export function estimateTokens(value) {
  if (!value) {
    return 0;
  }
  return Math.ceil(Buffer.byteLength(String(value), 'utf8') / 4);
}

export function inferSectionKind(heading) {
  const text = String(heading || '').trim();
  if (/^(phase|stage)\s+\d/i.test(text)) {
    return 'phase';
  }
  if (/^step\s+\d/i.test(text)) {
    return 'step';
  }
  if (/^(rule|constraint|guard)\b/i.test(text)) {
    return 'rule';
  }
  if (/^(template|format|schema)\b/i.test(text)) {
    return 'template';
  }
  if (/^(example|usage)\b/i.test(text)) {
    return 'example';
  }
  return 'section';
}

export function parseSections(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const sections = [];
  const slugCounts = new Map();
  const headingStack = [];

  function nextSlug(base) {
    const count = (slugCounts.get(base) || 0) + 1;
    slugCounts.set(base, count);
    return count === 1 ? base : `${base}-${count}`;
  }

  function makeSection({ heading, depth, startLine, parentHeading = null, parentSlug = null }) {
    const slug = nextSlug(slugify(heading));
    return {
      heading,
      slug,
      depth,
      kind: depth === 0 ? 'section' : inferSectionKind(heading),
      parentHeading,
      parentSlug,
      startLine,
      endLine: startLine,
      lines: [],
    };
  }

  let current = makeSection({
    heading: 'Overview',
    depth: 0,
    startLine: 1,
  });

  function closeSection(endLine) {
    const content = current.lines.join('\n').trim();
    sections.push({
      heading: current.heading,
      slug: current.slug,
      depth: current.depth,
      level: current.depth,
      kind: current.kind,
      parentHeading: current.parentHeading,
      parentSlug: current.parentSlug,
      startLine: current.startLine,
      endLine: Math.max(current.startLine, endLine),
      content,
      tokenEstimate: estimateTokens(content),
    });
  }

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNumber = index + 1;
    const match = /^(#{1,6})\s+(.+?)\s*$/.exec(line);
    if (match) {
      closeSection(lineNumber - 1);
      const depth = match[1].length;
      while (headingStack.length && headingStack[headingStack.length - 1].depth >= depth) {
        headingStack.pop();
      }
      const parent = headingStack[headingStack.length - 1] || null;
      current = makeSection({
        heading: match[2],
        depth,
        startLine: lineNumber,
        parentHeading: parent?.heading || null,
        parentSlug: parent?.slug || null,
      });
      headingStack.push({
        depth,
        heading: current.heading,
        slug: current.slug,
      });
      continue;
    }
    current.lines.push(line);
  }

  closeSection(lines.length || 1);

  return sections.filter((section) => section.content || section.slug === 'overview');
}
