// The summary contract: what gets saved and shown for every interaction.
import { ORDER_UNITS, FOLLOWUP_TYPES } from '../tools/capture.js';

export const OUTCOMES = ['order_enquiry', 'follow_up_required', 'info_only', 'not_interested'];
export const SENTIMENTS = ['positive', 'neutral', 'negative'];

// The part we ask the LLM to write. Facts (products, follow-ups, schemes)
// come from captured tool data instead, so the model cannot misstate them.
export const narrativeJsonSchema = {
  type: 'object',
  properties: {
    overview: { type: 'string', description: 'Two or three sentences on what happened in the call.' },
    outcome: { type: 'string', enum: OUTCOMES },
    sentiment: { type: 'string', enum: SENTIMENTS, description: "The retailer's overall mood." },
    next_action: { type: 'string', description: 'One concrete next step for the sales team.' },
  },
  required: ['overview', 'outcome', 'sentiment', 'next_action'],
};

const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;

/** Returns a list of problems; an empty list means the summary is valid. */
export function validateSummary(s) {
  if (!s || typeof s !== 'object') return ['summary must be an object'];
  const errors = [];
  if (!isText(s.overview, 1000)) errors.push('overview must be a non-empty string');
  if (!OUTCOMES.includes(s.outcome)) errors.push(`outcome must be one of ${OUTCOMES.join(', ')}`);
  if (!SENTIMENTS.includes(s.sentiment)) errors.push(`sentiment must be one of ${SENTIMENTS.join(', ')}`);
  if (!isText(s.next_action, 500)) errors.push('next_action must be a non-empty string');

  if (!Array.isArray(s.products)) errors.push('products must be an array');
  else {
    s.products.forEach((p, i) => {
      if (!isText(p?.sku, 40) || !isText(p?.name, 120)) errors.push(`products[${i}] needs sku and name`);
      if (!Number.isInteger(p?.quantity) || p.quantity < 1) errors.push(`products[${i}].quantity must be a positive integer`);
      if (!ORDER_UNITS.includes(p?.unit)) errors.push(`products[${i}].unit must be one of ${ORDER_UNITS.join(', ')}`);
    });
  }

  if (!Array.isArray(s.followups)) errors.push('followups must be an array');
  else {
    s.followups.forEach((f, i) => {
      if (!FOLLOWUP_TYPES.includes(f?.type)) errors.push(`followups[${i}].type is invalid`);
      if (!isText(f?.details, 300) || !isText(f?.when, 80)) errors.push(`followups[${i}] needs details and when`);
    });
  }

  if (!Array.isArray(s.schemes_discussed)) errors.push('schemes_discussed must be an array');
  else if (s.schemes_discussed.some((x) => !isText(x?.id, 40) || !isText(x?.name, 120))) {
    errors.push('each scheme needs id and name');
  }
  return errors;
}
