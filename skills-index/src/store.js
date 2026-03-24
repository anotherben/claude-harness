import Database from 'better-sqlite3';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { normalizeSectionKey } from './markdown.js';

const SCHEMA = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  short_description TEXT,
  content_type TEXT NOT NULL,
  source_path TEXT NOT NULL,
  source_root TEXT,
  relative_path TEXT,
  precedence_scope TEXT,
  hash TEXT NOT NULL,
  line_count INTEGER NOT NULL DEFAULT 0,
  token_estimate INTEGER NOT NULL DEFAULT 0,
  attributes_json TEXT NOT NULL DEFAULT '{}',
  warnings_json TEXT NOT NULL DEFAULT '[]',
  indexed_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_skills_content_type ON skills(content_type);

CREATE TABLE IF NOT EXISTS sections (
  id TEXT PRIMARY KEY,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  heading TEXT NOT NULL,
  slug TEXT NOT NULL,
  kind TEXT NOT NULL,
  depth INTEGER NOT NULL,
  parent_slug TEXT,
  parent_heading TEXT,
  start_line INTEGER NOT NULL,
  end_line INTEGER NOT NULL,
  content TEXT NOT NULL,
  token_estimate INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sections_skill_slug ON sections(skill_id, slug);

CREATE TABLE IF NOT EXISTS tags (
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  section_id TEXT REFERENCES sections(id) ON DELETE CASCADE,
  tag TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_tags_tag ON tags(tag);
CREATE INDEX IF NOT EXISTS idx_tags_skill ON tags(skill_id);

CREATE VIRTUAL TABLE IF NOT EXISTS skill_fts USING fts5(
  skill_id UNINDEXED,
  section_id UNINDEXED,
  content_type UNINDEXED,
  name,
  heading,
  body,
  tags
);

CREATE TABLE IF NOT EXISTS skill_embeddings (
  section_id TEXT PRIMARY KEY REFERENCES sections(id) ON DELETE CASCADE,
  skill_id TEXT NOT NULL REFERENCES skills(id) ON DELETE CASCADE,
  dimensions INTEGER NOT NULL,
  vector_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tool_name TEXT NOT NULL,
  query_text TEXT,
  file_tokens INTEGER NOT NULL DEFAULT 0,
  response_tokens INTEGER NOT NULL DEFAULT 0,
  tokens_saved INTEGER NOT NULL DEFAULT 0,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

function parseJson(value, fallback) {
  if (!value) {
    return fallback;
  }
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function toSkillRecord(row) {
  if (!row) {
    return null;
  }
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    shortDescription: row.short_description,
    contentType: row.content_type,
    sourcePath: row.source_path,
    sourceRoot: row.source_root,
    relativePath: row.relative_path,
    precedenceScope: row.precedence_scope,
    hash: row.hash,
    lineCount: row.line_count,
    tokenEstimate: row.token_estimate,
    attributes: parseJson(row.attributes_json, {}),
    warnings: parseJson(row.warnings_json, []),
    indexedAt: row.indexed_at,
  };
}

function toOutlineRecord(row) {
  return {
    heading: row.heading,
    slug: row.slug,
    kind: row.kind,
    depth: row.depth,
    level: row.depth,
    parentSlug: row.parent_slug,
    parentHeading: row.parent_heading,
    startLine: row.start_line,
    endLine: row.end_line,
    tokenEstimate: row.token_estimate,
  };
}

function cosineSimilarity(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || !left.length || left.length !== right.length) {
    return 0;
  }
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }
  if (!leftNorm || !rightNorm) {
    return 0;
  }
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function createStore({ dbPath }) {
  if (dbPath !== ':memory:' && !existsSync(dirname(dbPath))) {
    mkdirSync(dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);

  const statements = {
    upsertSkill: db.prepare(`
      INSERT INTO skills (
        id, name, description, short_description, content_type, source_path, source_root, relative_path,
        precedence_scope, hash, line_count, token_estimate, attributes_json, warnings_json, indexed_at
      ) VALUES (
        @id, @name, @description, @short_description, @content_type, @source_path, @source_root, @relative_path,
        @precedence_scope, @hash, @line_count, @token_estimate, @attributes_json, @warnings_json, @indexed_at
      )
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        short_description = excluded.short_description,
        content_type = excluded.content_type,
        source_path = excluded.source_path,
        source_root = excluded.source_root,
        relative_path = excluded.relative_path,
        precedence_scope = excluded.precedence_scope,
        hash = excluded.hash,
        line_count = excluded.line_count,
        token_estimate = excluded.token_estimate,
        attributes_json = excluded.attributes_json,
        warnings_json = excluded.warnings_json,
        indexed_at = excluded.indexed_at
    `),
    deleteSections: db.prepare(`DELETE FROM sections WHERE skill_id = ?`),
    deleteFts: db.prepare(`DELETE FROM skill_fts WHERE skill_id = ?`),
    deleteTags: db.prepare(`DELETE FROM tags WHERE skill_id = ?`),
    deleteEmbeddings: db.prepare(`DELETE FROM skill_embeddings WHERE skill_id = ?`),
    insertSection: db.prepare(`
      INSERT INTO sections (
        id, skill_id, heading, slug, kind, depth, parent_slug, parent_heading, start_line, end_line, content, token_estimate
      ) VALUES (
        @id, @skill_id, @heading, @slug, @kind, @depth, @parent_slug, @parent_heading, @start_line, @end_line, @content, @token_estimate
      )
    `),
    insertTag: db.prepare(`INSERT INTO tags (skill_id, section_id, tag) VALUES (?, ?, ?)`),
    insertFts: db.prepare(`
      INSERT INTO skill_fts (skill_id, section_id, content_type, name, heading, body, tags)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `),
    insertEmbedding: db.prepare(`
      INSERT INTO skill_embeddings (section_id, skill_id, dimensions, vector_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `),
    setMeta: db.prepare(`
      INSERT INTO meta (key, value) VALUES (?, ?)
      ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `),
    getMeta: db.prepare(`SELECT value FROM meta WHERE key = ?`),
    getSkillById: db.prepare(`SELECT * FROM skills WHERE id = ? LIMIT 1`),
    getSkillByName: db.prepare(`SELECT * FROM skills WHERE name = ? LIMIT 1`),
    listSkills: db.prepare(`
      SELECT * FROM skills
      WHERE content_type = @content_type
      ORDER BY name ASC
      LIMIT @limit
    `),
    getSectionsBySkill: db.prepare(`
      SELECT * FROM sections
      WHERE skill_id = ?
      ORDER BY start_line ASC, id ASC
    `),
    getSectionBySlug: db.prepare(`
      SELECT * FROM sections
      WHERE skill_id = ? AND slug = ?
      LIMIT 1
    `),
    getSectionByHeading: db.prepare(`
      SELECT * FROM sections
      WHERE skill_id = ? AND lower(heading) = lower(?)
      LIMIT 1
    `),
    searchFts: db.prepare(`
      SELECT
        s.*,
        sections.heading AS matched_heading,
        sections.slug AS matched_slug,
        sections.kind AS matched_kind,
        substr(sections.content, 1, 240) AS preview,
        bm25(skill_fts) AS rank
      FROM skill_fts
      JOIN skills s ON s.id = skill_fts.skill_id
      LEFT JOIN sections ON sections.id = skill_fts.section_id
      WHERE skill_fts MATCH ?
        AND s.content_type = ?
      ORDER BY rank ASC
      LIMIT ?
    `),
    searchLike: db.prepare(`
      SELECT
        s.*,
        NULL AS matched_heading,
        NULL AS matched_slug,
        NULL AS matched_kind,
        substr(coalesce(s.description, ''), 1, 240) AS preview
      FROM skills s
      WHERE s.content_type = ?
        AND (
          lower(s.name) LIKE lower(?)
          OR lower(coalesce(s.description, '')) LIKE lower(?)
          OR EXISTS (
            SELECT 1
            FROM tags t
            WHERE t.skill_id = s.id
              AND lower(t.tag) LIKE lower(?)
          )
        )
      ORDER BY s.name ASC
      LIMIT ?
    `),
    embeddingCandidates: db.prepare(`
      SELECT
        s.*,
        sections.heading AS matched_heading,
        sections.slug AS matched_slug,
        sections.kind AS matched_kind,
        substr(sections.content, 1, 240) AS preview,
        embeddings.vector_json
      FROM skill_embeddings embeddings
      JOIN sections ON sections.id = embeddings.section_id
      JOIN skills s ON s.id = embeddings.skill_id
      WHERE s.content_type = ?
    `),
    countsByType: db.prepare(`
      SELECT content_type, count(*) AS count
      FROM skills
      GROUP BY content_type
    `),
    sectionCount: db.prepare(`SELECT count(*) AS count FROM sections`),
    tagCount: db.prepare(`SELECT count(*) AS count FROM tags`),
    telemetryCount: db.prepare(`SELECT count(*) AS count FROM telemetry`),
    insertTelemetry: db.prepare(`
      INSERT INTO telemetry (
        tool_name, query_text, file_tokens, response_tokens, tokens_saved, result_count, created_at
      ) VALUES (
        @tool_name, @query_text, @file_tokens, @response_tokens, @tokens_saved, @result_count, @created_at
      )
    `),
    telemetryReport: db.prepare(`
      SELECT
        count(*) AS total_queries,
        coalesce(sum(tokens_saved), 0) AS total_tokens_saved
      FROM telemetry
    `),
    telemetryByTool: db.prepare(`
      SELECT tool_name, count(*) AS queries, coalesce(sum(tokens_saved), 0) AS tokens_saved
      FROM telemetry
      GROUP BY tool_name
      ORDER BY tool_name ASC
    `),
  };

  const replaceDocumentTx = db.transaction((document) => {
    const indexedAt = new Date().toISOString();
    statements.upsertSkill.run({
      id: document.id,
      name: document.name,
      description: document.description || '',
      short_description: document.shortDescription || '',
      content_type: document.contentType,
      source_path: document.sourcePath,
      source_root: document.sourceRoot || '',
      relative_path: document.relativePath || '',
      precedence_scope: document.precedenceScope || '',
      hash: document.hash,
      line_count: document.lineCount || 0,
      token_estimate: document.tokenEstimate || 0,
      attributes_json: JSON.stringify(document.attributes || {}),
      warnings_json: JSON.stringify(document.warnings || []),
      indexed_at: indexedAt,
    });

    statements.deleteEmbeddings.run(document.id);
    statements.deleteFts.run(document.id);
    statements.deleteTags.run(document.id);
    statements.deleteSections.run(document.id);

    for (const tag of document.tags?.skill || []) {
      statements.insertTag.run(document.id, null, tag);
    }

    for (const section of document.sections || []) {
      const sectionId = `${document.id}:${section.slug}`;
      const sectionTags =
        document.tags?.sections?.find((entry) => entry.sectionSlug === section.slug)?.tags || [];

      statements.insertSection.run({
        id: sectionId,
        skill_id: document.id,
        heading: section.heading,
        slug: section.slug,
        kind: section.kind,
        depth: section.depth,
        parent_slug: section.parentSlug || null,
        parent_heading: section.parentHeading || null,
        start_line: section.startLine,
        end_line: section.endLine,
        content: section.content,
        token_estimate: section.tokenEstimate || 0,
      });

      for (const tag of sectionTags) {
        statements.insertTag.run(document.id, sectionId, tag);
      }

      const ftsTags = [...new Set([...(document.tags?.skill || []), ...sectionTags])].join(' ');
      statements.insertFts.run(
        document.id,
        sectionId,
        document.contentType,
        document.name,
        section.heading,
        section.content,
        ftsTags,
      );
    }

    if (document.embeddings) {
      for (const [sectionSlug, vector] of Object.entries(document.embeddings)) {
        const sectionId = `${document.id}:${sectionSlug}`;
        statements.insertEmbedding.run(
          sectionId,
          document.id,
          vector.length,
          JSON.stringify(vector),
          indexedAt,
        );
      }
    }
  });

  return {
    dbPath,
    close() {
      db.close();
    },
    replaceDocument(document) {
      replaceDocumentTx(document);
    },
    replaceDocuments(documents) {
      const tx = db.transaction((items) => {
        for (const item of items) {
          replaceDocumentTx(item);
        }
      });
      tx(documents);
    },
    setMeta(key, value) {
      statements.setMeta.run(key, JSON.stringify(value));
    },
    getMeta(key, fallback = null) {
      const row = statements.getMeta.get(key);
      if (!row) {
        return fallback;
      }
      return parseJson(row.value, fallback);
    },
    listDocuments({ contentType = 'skill', limit = 100 } = {}) {
      return statements.listSkills.all({ content_type: contentType, limit }).map(toSkillRecord);
    },
    resolveSkill(idOrName) {
      return toSkillRecord(statements.getSkillById.get(idOrName) || statements.getSkillByName.get(idOrName));
    },
    getSkillOutline(idOrName) {
      const skill = this.resolveSkill(idOrName);
      if (!skill) {
        return null;
      }
      const sections = statements.getSectionsBySkill.all(skill.id).map(toOutlineRecord);
      return {
        skill,
        sections,
      };
    },
    getSkillSection(idOrName, sectionName) {
      const skill = this.resolveSkill(idOrName);
      if (!skill) {
        return null;
      }
      const normalized = normalizeSectionKey(sectionName);
      const row =
        statements.getSectionBySlug.get(skill.id, normalized) ||
        statements.getSectionByHeading.get(skill.id, sectionName) ||
        statements.getSectionsBySkill.all(skill.id).find((entry) => normalizeSectionKey(entry.heading) === normalized);
      if (!row) {
        return null;
      }
      return {
        skill,
        section: {
          heading: row.heading,
          slug: row.slug,
          kind: row.kind,
          depth: row.depth,
          level: row.depth,
          parentSlug: row.parent_slug,
          parentHeading: row.parent_heading,
          startLine: row.start_line,
          endLine: row.end_line,
          content: row.content,
          tokenEstimate: row.token_estimate,
        },
      };
    },
    searchSkills({ query, limit = 10, contentType = 'skill', embedding = null } = {}) {
      const text = String(query || '').trim();
      if (!text) {
        return this.listDocuments({ contentType, limit }).map((skill) => ({
          ...skill,
          score: 0,
          preview: skill.description,
        }));
      }

      let matches = [];
      const matchExpression = text
        .split(/[^a-zA-Z0-9]+/)
        .map((token) => token.trim())
        .filter(Boolean)
        .map((token) => `${token.replace(/"/g, '')}*`)
        .join(' OR ');

      if (matchExpression) {
        try {
          matches = statements.searchFts.all(matchExpression, contentType, limit * 5);
        } catch {
          matches = [];
        }
      }

      if (!matches.length) {
        const needle = `%${text}%`;
        matches = statements.searchLike.all(contentType, needle, needle, needle, limit);
      }

      if (embedding?.length) {
        const semantic = statements.embeddingCandidates.all(contentType).map((row) => ({
          row,
          score: cosineSimilarity(embedding, parseJson(row.vector_json, [])),
        }));
        semantic.sort((left, right) => right.score - left.score);
        for (const { row, score } of semantic.slice(0, limit)) {
          matches.push({
            ...row,
            rank: Math.max(0.0001, 1 - score),
            semantic_score: score,
          });
        }
      }

      const deduped = new Map();
      for (const row of matches) {
        const current = deduped.get(row.id);
        const score = row.semantic_score ? 1 + row.semantic_score : 1 / (Number(row.rank) + 1);
        if (!current || score > current.score) {
          deduped.set(row.id, {
            ...toSkillRecord(row),
            score: Number(score.toFixed(4)),
            preview: row.preview || row.description,
            matchedSection: row.matched_heading
              ? {
                  heading: row.matched_heading,
                  slug: row.matched_slug,
                  kind: row.matched_kind,
                }
              : null,
          });
        }
      }

      return [...deduped.values()]
        .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name))
        .slice(0, limit);
    },
    recordTelemetry({
      toolName,
      queryText = '',
      fileTokens = 0,
      responseTokens = 0,
      resultCount = 0,
    }) {
      statements.insertTelemetry.run({
        tool_name: toolName,
        query_text: queryText,
        file_tokens: fileTokens,
        response_tokens: responseTokens,
        tokens_saved: Math.max(0, fileTokens - responseTokens),
        result_count: resultCount,
        created_at: new Date().toISOString(),
      });
    },
    getTelemetryReport() {
      const summary = statements.telemetryReport.get();
      const totalQueries = summary?.total_queries || 0;
      return {
        total_queries: totalQueries,
        total_tokens_saved: summary?.total_tokens_saved || 0,
        avg_tokens_saved_per_query:
          totalQueries > 0 ? Math.round((summary?.total_tokens_saved || 0) / totalQueries) : 0,
        by_tool: statements.telemetryByTool.all().map((row) => ({
          tool_name: row.tool_name,
          queries: row.queries,
          tokens_saved: row.tokens_saved,
        })),
      };
    },
    getStatus({ latestSourceMtime = null } = {}) {
      const countsByType = Object.fromEntries(
        statements.countsByType.all().map((row) => [row.content_type, row.count]),
      );
      const indexedAt = this.getMeta('last_indexed_at', null);
      const lastIndexedSourceMtime = this.getMeta('last_indexed_source_mtime', null);

      return {
        db_path: dbPath,
        indexed_at: indexedAt,
        last_indexed_source_mtime: lastIndexedSourceMtime,
        latest_source_mtime: latestSourceMtime,
        stale:
          latestSourceMtime != null &&
          lastIndexedSourceMtime != null &&
          Number(latestSourceMtime) > Number(lastIndexedSourceMtime),
        counts: {
          documents: Object.values(countsByType).reduce((sum, value) => sum + value, 0),
          skills: countsByType.skill || 0,
          policies: countsByType.policy || 0,
          sections: statements.sectionCount.get().count,
          tags: statements.tagCount.get().count,
          telemetry: statements.telemetryCount.get().count,
        },
      };
    },
  };
}
