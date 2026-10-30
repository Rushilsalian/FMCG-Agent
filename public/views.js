// Read-only screens: dashboard, history, interaction detail/summary and catalogue.
import {
  h, icon, rupees, compactRupees, formatDateTime, formatTime, formatLatency, qty, formatDuration, timeAgo, plural, humanize,
  sentence, initials, avatarClass, OUTCOME_LABELS, outcomePill, toast, downloadFile,
} from './ui.js';
import { barList, columnChart, stackedBar, dataTable } from './charts.js';

const TOOL_LABELS = {
  search_products: 'Search products',
  get_price_and_schemes: 'Price & schemes',
  check_availability: 'Check stock',
  record_order_interest: 'Record order',
  record_followup: 'Record follow-up',
  quote_order: 'Quote order',
};
export const toolLabel = (name) => TOOL_LABELS[name] || humanize(name);

const emptyState = (title, text, action) =>
  h('div', { class: 'empty-state' }, icon('spark', 'empty-icon'), h('h3', {}, title), h('p', { class: 'muted' }, text), action);

// ---------- dashboard ----------

function statTile(label, value, sub) {
  return h('div', { class: 'stat' }, h('span', { class: 'stat-label' }, label), h('span', { class: 'stat-value' }, value), sub ? h('span', { class: 'stat-sub' }, sub) : null);
}

const chartCard = (title, subtitle, body, table, cls = '') =>
  h('section', { class: `card chart-card ${cls}` }, h('header', {}, h('h3', {}, title), subtitle ? h('p', { class: 'muted' }, subtitle) : null), body, table);

export function renderDashboard(container, stats, { onOpen, onStart }) {
  if (!stats.total_calls) {
    container.replaceChildren(
      emptyState('No calls yet', 'Start a call, or run "npm run seed" to load a week of demo calls through the real agent.',
        h('button', { class: 'primary', onclick: onStart }, icon('phone'), 'Start a call')),
    );
    return;
  }
  const dayLabel = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'short' });

  container.replaceChildren(
    h(
      'div',
      { class: 'dash-grid' },
      h('section', { class: 'card hero-card' },
        h('span', { class: 'stat-label' }, 'Order pipeline (net of offers)'),
        h('span', { class: 'hero-value' }, rupees(Math.round(stats.pipeline_value))),
        h('span', { class: 'stat-sub' }, `${plural(stats.order_enquiries, 'order enquiry')} · ${compactRupees(stats.savings_offered)} saved for retailers by schemes`)),
      h('div', { class: 'stat-row' },
        statTile('Calls handled', String(stats.total_calls), `avg ${formatDuration(stats.avg_duration_seconds)}`),
        statTile('Conversion', `${Math.round(stats.conversion_rate * 100)}%`, 'calls with an order enquiry'),
        statTile('Follow-ups', String(stats.followups_count), 'callbacks, visits, details'),
        statTile('AI summaries', `${Math.round(stats.llm_summary_share * 100)}%`, 'written by the LLM, rest by rules')),

      chartCard('Calls, last 7 days', 'Hover a day for the order value',
        columnChart(stats.calls_by_day.map((d) => ({ label: dayLabel(d.date), value: d.calls, display: String(d.calls), detail: `${rupees(d.value)} in orders` }))),
        dataTable(['Date', 'Calls', 'Order value'], stats.calls_by_day.map((d) => [d.date, d.calls, rupees(d.value)])), 'span-2'),

      chartCard('Outcome mix', `${plural(stats.total_calls, 'call')}`,
        stackedBar(Object.entries(stats.outcomes).map(([key, value], i) => ({ label: OUTCOME_LABELS[key], value, slot: i + 1 }))),
        dataTable(['Outcome', 'Calls'], Object.entries(stats.outcomes).map(([k, v]) => [OUTCOME_LABELS[k], v]))),

      chartCard('Top products by enquiry value', 'Across all captured order lines',
        stats.top_products.length
          ? barList(stats.top_products.map((p) => ({ label: p.name, value: p.value, display: compactRupees(p.value), detail: `${p.units.toLocaleString('en-IN')} units · ${plural(p.enquiries, 'enquiry')}` })))
          : h('p', { class: 'muted' }, 'No orders captured yet.'),
        dataTable(['Product', 'Units', 'Value'], stats.top_products.map((p) => [p.name, p.units, rupees(p.value)]))),

      chartCard('How the agent works', 'Tool calls the LLM made to ground its answers',
        barList(stats.tool_usage.map((t) => ({ label: toolLabel(t.name), value: t.count, display: String(t.count) }))),
        dataTable(['Tool', 'Calls'], stats.tool_usage.map((t) => [t.name, t.count]))),

      h('section', { class: 'card' },
        h('header', {}, h('h3', {}, 'Recent follow-ups'), h('p', { class: 'muted' }, 'Promised to retailers')),
        stats.recent_followups.length
          ? h('ul', { class: 'feed' }, stats.recent_followups.map((f) =>
            h('li', { tabindex: '0', onclick: () => onOpen(f.interactionId), onkeydown: (e) => e.key === 'Enter' && onOpen(f.interactionId) },
              icon(f.type === 'sales_visit' ? 'phone' : 'clock', 'feed-icon'),
              h('div', {}, h('strong', {}, `${sentence(f.type)} · ${f.when}`), h('small', {}, `${f.retailer} · ${timeAgo(f.calledAt)}`)))))
          : h('p', { class: 'muted' }, 'None yet.')),
    ),
  );
}

