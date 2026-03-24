import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { resolvePaths } from './config.js';
import { parseFrontmatter } from './frontmatter.js';
import { parseSections } from './markdown.js';
import { deriveTags } from './tagger.js';
import { createEmbedder } from './embedder.js';

const POLICY_KEY_OVERRIDES = {
  'cortex-first': 'retrieval',
  'token-discipline': 'token_discipline',
  'skill-platform': 'skill_platform',
};

function walkFiles(rootPath, matcher) {
  if (!existsSync(rootPath)) {
    return [];
  }

  const results = [];
  const entries = readdirSync(rootPath, { withFileTypes: true });
  for (const entry of entries) {
    const nextPath = join(rootPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(nextPath, matcher));
      continue;
    }
    if (matcher(nextPath, entry.name)) {
      results.push(nextPath);
    }
  }
  return results;
}

function hashContent(text) {
  return createHash('sha256').update(text).digest('hex');
}

function resolveSkillId(filePath, attributes = {}) {
  if (attributes.id) {
    return String(attributes.id);
  }
  if (attributes.name) {
    return String(attributes.name);
  }
  const normalized = filePath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts.length > 1 ? parts[parts.length - 2] : parts[parts.length - 1];
}

function readMarkdownFile(filePath) {
  const text = readFileSync(filePath, 'utf8');
  const { attributes, body, warnings } = parseFrontmatter(text);
  const stats = statSync(filePath);
  return {
    filePath,
    text,
    attributes,
    body,
    warnings,
    lineCount: text.split(/\r?\n/).length,
    mtimeMs: stats.mtimeMs,
  };
}

function determineScope(filePath, paths) {
  if (filePath.startsWith(join(paths.repoRoot, '.codex', 'repo-skills'))) {
    return 'repo';
  }
  if (filePath.includes('/.claude/')) {
    return 'claude';
  }
  if (filePath.includes('/.codex/')) {
    return 'user';
  }
  return 'global';
}

function buildSkillDocument(filePath, parsed, rootPath, paths) {
  const id = resolveSkillId(filePath, parsed.attributes);
  const sections = parseSections(parsed.body);
  const description =
    parsed.attributes.description ||
    sections.find((section) => section.slug !== 'overview' && section.content)?.content?.split('\n')[0] ||
    '';

  const document = {
    id,
    name: String(parsed.attributes.name || id),
    description: String(description || ''),
    shortDescription: String(parsed.attributes.short_description || description || '').slice(0, 160),
    contentType: 'skill',
    sourcePath: filePath,
    sourceRoot: rootPath,
    relativePath: relative(rootPath, filePath),
    precedenceScope: determineScope(filePath, paths),
    hash: hashContent(parsed.text),
    lineCount: parsed.lineCount,
    tokenEstimate: sections.reduce((sum, section) => sum + section.tokenEstimate, 0),
    attributes: parsed.attributes,
    warnings: parsed.warnings,
    sections,
  };

  document.tags = deriveTags(document);
  return document;
}

function buildPolicyDocument(filePath, parsed, paths) {
  const id = String(parsed.attributes.id || relative(paths.standardsRoot, filePath).replace(/\.md$/i, ''));
  const sections = parseSections(parsed.body);
  const description =
    parsed.attributes.description ||
    sections.find((section) => section.slug !== 'overview' && section.content)?.content?.split('\n')[0] ||
    '';
  const document = {
    id,
    name: String(parsed.attributes.name || id),
    description: String(description || ''),
    shortDescription: String(description || '').slice(0, 160),
    contentType: 'policy',
    sourcePath: filePath,
    sourceRoot: paths.standardsRoot,
    relativePath: relative(paths.standardsRoot, filePath),
    precedenceScope: 'global',
    hash: hashContent(parsed.text),
    lineCount: parsed.lineCount,
    tokenEstimate: sections.reduce((sum, section) => sum + section.tokenEstimate, 0),
    attributes: parsed.attributes,
    warnings: parsed.warnings,
    sections,
  };

  document.tags = deriveTags(document);
  return document;
}

export function latestSourceMtime(paths) {
  const roots = [paths.standardsRoot, ...paths.skillRoots];
  let latest = 0;
  for (const root of roots) {
    for (const filePath of walkFiles(root, (currentPath) => /\.md$/i.test(currentPath))) {
      latest = Math.max(latest, statSync(filePath).mtimeMs);
    }
  }
  return latest;
}

function loadSkills(paths) {
  const documents = [];
  const seen = new Set();
  for (const rootPath of paths.skillRoots) {
    for (const filePath of walkFiles(rootPath, (_, fileName) => fileName === 'SKILL.md')) {
      const parsed = readMarkdownFile(filePath);
      const document = buildSkillDocument(filePath, parsed, rootPath, paths);
      if (seen.has(document.id)) {
        continue;
      }
      seen.add(document.id);
      documents.push(document);
    }
  }
  return documents;
}

