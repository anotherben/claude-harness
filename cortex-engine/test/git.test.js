const GitIntegration = require('../src/git');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

function tmpGitRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cortex-git-'));
  execSync('git init', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'ignore' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'ignore' });

  // Create initial commit
  fs.writeFileSync(path.join(dir, 'app.js'), 'function hello() { return "world"; }\n');
  fs.writeFileSync(path.join(dir, 'utils.js'), 'function add(a, b) { return a + b; }\n');
  execSync('git add -A && git commit -m "init"', { cwd: dir, stdio: 'ignore' });

  return dir;
}

describe('GitIntegration', () => {
  let git;
  let dir;

  afterEach(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('git_status', () => {
    it('returns branch name and clean status', async () => {
      dir = tmpGitRepo();
      git = new GitIntegration(dir);
      const status = await git.status();
      expect(status.branch).toBeDefined();
      expect(status.modified).toEqual([]);
      expect(status.staged).toEqual([]);
    });

    it('detects uncommitted changes', async () => {
      dir = tmpGitRepo();
      fs.writeFileSync(path.join(dir, 'app.js'), 'function hello() { return "changed"; }\n');
      git = new GitIntegration(dir);
      const status = await git.status();
      expect(status.modified).toContain('app.js');
    });
  });

  describe('git_log', () => {
    it('returns recent commits', async () => {
      dir = tmpGitRepo();
      git = new GitIntegration(dir);
      const log = await git.log({ maxCount: 5 });
      expect(log.length).toBeGreaterThanOrEqual(1);
      expect(log[0]).toHaveProperty('hash');
      expect(log[0]).toHaveProperty('message');
      expect(log[0]).toHaveProperty('date');
      expect(log[0]).toHaveProperty('author');
    });

    it('filters log by file path', async () => {
      dir = tmpGitRepo();
      // Make a second commit touching only app.js
      fs.writeFileSync(path.join(dir, 'app.js'), 'function hello() { return "v2"; }\n');
      execSync('git add -A && git commit -m "update app"', { cwd: dir, stdio: 'ignore' });

      git = new GitIntegration(dir);
      const log = await git.log({ file: 'app.js', maxCount: 10 });
      expect(log.length).toBe(2); // init + update
      const utilsLog = await git.log({ file: 'utils.js', maxCount: 10 });
      expect(utilsLog.length).toBe(1); // only init
    });
  });

  describe('git_diff', () => {
    it('returns diff for uncommitted changes', async () => {
      dir = tmpGitRepo();
      fs.writeFileSync(path.join(dir, 'app.js'), 'function hello() { return "modified"; }\n');
      git = new GitIntegration(dir);
      const diff = await git.diff();
      expect(diff).toContain('modified');
      expect(diff).toContain('app.js');
    });

    it('returns diff between branches', async () => {
      dir = tmpGitRepo();
      const defaultBranch = execSync('git branch --show-current', { cwd: dir }).toString().trim();
      execSync('git checkout -b feature', { cwd: dir, stdio: 'ignore' });
      fs.writeFileSync(path.join(dir, 'new.js'), 'function newFunc() {}\n');
      execSync('git add -A && git commit -m "add new"', { cwd: dir, stdio: 'ignore' });

      git = new GitIntegration(dir);
      const diff = await git.diff({ from: defaultBranch });
      expect(diff).toContain('new.js');
    });
  });

  describe('git_blame', () => {
    it('returns blame for a file', async () => {
      dir = tmpGitRepo();
      git = new GitIntegration(dir);
      const blame = await git.blame('app.js');
      expect(blame.length).toBeGreaterThan(0);
      expect(blame[0]).toHaveProperty('author');
      expect(blame[0]).toHaveProperty('line');
      expect(blame[0]).toHaveProperty('content');
    });
  });

  describe('git_hotspots', () => {
    it('returns files sorted by edit frequency', async () => {
      dir = tmpGitRepo();
      // Make multiple commits to app.js
      for (let i = 0; i < 3; i++) {
        fs.writeFileSync(path.join(dir, 'app.js'), `function hello() { return "v${i + 2}"; }\n`);
        execSync(`git add -A && git commit -m "update app v${i + 2}"`, { cwd: dir, stdio: 'ignore' });
      }
      git = new GitIntegration(dir);
      const hotspots = await git.hotspots({ days: 30 });
      expect(hotspots.length).toBeGreaterThanOrEqual(1);
      expect(hotspots[0].file).toBe('app.js');
      expect(hotspots[0].editCount).toBeGreaterThanOrEqual(3);
    });
  });
});
