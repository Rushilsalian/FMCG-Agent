// Small read-only endpoints the UI needs at start-up.
import { Router } from 'express';
import { retailers } from '../tools/catalog.js';

export function metaRouter({ llm }) {
  const router = Router();
  router.get('/health', (req, res) => res.json({ ok: true, llm: llm.name, model: llm.model }));
  router.get('/retailers', (req, res) => res.json(retailers));
  return router;
}