function loadPolicies(paths) {
  return walkFiles(paths.standardsRoot, (currentPath) => /\.md$/i.test(currentPath)).map((filePath) => {
    const parsed = readMarkdownFile(filePath);
    return buildPolicyDocument(filePath, parsed, paths);
  });
}

function policyArtifactKey(document) {
  return (
    document.attributes.artifact_key ||
    POLICY_KEY_OVERRIDES[document.id] ||
    String(document.id).replace(/-/g, '_')
  );
}

function buildCompiledArtifacts(paths, documents) {
  const generatedAt = new Date().toISOString();
  const skills = documents.filter((document) => document.contentType === 'skill');
  const policies = documents.filter((document) => document.contentType === 'policy');

  const policiesArtifact = { generated_at: generatedAt };
  let skillHints = { generated_at: generatedAt, rules: [] };
  let adapters = {};

  for (const policy of policies) {
    if (policy.attributes.type === 'agent_policy') {
      const { artifact_key: _artifactKey, ...attributes } = policy.attributes;
      policiesArtifact[policyArtifactKey(policy)] = attributes;
      continue;
    }
    if (policy.attributes.type === 'skill_hints') {
      skillHints = {
        generated_at: generatedAt,
        rules: policy.attributes.rules || [],
      };
      continue;
    }
    if (policy.attributes.type === 'adapter_policy') {
      adapters = Object.fromEntries(
        Object.entries(policy.attributes.adapters || {}).map(([name, adapter]) => [
          name,
          {
            generated_at: generatedAt,
            name,
            ...adapter,
            retrieval: policiesArtifact.retrieval || null,
            skill_platform: policiesArtifact.skill_platform || null,
          },
        ]),
      );
    }
  }

  const skillsRegistry = {
    generated_at: generatedAt,
    skill_roots: paths.skillRoots,
    skills: skills.map((skill) => ({
      id: skill.id,
      name: skill.name,
      description: skill.description,
      source_path: skill.sourcePath,
      source_root: skill.sourceRoot,
      relative_path: skill.relativePath,
      precedence_scope: skill.precedenceScope,
      token_estimate: skill.tokenEstimate,
      sections: skill.sections.map((section) => ({
        heading: section.heading,
        slug: section.slug,
        level: section.depth,
        kind: section.kind,
        chars: section.content.length,
        preview: section.content.slice(0, 240),
      })),
    })),
  };

  return {
    generatedAt,
    skillsRegistry,
    policiesArtifact,
    skillHints,
    adapters,
  };
}

function writeJson(filePath, data) {
  mkdirSync(dirname(filePath), { recursive: true });
  writeFileSync(filePath, JSON.stringify(data, null, 2));
}

async function attachEmbeddings(documents) {
  const embedder = createEmbedder();
  for (const document of documents.filter((entry) => entry.contentType === 'skill')) {
    const meaningfulSections = document.sections.filter((section) => section.content);
    if (!meaningfulSections.length) {
      continue;
    }
    const vectors = await embedder.embedBatch(
      meaningfulSections.map((section) => `${document.name}\n${section.heading}\n${section.content}`),
    );
    document.embeddings = Object.fromEntries(
      meaningfulSections.map((section, index) => [section.slug, vectors[index]]),
    );
  }
}

export async function indexPlatform(store, options = {}) {
  const paths = resolvePaths(options);
  const documents = [...loadSkills(paths), ...loadPolicies(paths)];
  const sourceMtime = latestSourceMtime(paths);

  if (options.enableEmbeddings || paths.enableEmbeddings) {
    try {
      await attachEmbeddings(documents);
    } catch {
      // Embeddings are optional; degrade to FTS-only.
    }
  }

  store.replaceDocuments(documents);
  store.setMeta('last_indexed_at', new Date().toISOString());
  store.setMeta('last_indexed_source_mtime', sourceMtime);

  const compiled = buildCompiledArtifacts(paths, documents);
  writeJson(join(paths.compiledRoot, 'skills-registry.json'), compiled.skillsRegistry);
  writeJson(join(paths.compiledRoot, 'policies.json'), compiled.policiesArtifact);
  writeJson(join(paths.compiledRoot, 'skill-hints.json'), compiled.skillHints);
  for (const [name, adapter] of Object.entries(compiled.adapters)) {
    writeJson(join(paths.compiledRoot, 'adapters', `${name}.json`), adapter);
  }

  return {
    paths,
    documents,
    skills: documents.filter((document) => document.contentType === 'skill'),
    policies: documents.filter((document) => document.contentType === 'policy'),
    compiled,
    latestSourceMtime: sourceMtime,
  };
}
