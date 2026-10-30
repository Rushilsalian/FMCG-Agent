// Small read-only endpoints the UI needs: health, retailers (with their last call) and the catalogue.
import { Router } from 'express';
import { retailers, catalogue } from '../tools/catalog.js';

export function metaRouter({ llm, repo }) {
  const router = Router();
  router.get('/health', (req, res) => res.json({ ok: true, llm: llm.name, model: llm.model }));

  router.get('/retailers', async (req, res) => {
    const history = await repo.list(); // newest first
    res.json(
      retailers.map((r) => {
        const calls = history.filter((i) => i.retailer.id === r.id);
        const last = calls[0];
        return {
          ...r,
          calls: calls.length,
          last_call: last ? { id: last.id, startedAt: last.startedAt, outcome: last.summary.outcome } : null,
        };
      }),
    );
  });

  router.get('/catalog', (req, res) => res.json(catalogue()));
  return router;
}
