const Fleet = require('../src/fleet');
const Knowledge = require('../src/knowledge');
const fs = require('fs');
const path = require('path');
const os = require('os');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-fleet-'));
}

describe('Fleet Integration', () => {
  let fleet;
  let knowledge;
  let dir;

  beforeEach(() => {
    dir = tmpDir();
    knowledge = new Knowledge(dir);
    fleet = new Fleet(knowledge);
  });

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('ingestHandover', () => {
    it('extracts lessons from a handover markdown', () => {
      const handover = `# Handover: Fix Order Bug

## What Was Done
Fixed the tenant_id scoping issue in orderService.js.

## Lessons Learned
- Always check tenant_id scoping in new queries
- The orderService.js file has had 4 tenant_id bugs — add it to the watch list

## Files Modified
- apps/api/src/services/orderService.js
`;

      const count = fleet.ingestHandover(handover, 'worker-1');
      expect(count).toBeGreaterThanOrEqual(2);

      const lessons = knowledge.lessons();
      expect(lessons.length).toBeGreaterThanOrEqual(2);
      expect(lessons.some((l) => l.note.includes('tenant_id'))).toBe(true);
    });

    it('skips handovers without lessons section', () => {
      const handover = `# Handover: Simple Task\n\n## What Was Done\nAdded a button.\n`;
      const count = fleet.ingestHandover(handover, 'worker-2');
      expect(count).toBe(0);
    });
  });

  describe('learningReport', () => {
    it('generates a fleet learning report', () => {
      knowledge.annotate({ target: 'a.js', note: 'Lesson 1', author: 'worker-1', tags: ['lesson'] });
      knowledge.annotate({ target: 'b.js', note: 'Lesson 2', author: 'worker-2', tags: ['lesson'] });
      knowledge.annotate({ target: 'c.js', note: 'Pattern 1', author: 'worker-1', tags: ['pattern'] });

      const report = fleet.learningReport();
      expect(report.totalAnnotations).toBe(3);
      expect(report.lessonCount).toBe(2);
      expect(report.patternCount).toBe(1);
      expect(report.byAuthor).toHaveProperty('worker-1');
      expect(report.byAuthor['worker-1']).toBe(2);
    });
  });

  describe('getMcpConfig', () => {
    it('returns valid MCP server config for cortex-engine', () => {
      const config = fleet.getMcpConfig('/path/to/project');
      expect(config).toHaveProperty('command');
      expect(config).toHaveProperty('args');
      expect(config.command).toBe('node');
      expect(config.args).toContain('/path/to/project');
    });
  });
});
