const MultiRepoEngine = require('../src/multirepo');
const fs = require('fs');
const path = require('path');
const os = require('os');

function tmpDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `cortex-${name}-`));
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

describe('MultiRepoEngine', () => {
  let engine;
  let dirA, dirB;

  afterEach(async () => {
    if (engine) await engine.close();
    if (dirA) fs.rmSync(dirA, { recursive: true, force: true });
    if (dirB) fs.rmSync(dirB, { recursive: true, force: true });
  });

  // PC-3: accepts array of project roots
  it('accepts multiple project roots', async () => {
    dirA = tmpDir('repoA');
    dirB = tmpDir('repoB');
    fs.writeFileSync(path.join(dirA, 'a.js'), 'function fromA() {}');
    fs.writeFileSync(path.join(dirB, 'b.js'), 'function fromB() {}');

    engine = new MultiRepoEngine([
      { name: 'repoA', root: dirA },
      { name: 'repoB', root: dirB },
    ]);
    await engine.ready();
    await sleep(500);

    const stats = engine.getStatus();
    expect(stats.repos).toHaveLength(2);
    expect(stats.totalFiles).toBeGreaterThanOrEqual(2);
  });

  // PC-4: queries return results tagged with repo name
  it('search results include repo name', async () => {
    dirA = tmpDir('repoA');
    dirB = tmpDir('repoB');
    fs.writeFileSync(path.join(dirA, 'a.js'), 'function sharedName() { return "A"; }');
    fs.writeFileSync(path.join(dirB, 'b.js'), 'function sharedName() { return "B"; }');

    engine = new MultiRepoEngine([
      { name: 'repoA', root: dirA },
      { name: 'repoB', root: dirB },
    ]);
    await engine.ready();
    await sleep(500);

    const results = engine.findSymbol('sharedName');
    expect(results.length).toBeGreaterThanOrEqual(2);
    const repos = results.map((r) => r.repo);
    expect(repos).toContain('repoA');
    expect(repos).toContain('repoB');
  });

  // PC-5: status shows per-repo stats
  it('status shows per-repo breakdown', async () => {
    dirA = tmpDir('repoA');
    dirB = tmpDir('repoB');
    fs.writeFileSync(path.join(dirA, 'a.js'), 'function fa() {}');
    fs.writeFileSync(path.join(dirB, 'b1.js'), 'function fb1() {}');
    fs.writeFileSync(path.join(dirB, 'b2.js'), 'function fb2() {}');

    engine = new MultiRepoEngine([
      { name: 'repoA', root: dirA },
      { name: 'repoB', root: dirB },
    ]);
    await engine.ready();
    await sleep(500);

    const stats = engine.getStatus();
    const repoA = stats.repos.find((r) => r.name === 'repoA');
    const repoB = stats.repos.find((r) => r.name === 'repoB');
    expect(repoA.fileCount).toBe(1);
    expect(repoB.fileCount).toBe(2);
  });

  // PC-6: outline and readSymbol work with repo prefix
  it('outline works with repo:path syntax', async () => {
    dirA = tmpDir('repoA');
    fs.writeFileSync(path.join(dirA, 'svc.js'), 'function handler() { return 1; }');

    engine = new MultiRepoEngine([{ name: 'repoA', root: dirA }]);
    await engine.ready();
    await sleep(500);

    const outline = engine.getOutline('repoA', 'svc.js');
    expect(outline.length).toBeGreaterThan(0);
    expect(outline[0].name).toBe('handler');
  });
});