// ---------- history ----------

export function renderHistory(container, rows, { onOpen }) {
  if (!rows.length) {
    container.replaceChildren(emptyState('No interactions yet', 'Start a call and end it to see it here.'));
    return;
  }
  const filter = { outcome: 'all', query: '' };

  const counts = Object.fromEntries(Object.keys(OUTCOME_LABELS).map((k) => [k, rows.filter((r) => r.outcome === k).length]));
  const chips = h('div', { class: 'chip-row', role: 'group', 'aria-label': 'Filter by outcome' },
    [['all', 'All', rows.length], ...Object.entries(OUTCOME_LABELS).map(([k, label]) => [k, label, counts[k]])]
      .filter(([, , n]) => n > 0)
      .map(([key, label, n]) =>
        h('button', { class: 'chip', 'data-key': key, 'aria-pressed': String(key === 'all'), onclick: () => { filter.outcome = key; update(); } },
          label, h('span', { class: 'chip-count' }, n))));
  const search = h('input', { type: 'search', class: 'search', placeholder: 'Search retailer, owner or product...', 'aria-label': 'Search history',
    oninput: (e) => { filter.query = e.target.value.toLowerCase().trim(); update(); } });
  const tbody = h('tbody');
  const none = h('p', { class: 'muted', hidden: true }, 'No calls match these filters.');

  const row = (r) =>
    h('tr', { onclick: () => onOpen(r.id), tabindex: '0', onkeydown: (e) => e.key === 'Enter' && onOpen(r.id) },
      h('td', { 'data-label': 'Date' }, formatDateTime(r.startedAt)),
      h('td', { 'data-label': 'Retailer' }, h('div', { class: 'who' }, h('span', { class: `${avatarClass(r.retailer.store_name)} sm` }, initials(r.retailer.store_name)),
        h('div', {}, h('strong', {}, r.retailer.store_name), h('small', { class: 'muted' }, r.retailer.owner)))),
      h('td', { 'data-label': 'Outcome' }, outcomePill(r.outcome)),
      h('td', { 'data-label': 'Products' }, r.products.length ? r.products.map((p) => `${qty(p.quantity, p.unit)} ${p.name}`).join(', ') : '–'),
      h('td', { 'data-label': 'Value', class: 'num' }, r.netValue ? rupees(r.netValue) : '–'),
      h('td', { 'data-label': 'Length', class: 'num' }, formatDuration(r.durationSeconds)));

  function update() {
    chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.key === filter.outcome)));
    const matches = rows.filter((r) =>
      (filter.outcome === 'all' || r.outcome === filter.outcome) &&
      (!filter.query || [r.retailer.store_name, r.retailer.owner, r.retailer.area, ...r.products.map((p) => p.name)].join(' ').toLowerCase().includes(filter.query)));
    tbody.replaceChildren(...matches.map(row));
    none.hidden = matches.length > 0;
  }
  update();

  container.replaceChildren(
    h('div', { class: 'toolbar' }, search,
      h('a', { class: 'button secondary', href: '/api/interactions/export.csv', download: true }, icon('download'), 'Export CSV')),
    chips,
    h('div', { class: 'table-wrap' },
      h('table', { class: 'history-table' },
        h('thead', {}, h('tr', {}, ['Date', 'Retailer', 'Outcome', 'Products', 'Value', 'Length'].map((c) => h('th', { class: ['Value', 'Length'].includes(c) ? 'num' : undefined }, c)))),
        tbody)),
    none,
  );
}

