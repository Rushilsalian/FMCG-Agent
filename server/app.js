// Builds the Express app from its dependencies, so tests can pass in a
// MockLLM and a temporary store.
import express from 'express';
import { config } from './config.js';
import { createAgent } from './services/agent.js';
import { createSessionStore } from './services/sessionStore.js';
import { metaRouter } from './routes/meta.js';
import { sessionsRouter } from './routes/sessions.js';
import { errorHandler } from './errors.js';

export function createApp({ llm }) {
  const sessions = createSessionStore({ ttlMs: config.sessionTtlMs });
  const agent = createAgent({ llm, sessions });

  const app = express();
  app.use(express.json({ limit: '10kb' }));
  app.use(express.static(config.publicDir));
  app.use('/api', metaRouter({ llm }));
  app.use('/api/sessions', sessionsRouter({ agent, sessions }));
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found.' }));
  app.use(errorHandler);
  return app;
}
