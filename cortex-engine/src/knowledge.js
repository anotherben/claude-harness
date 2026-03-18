const fs = require('fs');
const path = require('path');

class Knowledge {
  constructor(projectRoot, config = {}) {
    this.projectRoot = path.resolve(projectRoot);
    this.cortexDir = path.join(this.projectRoot, '.cortex');
    this.jsonlPath = path.join(this.cortexDir, 'knowledge.jsonl');
    this.obsidianVault = config.obsidianVault || null;

    // In-memory store indexed by target
    this._entries = [];

    // Load existing JSONL if present
    this._load();
  }

  _load() {
    if (!fs.existsSync(this.jsonlPath)) return;
    const content = fs.readFileSync(this.jsonlPath, 'utf-8').trim();
    if (!content) return;

    for (const line of content.split('\n')) {
      if (!line.trim()) continue;
      try {
        this._entries.push(JSON.parse(line));
      } catch {
        // Skip malformed lines
      }
    }
  }

  _persist(entry) {
    if (!fs.existsSync(this.cortexDir)) {
      fs.mkdirSync(this.cortexDir, { recursive: true });
    }
    fs.appendFileSync(this.jsonlPath, JSON.stringify(entry) + '\n');
  }

  _syncToObsidian(entry) {
    if (!this.obsidianVault) return;
    const outDir = path.join(this.obsidianVault, '_cortex');
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

    // Write a markdown file per annotation
    const slug = entry.target.replace(/[\/:.]/g, '-').replace(/-+/g, '-');
    const ts = new Date(entry.timestamp).toISOString().replace(/[:.]/g, '-');
    const filename = `${ts}-${slug}.md`;

    const content = `---
target: ${entry.target}
author: ${entry.author || 'unknown'}
tags: [${(entry.tags || []).join(', ')}]
date: ${entry.timestamp}
---

${entry.note}
`;

    fs.writeFileSync(path.join(outDir, filename), content);
  }

  annotate({ target, note, author, tags } = {}) {
    const entry = {
      target,
      note,
      author: author || 'unknown',
      tags: tags || [],
      timestamp: new Date().toISOString(),
    };

    this._entries.push(entry);
    this._persist(entry);
    this._syncToObsidian(entry);
  }

  recall(target) {
    // If target is a symbol (file:symbol), also return file-level annotations
    const parts = target.split(':');
    const file = parts[0];

    return this._entries.filter((e) => {
      if (e.target === target) return true;
      if (parts.length > 1 && e.target === file) return true;
      return false;
    });
  }

  patterns(directoryPrefix) {
    return this._entries.filter((e) => {
      return e.target.startsWith(directoryPrefix) &&
        (e.tags || []).includes('pattern');
    });
  }

  lessons(tag) {
    return this._entries.filter((e) => {
      const tags = e.tags || [];
      if (!tags.includes('lesson')) return false;
      if (tag && !tags.includes(tag)) return false;
      return true;
    });
  }

  all() {
    return [...this._entries];
  }
}

module.exports = Knowledge;