// ---------- interaction (summary screen and history detail) ----------

const listOrNone = (items, render) => (items.length ? h('ul', { class: 'plain' }, items.map((x) => h('li', {}, render(x)))) : h('span', { class: 'muted' }, 'None'));

export function quoteBreakdown(quote) {
  if (!quote?.lines.length) return h('p', { class: 'muted' }, 'No order captured.');
  return h('div', { class: 'quote' },
    h('ul', { class: 'quote-lines' }, quote.lines.map((l) =>
      h('li', {}, h('span', {}, `${qty(l.quantity, l.unit)} · ${l.name}`), h('span', { class: 'num' }, rupees(l.value))))),
    h('dl', { class: 'quote-totals' },
      h('dt', {}, 'Gross'), h('dd', {}, rupees(quote.gross_value)),
      ...quote.discounts.flatMap((d) => [h('dt', {}, icon('tag'), d.scheme), h('dd', { class: 'saving' }, `−${rupees(d.amount)}`)]),
      ...quote.free_goods.flatMap((f) => [h('dt', {}, icon('gift'), `${f.scheme}: ${plural(f.cases, 'case')} free`), h('dd', { class: 'saving' }, `worth ${rupees(f.value)}`)]),
      h('dt', { class: 'net' }, 'Net value'), h('dd', { class: 'net' }, rupees(quote.net_value))));
}

function summaryText(interaction) {
  const { summary: s, retailer } = interaction;
  return [
    `${retailer.store_name} (${retailer.owner}) · ${formatDateTime(interaction.startedAt)}`,
    `Outcome: ${OUTCOME_LABELS[s.outcome]} · Sentiment: ${s.sentiment}`,
    s.overview,
    s.products.length ? `Products: ${s.products.map((p) => `${qty(p.quantity, p.unit)} ${p.name}`).join('; ')}` : '',
    interaction.quote?.lines.length ? `Net value: ${rupees(interaction.quote.net_value)} (saves ${rupees(interaction.quote.total_savings)})` : '',
    s.followups.length ? `Follow-ups: ${s.followups.map((f) => `${humanize(f.type)} ${f.when}: ${f.details}`).join('; ')}` : '',
    `Next action: ${s.next_action}`,
  ].filter(Boolean).join('\n');
}

