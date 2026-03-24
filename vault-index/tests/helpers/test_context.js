import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { initDb } from '../../src/storage/db.js';

export async function createTestContext() {
  const root = await mkdtemp(join(tmpdir(), 'vault-index-test-'));
  const vaultPath = join(root, 'vault');
  const dbPath = join(root, 'index.db');

  await mkdir(vaultPath, { recursive: true });

  const db = initDb(dbPath);
  const embedder = {
    async embed() {
      return new Float32Array(384).fill(0.125);
    },
  };

  return {
    root,
    vaultPath,
    dbPath,
    db,
    embedder,
    async writeNote(relPath, content) {
      const fullPath = join(vaultPath, relPath);
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, content, 'utf8');
      return fullPath;
    },
    async moveNote(fromRelPath, toRelPath) {
      const fromFullPath = join(vaultPath, fromRelPath);
      const toFullPath = join(vaultPath, toRelPath);
      await mkdir(dirname(toFullPath), { recursive: true });
      await rename(fromFullPath, toFullPath);
      return toFullPath;
    },
    async cleanup() {
      try {
        db.close();
      } catch {}
      await rm(root, { recursive: true, force: true });
    },
  };
}
