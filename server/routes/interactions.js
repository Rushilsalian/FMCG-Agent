// History API over the interaction repository: list, detail, dashboard stats and CSV export.
import { Router } from 'express';
import { HttpError } from '../errors.js';
import { computeStats, toCsv } from '../services/analytics.js';

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
        sentiment: i.summary.sentiment,
        products: i.summary.products,
        followups: i.summary.followups.length,
        netValue: i.quote?.net_value ?? null,
      })),
    );
  });

  // Registered before /:id so "stats" and "export.csv" aren't read as ids.
  router.get('/stats', async (req, res) => {
    res.json(computeStats(await repo.list()));
  });

  router.get('/export.csv', async (req, res) => {
    const csv = toCsv(await repo.list());
    res.set('content-type', 'text/csv; charset=utf-8');
    res.set('content-disposition', `attachment; filename="interactions-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(`﻿${csv}`); // BOM so Excel reads ₹ and names correctly
  });

  router.get('/:id', async (req, res) => {
    if (!/^[\w-]{1,64}$/.test(req.params.id)) throw new HttpError(400, 'Invalid interaction id.');
    const interaction = await repo.get(req.params.id);
    if (!interaction) throw new HttpError(404, 'Interaction not found.');
    res.json(interaction);
  });

  return router;
}