export function renderInteraction(interaction, { withTranscript }) {
  const { summary, retailer, quote } = interaction;
  const actions = h('div', { class: 'actions no-print' },
    h('button', { class: 'secondary', onclick: async () => {
      try { await navigator.clipboard.writeText(summaryText(interaction)); toast('Summary copied'); } catch { toast('Copy is not allowed here', 'error'); }
    } }, icon('copy'), 'Copy'),
    h('button', { class: 'secondary', onclick: () => downloadFile(`interaction-${interaction.id}.json`, JSON.stringify(interaction, null, 2), 'application/json') }, icon('download'), 'JSON'),
    h('button', { class: 'secondary', onclick: () => window.print() }, icon('print'), 'Print'));

  const card = h('div', { class: 'summary-grid' },
    h('section', { class: 'card summary-hero' },
      h('div', { class: 'who' }, h('span', { class: avatarClass(retailer.store_name) }, initials(retailer.store_name)),
        h('div', {}, h('h2', {}, retailer.store_name), h('p', { class: 'muted' }, `${retailer.owner} · ${retailer.area}`))),
      h('div', { class: 'hero-meta' }, outcomePill(summary.outcome), h('span', { class: `sentiment ${summary.sentiment}` }, `${sentence(summary.sentiment)} mood`),
        h('span', { class: 'muted' }, `${formatDateTime(interaction.startedAt)} · ${formatDuration(interaction.durationSeconds)}`)),
      h('p', { class: 'overview' }, summary.overview),
      h('div', { class: 'next-action' }, icon('bulb'), h('div', {}, h('strong', {}, 'Next action'), h('span', {}, summary.next_action))),
      actions),
    h('section', { class: 'card' }, h('h3', {}, 'Order enquiry'),
      // Interactions saved before pricing existed have no quote: fall back to the product list.
      quote ? quoteBreakdown(quote) : listOrNone(summary.products, (p) => `${qty(p.quantity, p.unit)} · ${p.name}`)),
    h('section', { class: 'card' },
      h('dl', { class: 'kv' },
        h('dt', {}, 'Follow-ups'), h('dd', {}, listOrNone(summary.followups, (f) => `${sentence(f.type)} · ${f.when}: ${f.details}`)),
        h('dt', {}, 'Schemes discussed'), h('dd', {}, listOrNone(summary.schemes_discussed, (s) => `${s.name}${s.status === 'expired' ? ' (expired)' : ''}`)),
        h('dt', {}, 'Written by'), h('dd', {}, summary.generated_by === 'llm' ? `LLM (${interaction.llm})` : 'Rule-based fallback')),
      h('details', {}, h('summary', {}, 'Summary JSON (saved to the CRM)'), h('pre', {}, JSON.stringify(summary, null, 2)))),
  );
  if (!withTranscript) return card;

  const transcript = h('section', { class: 'card' },
    h('h3', {}, 'Transcript'),
    h('ol', { class: 'transcript full' }, interaction.transcript.map((t) =>
      h('li', { class: `msg ${t.role}` },
        t.role === 'agent' ? h('span', { class: 'avatar agent-avatar sm', 'aria-hidden': 'true' }, 'A') : null,
        h('div', { class: 'bubble' },
          h('span', { class: 'msg-text' }, t.text),
          h('span', { class: 'msg-meta' }, t.at ? formatTime(t.at) : '', t.latencyMs !== undefined ? ` · ${formatLatency(t.latencyMs)}` : ''),
          t.tools?.length ? h('span', { class: 'tool-chips' }, t.tools.map((n) => h('span', { class: 'tool-chip' }, icon('tool'), toolLabel(n)))) : null)))));
  return h('div', {}, card, transcript);
}

// ---------- catalogue ----------

const STOCK = {
  in_stock: { label: 'In stock', icon: 'check' },
  low_stock: { label: 'Low stock', icon: 'alert' },
  out_of_stock: { label: 'Out of stock', icon: 'x' },
};

export function renderCatalog(container, products) {
  const categories = [...new Set(products.map((p) => p.category))];
  const filter = { category: 'all', query: '' };
  const grid = h('div', { class: 'product-grid' });

  const card = (p) =>
    h('article', { class: 'card product' },
      h('header', {}, h('span', { class: `cat-tag` }, p.category), h('span', { class: `stock ${p.stock_status}` }, icon(STOCK[p.stock_status].icon), STOCK[p.stock_status].label)),
      h('h3', {}, p.name), h('p', { class: 'muted' }, `${p.pack_size} · ${p.sku}`),
      h('div', { class: 'price-row' },
        h('div', {}, h('span', { class: 'price' }, rupees(p.retailer_price)), h('small', { class: 'muted' }, ` / unit · MRP ${rupees(p.mrp)}`)),
        h('span', { class: 'margin' }, `${p.margin_percent}% margin`)),
      h('p', { class: 'muted small' }, `Case of ${p.case_size} · ${rupees(p.case_price)} · ${plural(p.cases_available, 'case')} available`),
      p.active_schemes.length
        ? h('ul', { class: 'scheme-tags' }, p.active_schemes.map((s) => h('li', { title: s.description }, icon('tag'), s.name)))
        : null);

  function update() {
    chips.querySelectorAll('.chip').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.key === filter.category)));
    const matches = products.filter((p) =>
      (filter.category === 'all' || p.category === filter.category) &&
      (!filter.query || `${p.name} ${p.brand} ${p.sku} ${p.category}`.toLowerCase().includes(filter.query)));
    grid.replaceChildren(...matches.map(card));
  }

  const chips = h('div', { class: 'chip-row' }, ['all', ...categories].map((c) =>
    h('button', { class: 'chip', 'data-key': c, onclick: () => { filter.category = c; update(); } }, c === 'all' ? 'All' : sentence(c))));
  update();
  container.replaceChildren(
    h('div', { class: 'toolbar' },
      h('input', { type: 'search', class: 'search', placeholder: 'Search products...', 'aria-label': 'Search products', oninput: (e) => { filter.query = e.target.value.toLowerCase().trim(); update(); } })),
    chips, grid);
}
