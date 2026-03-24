import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSections } from '../src/markdown.js';

test('parseSections emits typed hierarchical metadata', () => {
  const sections = parseSections(`Lead-in text.

# Skill Engine
Overview text.

## Phase 1 Discover
Gather context.

### Step 1 Search
Use the search tool.

## Template Output
\`\`\`json
{}
\`\`\`

## Workflow
Primary workflow.

## Workflow
Secondary workflow.
`);

  const overview = sections[0];
  const phase = sections.find((section) => section.heading === 'Phase 1 Discover');
  const step = sections.find((section) => section.heading === 'Step 1 Search');
  const template = sections.find((section) => section.heading === 'Template Output');
  const workflowRepeat = sections.find((section) => section.slug === 'workflow-2');

  assert.equal(overview.slug, 'overview');
  assert.equal(overview.depth, 0);
  assert.equal(overview.startLine, 1);
  assert.equal(overview.kind, 'section');

  assert.equal(phase.kind, 'phase');
  assert.equal(phase.depth, 2);
  assert.equal(phase.parentSlug, 'skill-engine');
  assert.equal(phase.startLine, 6);
  assert.equal(phase.endLine, 8);
  assert.ok(phase.tokenEstimate > 0);

  assert.equal(step.kind, 'step');
  assert.equal(step.parentSlug, phase.slug);
  assert.equal(step.startLine, 9);

  assert.equal(template.kind, 'template');
  assert.equal(template.parentSlug, 'skill-engine');

  assert.ok(workflowRepeat);
  assert.equal(workflowRepeat.kind, 'section');
});
