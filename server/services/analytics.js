// Dashboard numbers, computed from saved interactions. Pure functions, so the
// same figures can be tested, shown in the UI and exported.
import { OUTCOMES, SENTIMENTS } from './summarySchema.js';
import { todayISO } from '../config.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round(n * 100) / 100;
const countBy = (keys, values) => Object.fromEntries(keys.map((k) => [k, values.filter((v) => v === k).length]));

// Older saves have no quote; treat them as zero value rather than failing.
const netValue = (i) => i.quote?.net_value ?? 0;
const savings = (i) => i.quote?.total_savings ?? 0;

/**
 * @param {object[]} interactions newest first, as the repository lists them
 * @param {Date} now
 */
export function computeStats(interactions, now = new Date()) {
  const total = interactions.length;
  const orders = interactions.filter((i) => i.summary.outcome === 'order_enquiry');

  // Calls per IST day for the last 7 days, oldest first.
  const days = Array.from({ length: 7 }, (_, k) => todayISO(new Date(now.getTime() - (6 - k) * DAY_MS)));
  const callsByDay = days.map((date) => {
    const onDay = interactions.filter((i) => todayISO(new Date(i.startedAt)) === date);
    return { date, calls: onDay.length, value: round2(onDay.reduce((sum, i) => sum + netValue(i), 0)) };
  });

  // Product demand across every captured order line.
  const productMap = new Map();
  for (const i of interactions) {
    for (const line of i.quote?.lines || []) {
      const p = productMap.get(line.sku) || { sku: line.sku, name: line.name, units: 0, value: 0, enquiries: 0 };
      p.units += line.total_units;
      p.value = round2(p.value + line.value);
      p.enquiries++;
      productMap.set(line.sku, p);
    }
  }

  const toolUsage = {};
  for (const i of interactions) {
    for (const turn of i.transcript) for (const tool of turn.tools || []) toolUsage[tool] = (toolUsage[tool] || 0) + 1;
  }

  const recentFollowups = interactions
    .flatMap((i) => i.summary.followups.map((f) => ({ ...f, interactionId: i.id, retailer: i.retailer.store_name, calledAt: i.startedAt })))
    .slice(0, 6);

  const durations = interactions.map((i) => i.durationSeconds);
  return {
    total_calls: total,
    order_enquiries: orders.length,
    conversion_rate: total ? round2(orders.length / total) : 0,
    pipeline_value: round2(interactions.reduce((sum, i) => sum + netValue(i), 0)),
    savings_offered: round2(interactions.reduce((sum, i) => sum + savings(i), 0)),
    avg_duration_seconds: total ? Math.round(durations.reduce((a, b) => a + b, 0) / total) : 0,
    followups_count: interactions.reduce((sum, i) => sum + i.summary.followups.length, 0),
    llm_summary_share: total ? round2(interactions.filter((i) => i.summary.generated_by === 'llm').length / total) : 0,
    outcomes: countBy(OUTCOMES, interactions.map((i) => i.summary.outcome)),
    sentiments: countBy(SENTIMENTS, interactions.map((i) => i.summary.sentiment)),
    calls_by_day: callsByDay,
    top_products: [...productMap.values()].sort((a, b) => b.value - a.value).slice(0, 5),
    tool_usage: Object.entries(toolUsage).map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    recent_followups: recentFollowups,
  };
}

// RFC 4180: quote every field, double any quotes inside it.
const csvField = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;

export function toCsv(interactions) {
  const header = ['id', 'started_at', 'retailer', 'owner', 'area', 'duration_seconds', 'outcome', 'sentiment',
    'products', 'net_value_inr', 'savings_inr', 'followups', 'next_action'];
  const rows = interactions.map((i) => [
    i.id,
    i.startedAt,
    i.retailer.store_name,
    i.retailer.owner,
    i.retailer.area,
    i.durationSeconds,
    i.summary.outcome,
    i.summary.sentiment,
    i.summary.products.map((p) => `${p.quantity} ${p.unit} ${p.name}`).join('; '),
    netValue(i),
    savings(i),
    i.summary.followups.map((f) => `${f.type} (${f.when}): ${f.details}`).join('; '),
    i.summary.next_action,
  ]);
  return [header, ...rows].map((r) => r.map(csvField).join(',')).join('\r\n');
}
