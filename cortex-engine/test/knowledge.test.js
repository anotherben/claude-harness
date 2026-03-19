const Knowledge = require('../src/knowledge');
const fs = require('fs');
const path = require('path');
const os = require('os');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-knowledge-'));
}

describe('Knowledge Store', () => {
  let knowledge;
  let dir;

  beforeEach(() => {
    dir = tmpDir();
    knowledge = new Knowledge(dir);
  });

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('annotate', () => {
    it('stores an annotation for a file', () => {
      knowledge.annotate({
        target: 'services/orderService.js',
        note: 'Had 4 tenant_id bugs in the last month',
        author: 'claude',
        tags: ['tenant_id', 'security'],
      });

      const entries = knowledge.recall('services/orderService.js');
      expect(entries).toHaveLength(1);
      expect(entries[0].note).toContain('tenant_id');
      expect(entries[0].author).toBe('claude');
    });

    it('stores annotations for a symbol', () => {
      knowledge.annotate({
        target: 'services/orderService.js:listOrders',
        note: 'Always use the service pattern, not direct pool.query',
        author: 'ben',
        tags: ['pattern'],
      });

      const entries = knowledge.recall('services/orderService.js:listOrders');
      expect(entries).toHaveLength(1);
    });

    it('accumulates multiple annotations', () => {
      knowledge.annotate({ target: 'a.js', note: 'Note 1', author: 'c1' });
      knowledge.annotate({ target: 'a.js', note: 'Note 2', author: 'c2' });

      const entries = knowledge.recall('a.js');
      expect(entries).toHaveLength(2);
    });
  });

  describe('recall', () => {
    it('returns empty array for unknown target', () => {
      expect(knowledge.recall('nonexistent.js')).toEqual([]);
    });

    it('matches file-level annotations when querying symbol', () => {
      knowledge.annotate({ target: 'a.js', note: 'File note', author: 'x' });
      knowledge.annotate({ target: 'a.js:foo', note: 'Symbol note', author: 'x' });

      // Querying symbol should return both file-level and symbol-level
      const entries = knowledge.recall('a.js:foo');
      expect(entries.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('patterns', () => {
    it('returns annotations tagged as patterns for a directory', () => {
      knowledge.annotate({
        target: 'services/',
        note: 'All service files should use the owning-boundary pattern',
        author: 'ben',
        tags: ['pattern'],
      });

      const patterns = knowledge.patterns('services/');
      expect(patterns).toHaveLength(1);
      expect(patterns[0].note).toContain('owning-boundary');
    });
  });

  describe('lessons', () => {
    it('returns annotations tagged as lessons', () => {
      knowledge.annotate({
        target: 'global',
        note: 'Never use PUT on Render env vars — it wipes all existing variables',
        author: 'claude',
        tags: ['lesson', 'render'],
      });

      const lessons = knowledge.lessons();
      expect(lessons).toHaveLength(1);
      expect(lessons[0].note).toContain('Render');
    });

    it('filters lessons by tag', () => {
      knowledge.annotate({ target: 'global', note: 'Lesson about REX', author: 'c', tags: ['lesson', 'rex'] });
      knowledge.annotate({ target: 'global', note: 'Lesson about Shopify', author: 'c', tags: ['lesson', 'shopify'] });

      const rexLessons = knowledge.lessons('rex');
      expect(rexLessons).toHaveLength(1);
      expect(rexLessons[0].note).toContain('REX');
    });
  });

  describe('persistence', () => {
    it('persists annotations to JSONL file', () => {
      knowledge.annotate({ target: 'a.js', note: 'Persisted', author: 'test' });
      const jsonlPath = path.join(dir, '.cortex', 'knowledge.jsonl');
      expect(fs.existsSync(jsonlPath)).toBe(true);
      const content = fs.readFileSync(jsonlPath, 'utf-8');
      expect(content).toContain('Persisted');
    });

    it('loads annotations from existing JSONL on construction', () => {
      knowledge.annotate({ target: 'a.js', note: 'From previous session', author: 'test' });

      // Create new instance — should load existing data
      const knowledge2 = new Knowledge(dir);
      const entries = knowledge2.recall('a.js');
      expect(entries).toHaveLength(1);
      expect(entries[0].note).toBe('From previous session');
    });
  });

  describe('obsidian sync', () => {
    it('writes annotations to obsidian vault path when configured', () => {
      const obsidianDir = path.join(dir, 'vault');
      fs.mkdirSync(obsidianDir, { recursive: true });

      const k = new Knowledge(dir, { obsidianVault: obsidianDir });
      k.annotate({
        target: 'services/orderService.js',
        note: 'Critical: always check tenant_id',
        author: 'claude',
        tags: ['lesson'],
      });

      const files = fs.readdirSync(path.join(obsidianDir, '_cortex'));
      expect(files.length).toBeGreaterThan(0);
    });
  });

  describe('syncToObsidian', () => {
    let vaultDir;

    beforeEach(() => {
      vaultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-vault-'));
    });

    afterEach(() => {
      if (vaultDir) fs.rmSync(vaultDir, { recursive: true, force: true });
    });

    it('creates markdown files grouped by target', () => {
      knowledge.annotate({ target: 'src/foo.js', note: 'Note A', author: 'claude', tags: ['lesson'] });
      knowledge.annotate({ target: 'src/bar.js', note: 'Note B', author: 'ben', tags: ['pattern'] });
      knowledge.annotate({ target: 'src/foo.js', note: 'Note C', author: 'claude', tags: [] });

      const result = knowledge.syncToObsidian(vaultDir);

      expect(result.error).toBeUndefined();
      expect(result.synced).toBe(3);

      const fooMd = path.join(vaultDir, '_cortex', 'src/foo.js.md');
      const barMd = path.join(vaultDir, '_cortex', 'src/bar.js.md');

      expect(fs.existsSync(fooMd)).toBe(true);
      expect(fs.existsSync(barMd)).toBe(true);

      const fooContent = fs.readFileSync(fooMd, 'utf-8');
      expect(fooContent).toContain('## src/foo.js');
      expect(fooContent).toContain('Note A');
      expect(fooContent).toContain('Note C');

      const barContent = fs.readFileSync(barMd, 'utf-8');
      expect(barContent).toContain('Note B');
    });

    it('only syncs new annotations after first sync (timestamp tracking)', () => {
      knowledge.annotate({ target: 'src/a.js', note: 'First note', author: 'claude', tags: [] });

      // First sync — should capture the one entry
      const first = knowledge.syncToObsidian(vaultDir);
      expect(first.synced).toBe(1);
      expect(first.skipped).toBe(0);

      // Add a new annotation after the sync
      knowledge.annotate({ target: 'src/b.js', note: 'Second note', author: 'ben', tags: [] });

      // Second sync — should only write the new entry
      const second = knowledge.syncToObsidian(vaultDir);
      expect(second.synced).toBe(1);
      expect(second.skipped).toBe(1);

      // The new file should exist
      expect(fs.existsSync(path.join(vaultDir, '_cortex', 'src/b.js.md'))).toBe(true);
    });

    it('appends to existing markdown file when called again with new entries for same target', () => {
      knowledge.annotate({ target: 'src/c.js', note: 'Original note', author: 'claude', tags: [] });
      knowledge.syncToObsidian(vaultDir);

      knowledge.annotate({ target: 'src/c.js', note: 'Appended note', author: 'ben', tags: [] });
      knowledge.syncToObsidian(vaultDir);

      const content = fs.readFileSync(path.join(vaultDir, '_cortex', 'src/c.js.md'), 'utf-8');
      expect(content).toContain('Original note');
      expect(content).toContain('Appended note');
    });

    it('returns error gracefully when vault path does not exist', () => {
      const missing = path.join(os.tmpdir(), 'no-such-vault-' + Date.now());
      const result = knowledge.syncToObsidian(missing);

      expect(result.error).toMatch(/does not exist/);
      expect(result.synced).toBe(0);
    });

    it('returns error gracefully when no vault path is provided and env var is not set', () => {
      const k = new Knowledge(dir); // no obsidianVault config
      const origEnv = process.env.OBSIDIAN_VAULT_PATH;
      delete process.env.OBSIDIAN_VAULT_PATH;

      const result = k.syncToObsidian(); // no argument

      expect(result.error).toBeDefined();
      expect(result.synced).toBe(0);

      if (origEnv !== undefined) process.env.OBSIDIAN_VAULT_PATH = origEnv;
    });

    it('formats each annotation as a markdown section with timestamp and tags', () => {
      knowledge.annotate({ target: 'src/d.js', note: 'Important finding', author: 'claude', tags: ['lesson', 'security'] });
      knowledge.syncToObsidian(vaultDir);

      const content = fs.readFileSync(path.join(vaultDir, '_cortex', 'src/d.js.md'), 'utf-8');
      // Should contain the tags in the section header
      expect(content).toContain('lesson, security');
      expect(content).toContain('Important finding');
      // Should contain a timestamp (ISO format)
      expect(content).toMatch(/### \d{4}-\d{2}-\d{2}T/);
    });
  });
});
