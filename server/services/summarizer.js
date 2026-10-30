// End-of-call summary. The LLM writes the narrative; captured tool data
// supplies the facts; a rule-based fallback guarantees we always save something valid.
import { narrativeJsonSchema, validateSummary } from './summarySchema.js';
import { SUMMARY_SYSTEM_PROMPT } from './prompts.js';
import { orderReadback } from '../tools/capture.js';

function factsFrom(captured) {
  return {
    products: captured.orders.map(({ sku, name, quantity, unit }) => ({ sku, name, quantity, unit })),
    schemes_discussed: captured.schemes_discussed.map(({ id, name, status }) => ({ id, name, status })),
    followups: captured.followups.map(({ type, details, when }) => ({ type, details, when })),
  };
}

// Captured facts decide the outcome when they can; the LLM only chooses
// between "info_only" and "not_interested", which needs judgement.
function reconcileOutcome(proposed, captured) {
  if (captured.orders.length) return 'order_enquiry';
  if (captured.followups.length) return 'follow_up_required';
  return proposed === 'not_interested' ? 'not_interested' : 'info_only';
}

function ruleBasedNarrative(retailer, transcript, captured) {
  const parts = [`Call with ${retailer.owner} of ${retailer.store_name}.`];
  if (captured.orders.length) parts.push(`Order enquiry for ${captured.orders.map(orderReadback).join(', ')}.`);
  if (captured.followups.length) parts.push(`Follow-up requested: ${captured.followups.map((f) => `${f.details} (${f.when})`).join('; ')}.`);
  if (captured.schemes_discussed.length) parts.push(`Schemes discussed: ${captured.schemes_discussed.map((s) => s.name).join(', ')}.`);
  if (parts.length === 1) parts.push(`${transcript.filter((t) => t.role === 'retailer').length} retailer turns; nothing was captured.`);

  const next_action = captured.orders.length
    ? 'Sales team to confirm the order enquiry, pricing and dispatch with the retailer.'
    : captured.followups.length
      ? `Complete the follow-up: ${captured.followups[0].details} (${captured.followups[0].when}).`
      : 'No action needed; check in on the next visit cycle.';

  return { overview: parts.join(' '), outcome: reconcileOutcome('info_only', captured), sentiment: 'neutral', next_action };
}

function buildPrompt(retailer, transcript, captured) {
  const lines = transcript.map((t) => `${t.role === 'agent' ? 'Sales rep' : 'Retailer'}: ${t.text}`).join('\n');
  return `Retailer: ${retailer.store_name} (${retailer.owner}, ${retailer.area})

Transcript:
${lines}

Captured by the system (ground truth):
${JSON.stringify(factsFrom(captured), null, 2)}

Write the summary fields.`;
}

/**
 * Never throws: if the LLM fails or returns something invalid, falls back to rules.
 * @returns {Promise<object>} a summary that passes validateSummary
 */
export async function summarize({ llm, retailer, transcript, captured }) {
  const facts = factsFrom(captured);
  try {
    const narrative = await llm.generateJSON({
      system: SUMMARY_SYSTEM_PROMPT,
      prompt: buildPrompt(retailer, transcript, captured),
      schema: narrativeJsonSchema,
    });
    const summary = {
      overview: narrative.overview,
      outcome: reconcileOutcome(narrative.outcome, captured),
      ...facts,
      sentiment: narrative.sentiment,
      next_action: narrative.next_action,
      generated_by: 'llm',
    };
    const errors = validateSummary(summary);
    if (errors.length === 0) return summary;
    console.warn('LLM summary failed validation, using rules:', errors.join('; '));
  } catch (err) {
    if (llm.name !== 'mock') console.warn('LLM summary failed, using rules:', err.message);
  }
  return { ...ruleBasedNarrative(retailer, transcript, captured), ...facts, generated_by: 'rules' };
}
