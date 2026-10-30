// Saved interactions in a single JSON file. Callers only see list/get/save,
// so this could become SQLite or Postgres without touching the rest of the app.
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import path from 'node:path';

export function createInteractionRepo(filePath) {
  let writeQueue = Promise.resolve(); // serialise writes so concurrent saves don't clobber each other

  async function readAll() {
    try {
      return JSON.parse(await readFile(filePath, 'utf8'));
    } catch (err) {
      if (err.code === 'ENOENT') return [];
      throw err;
    }
  }

  return {
    /** Newest first. */
    async list() {
      return (await readAll()).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    },

    async get(id) {
      return (await readAll()).find((i) => i.id === id) || null;
    },

    save(interaction) {
      writeQueue = writeQueue
        .catch(() => {}) // a past failure must not block future saves
        .then(async () => {
          const all = await readAll();
          all.push(interaction);
          await mkdir(path.dirname(filePath), { recursive: true });
          // Write then rename, so a crash mid-write never leaves a half-written file.
          const tmp = `${filePath}.tmp`;
          await writeFile(tmp, JSON.stringify(all, null, 2));
          await rename(tmp, filePath);
          return interaction;
        });
      return writeQueue;
    },
  };
}
