// Read-only history API over the interaction repository.
import { Router } from 'express';
import { HttpError } from '../errors.js';

export function interactionsRouter({ repo }) {
  const router = Router();

  // Lightweight rows for the history table.
  router.get('/', async (req, res) => {
    const all = await repo.list();
    res.json(
      all.map((i) => ({
        id: i.id,
        startedAt: i.startedAt,
        durationSeconds: i.durationSeconds,
        retailer: i.retailer,
        outcome: i.summary.outcome,
        products: i.summary.products,
      })),
    );
  });

  router.get('/:id', async (req, res) => {
    if (!/^[\w-]{1,64}$/.test(req.params.id)) throw new HttpError(400, 'Invalid interaction id.');
    const interaction = await repo.get(req.params.id);
    if (!interaction) throw new HttpError(404, 'Interaction not found.');
    res.json(interaction);
  });

  return router;
}
