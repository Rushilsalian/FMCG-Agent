// In-memory conversation sessions keyed by a random ID. Idle sessions expire.
import { randomUUID } from 'node:crypto';

export function createSessionStore({ ttlMs }) {
  const sessions = new Map();

  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [id, s] of sessions) if (now - s.lastActiveAt > ttlMs) sessions.delete(id);
  }, 60_000);
  sweep.unref(); // don't keep the process (or tests) alive

  return {
    create(fields) {
      const session = { id: randomUUID(), lastActiveAt: Date.now(), ...fields };
      sessions.set(session.id, session);
      return session;
    },
    get(id) {
      const session = sessions.get(id);
      if (session) session.lastActiveAt = Date.now();
      return session;
    },
    delete(id) {
      sessions.delete(id);
    },
  };
}
