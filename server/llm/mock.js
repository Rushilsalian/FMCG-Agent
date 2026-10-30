// MockLLM: a deterministic, keyword-based stand-in for Gemini.
// It implements the same interface (generate -> { text, toolCalls, raw }) and
// drives the real tools step by step, so tests and offline demos exercise the
// full agent loop. It is intentionally simple; it is not "intelligent".
import { searchProducts } from '../tools/catalog.js';

const NUMBER_WORDS = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, fifteen: 15, twenty: 20, thirty: 30, fifty: 50, hundred: 100,
};
const NUM = `\\d+|${Object.keys(NUMBER_WORDS).join('|')}`;
const QTY_WITH_UNIT = new RegExp(`\\b(${NUM})\\s*(cases?|cartons?|boxes?|units?|pieces?|pcs|packets?|packs?)\\b`);
const BARE_NUMBER = new RegExp(`\\b(${NUM})\\b`);

const YES = /\b(yes|yeah|yep|haan|correct|confirm(ed)?|ok|okay|sure|right|go ahead|please do)\b/;
const NO = /\b(no|nahi|nope|wrong|cancel)\b/;
const BYE = /\b(bye|goodbye|that'?s all|that is all|nothing else|no thanks)\b/;
const FOLLOWUP = /\b(call (me )?back|callback|follow ?up|visit|remind|send (me )?(the )?(details|price list|catalogue))\b/;
const STOCK = /\b(stock|available|availability)\b/;
const PRICE = /\b(price|rate|cost|how much|mrp|margin)\b/;
const SCHEME = /\b(schemes?|offers?|discounts?|deals?)\b/;
const WHEN = /\b(today|tonight|tomorrow|day after tomorrow|next week|this week|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d{1,2}\s*(am|pm))\b.*$/;

let callSeq = 0;
const say = (text, state) => ({ text, toolCalls: [], raw: state ? { mockState: state } : undefined });
const call = (name, args) => ({ text: '', toolCalls: [{ id: `mock-${++callSeq}`, name, args }] });

const rupees = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
const toNumber = (s) => NUMBER_WORDS[s] ?? Number(s);
const hasProduct = (text) => searchProducts({ query: text }).results.length > 0;
// "call me back on Friday after 4 pm" -> "Friday after 4 pm" (original casing)
function extractWhen(text) {
  const m = text.toLowerCase().match(WHEN);
  return m ? text.slice(m.index).replace(/[.?!]+$/, '').trim() : null;
}
const formatDate = (iso) =>
  new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' });

// Everything the mock needs to know about the current turn, rebuilt from history.
function currentTurn(messages) {
  let userIdx = messages.length - 1;
  while (userIdx >= 0 && messages[userIdx].role !== 'user') userIdx--;
  const text = messages[userIdx].text;
  const previous = messages.slice(0, userIdx).findLast((m) => m.role === 'assistant');
  const results = {};
  for (const m of messages.slice(userIdx + 1)) if (m.role === 'tool') results[m.name] = m.result;
  return { text, lower: text.toLowerCase(), state: previous?.raw?.mockState || {}, results };
}

function parseQuantity(lower, pendingOrder) {
  const m = lower.match(QTY_WITH_UNIT);
  if (m) return { match: m[0], quantity: toNumber(m[1]), unit: /case|carton|box/.test(m[2]) ? 'cases' : 'units' };
  // "make it 12" while an order is waiting for confirmation
  const bare = pendingOrder && lower.match(BARE_NUMBER);
  if (bare) return { match: bare[0], quantity: toNumber(bare[1]), unit: pendingOrder.unit };
  return null;
}

function outOfStockLine(stock) {
  const alt = stock.alternatives?.[0];
  return alt
    ? `Sorry, ${stock.name} is out of stock right now. I can offer ${alt.name} at ${rupees(alt.retailer_price)} instead. Would that work?`
    : `Sorry, ${stock.name} is out of stock right now. Shall I arrange a callback when it is back?`;
}

// --- intent handlers: each either calls the next tool or speaks ---

function handleOrder(turn, qty) {
  const pending = turn.state.pendingOrder;
  const query = turn.lower.replace(qty.match, ' ');
  let product;
  if (pending && !hasProduct(query)) {
    product = { sku: pending.sku, name: pending.name, retailer_price: pending.retailer_price };
  } else {
    const search = turn.results.search_products;
    if (!search) return call('search_products', { query });
    product = search.results[0];
    if (!product) return say("Sorry, I couldn't find that product. Could you tell me the brand or pack size?");
  }
  const stock = turn.results.check_availability;
  if (!stock) return call('check_availability', { sku: product.sku });
  if (stock.status === 'out_of_stock') return say(outOfStockLine(stock));

  const unitWord = qty.quantity === 1 ? qty.unit.replace(/s$/, '') : qty.unit;
  const lowNote = stock.status === 'low_stock' ? ` Only ${stock.cases_available} cases are in stock right now.` : '';
  return say(
    `Just to confirm, ${qty.quantity} ${unitWord} of ${product.name} at ${rupees(product.retailer_price)} per unit.${lowNote} Shall I note that?`,
    { pendingOrder: { ...product, quantity: qty.quantity, unit: qty.unit } },
  );
}

function handleConfirmOrder(turn) {
  const { sku, quantity, unit } = turn.state.pendingOrder;
  const rec = turn.results.record_order_interest;
  if (!rec) return call('record_order_interest', { sku, quantity, unit });
  if (!rec.ok) return say(`Sorry, I couldn't note that. ${rec.error}`);
  return say(`Done, I've noted ${rec.readback}.${rec.note ? ` ${rec.note}` : ''} Anything else you need today?`);
}

function handleFollowup(turn, followup) {
  if (!followup.when) return say('Sure. When would be a good time?', { pendingFollowup: followup });
  const rec = turn.results.record_followup;
  if (!rec) return call('record_followup', followup);
  const verbs = {
    callback: 'call you back',
    sales_visit: 'have our sales rep visit you',
    send_details: 'send you the details',
    stock_update: 'update you on stock',
    other: 'follow up',
  };
  return say(`Noted, we'll ${verbs[rec.recorded.type]} ${rec.recorded.when}. Is there anything else?`);
}

function newFollowup(turn) {
  const { lower, text } = turn;
  const type = /visit/.test(lower) ? 'sales_visit' : /send|details|price list|catalogue/.test(lower) ? 'send_details' : 'callback';
  return { type, details: `Retailer asked: "${text.trim()}"`, when: extractWhen(text) };
}

function handleStock(turn) {
  const search = turn.results.search_products;
  if (!search) return call('search_products', { query: turn.text });
  const product = search.results[0];
  const stock = turn.results.check_availability;
  if (!stock) return call('check_availability', { sku: product.sku });
  if (stock.status === 'out_of_stock') return say(outOfStockLine(stock));
  if (stock.status === 'low_stock') {
    const cases = `${stock.cases_available} case${stock.cases_available === 1 ? '' : 's'}`;
    return say(`We have only ${cases} of ${stock.name} left, so I'd suggest ordering soon. Shall I note some for you?`);
  }
  return say(`Yes, ${stock.name} is in stock, about ${stock.cases_available} cases. How many would you like?`);
}

function handlePrice(turn) {
  const search = turn.results.search_products;
  if (!search) return call('search_products', { query: turn.text });
  const product = search.results[0];
  const info = turn.results.get_price_and_schemes;
  if (!info) return call('get_price_and_schemes', { sku: product.sku });

  let line = `${info.name} has an MRP of ${rupees(info.mrp)} and your price is ${rupees(info.retailer_price)}, a ${info.margin_percent} percent margin.`;
  if (info.active_schemes.length) {
    line += ` There's an offer on it: ${info.active_schemes[0].description}`;
  } else if (info.expired_schemes.length) {
    const s = info.expired_schemes[0];
    line += ` The ${s.name} offer ended on ${formatDate(s.ended_on)}, and nothing is running on it right now.`;
  }
  return say(`${line} Would you like to order some?`);
}

function handleSchemes(turn) {
  const info = turn.results.get_price_and_schemes;
  if (!info) return call('get_price_and_schemes', {});
  const top = info.active_schemes.slice(0, 2).map((s) => s.description).join(' Also, ');
  return say(`We have ${info.active_schemes.length} offers running. ${top} Shall I tell you about any product in particular?`);
}

function respond(turn) {
  const { lower, state } = turn;

  if (state.pendingFollowup) {
    const when = extractWhen(turn.text) || turn.text.trim();
    return handleFollowup(turn, { ...state.pendingFollowup, when });
  }
  if (BYE.test(lower)) return say('Thank you for your time. Have a great day!');

  const qty = parseQuantity(lower, state.pendingOrder);
  if (state.pendingOrder) {
    if (qty) return handleOrder(turn, qty);
    if (NO.test(lower)) return say('No problem. What quantity should I note instead?', state);
    if (YES.test(lower)) return handleConfirmOrder(turn);
  }
  if (FOLLOWUP.test(lower)) return handleFollowup(turn, newFollowup(turn));

  const product = hasProduct(turn.text);
  if (qty && product) return handleOrder(turn, qty);
  if (STOCK.test(lower) && product) return handleStock(turn);
  if (product) return handlePrice(turn);
  if (SCHEME.test(lower) || PRICE.test(lower)) return handleSchemes(turn);
  if (YES.test(lower) || /\b(hello|hi|namaste)\b/.test(lower)) {
    return say('Great. Would you like to hear this week\'s offers, or check a price?');
  }
  return say('I can only help with our products, prices, schemes and stock. What would you like to check?');
}

export function createMockLLM() {
  return {
    name: 'mock',
    model: 'mock-rules',
    async generate({ messages }) {
      return respond(currentTurn(messages));
    },
    async generateJSON() {
      throw new Error('MockLLM does not write summaries; the rule-based summary is used instead.');
    },
  };
}
