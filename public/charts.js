// Small dependency-free charts built from HTML, styled in styles.css (.viz-*).
// Every chart gets a hover/focus tooltip and a "View data" table, so values are
// never carried by colour or bar length alone.
import { h } from './ui.js';

let tooltipEl = null;
function tooltip() {
  tooltipEl ||= document.body.appendChild(h('div', { class: 'viz-tooltip', role: 'tooltip', hidden: true }));
  return tooltipEl;
}

/** Show `lines` (title first) next to `target` on hover and keyboard focus. */
function withTooltip(target, lines) {
  const show = () => {
    const tip = tooltip();
    tip.replaceChildren(h('strong', {}, lines[0]), ...lines.slice(1).map((l) => h('span', {}, l)));
    tip.hidden = false;
    const box = target.getBoundingClientRect();
    const left = Math.min(Math.max(8, box.left + box.width / 2 - tip.offsetWidth / 2), window.innerWidth - tip.offsetWidth - 8);
    const top = box.top - tip.offsetHeight - 8;
    tip.style.left = `${left + window.scrollX}px`;
    tip.style.top = `${(top < 8 ? box.bottom + 8 : top) + window.scrollY}px`;
  };
  const hide = () => (tooltip().hidden = true);
  target.tabIndex = 0;
  target.setAttribute('aria-label', lines.join(', '));
  target.addEventListener('mouseenter', show);
  target.addEventListener('focus', show);
  target.addEventListener('mouseleave', hide);
  target.addEventListener('blur', hide);
  return target;
}

export function dataTable(headers, rows) {
  return h(
    'details',
    { class: 'viz-data' },
    h('summary', {}, 'View data'),
    h('table', {}, h('thead', {}, h('tr', {}, headers.map((c) => h('th', {}, c)))),
      h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c)))))),
  );
}

/** Horizontal bars, one series. rows: [{ label, value, display, detail }] */
export function barList(rows) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return h(
    'div',
    { class: 'viz-bars' },
    rows.map((r) =>
      h(
        'div',
        { class: 'viz-bar-row' },
        h('span', { class: 'viz-bar-label', title: r.label }, r.label),
        withTooltip(
          h('span', { class: 'viz-bar-track' },
            h('span', { class: 'viz-bar', style: { width: `calc((100% - 4.5rem) * ${Math.max(r.value / max, 0.01)})` } }),
            h('span', { class: 'viz-bar-value' }, r.display)),
          [r.label, r.display, r.detail].filter(Boolean),
        ),
      ),
    ),
  );
}

/** Vertical columns over time, one series. points: [{ label, value, display, detail }] */
export function columnChart(points) {
  const max = Math.max(...points.map((p) => p.value), 1);
  const peak = points.findIndex((p) => p.value === max);
  return h(
    'div',
    { class: 'viz-columns', style: { '--cols': points.length } },
    points.map((p, i) =>
      withTooltip(
        h(
          'div',
          { class: 'viz-col' },
          h('span', { class: 'viz-col-plot' },
            // Label selectively: only the peak and the latest value sit on their caps.
            (i === peak || i === points.length - 1) && p.value > 0 ? h('span', { class: 'viz-col-value' }, p.display) : null,
            h('span', { class: 'viz-col-bar', style: { height: `calc((100% - 1.4rem) * ${p.value / max})` } })),
          h('span', { class: 'viz-col-label' }, p.label),
        ),
        [p.label, p.display, p.detail].filter(Boolean),
      ),
    ),
  );
}

/** A 100% stacked bar with a legend that carries labels and counts. segments: [{ label, value, slot }] */
export function stackedBar(segments) {
  const total = segments.reduce((sum, s) => sum + s.value, 0) || 1;
  const pct = (v) => `${Math.round((v / total) * 100)}%`;
  const shown = segments.filter((s) => s.value > 0);
  return h(
    'div',
    { class: 'viz-stack-wrap' },
    h('div', { class: 'viz-stack' },
      shown.map((s) =>
        withTooltip(h('span', { class: `viz-seg s${s.slot}`, style: { flexGrow: s.value } }), [s.label, `${s.value} calls`, pct(s.value)]))),
    h('ul', { class: 'viz-legend' },
      segments.map((s) =>
        h('li', {}, h('span', { class: `viz-swatch s${s.slot}` }), h('span', {}, s.label), h('strong', {}, `${s.value}`), h('small', {}, pct(s.value))))),
  );
}
