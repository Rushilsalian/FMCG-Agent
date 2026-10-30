// Shared UI helpers: DOM builder, formatters, icons and toasts.

export const $ = (sel, root = document) => root.querySelector(sel);

// Tiny DOM builder. Uses textContent everywhere, so model/user text is never parsed as HTML.
export function h(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
    else if (key === 'style' && typeof value === 'object') {
      // setProperty so custom properties (--cols) work too; flexGrow -> flex-grow.
      for (const [prop, v] of Object.entries(value)) node.style.setProperty(prop.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`), v);
    }
    else if (value !== undefined && value !== false && value !== null) node.setAttribute(key, value === true ? '' : value);
  }
  for (const child of children.flat()) {
    if (child !== null && child !== undefined && child !== false) node.append(child instanceof Node ? child : String(child));
  }
  return node;
}

// Icons are fixed markup from this file (never user or model text), so parsing them is safe.
const ICON_PATHS = {
  phone: '<path d="M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2"/>',
  tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z"/>',
  bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-4 10.5c.7.7 1 1.5 1 2.5h6c0-1 .3-1.8 1-2.5A6 6 0 0 0 12 3z"/>',
  gift: '<path d="M20 12v9H4v-9M2 7h20v5H2zM12 21V7M12 7H7.5a2.5 2.5 0 1 1 0-5C11 2 12 7 12 7zM12 7h4.5a2.5 2.5 0 1 0 0-5C13 2 12 7 12 7z"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L2 12V2h10l8.6 8.6a2 2 0 0 1 0 2.8z"/><circle cx="7" cy="7" r="1.5"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  alert: '<path d="M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  copy: '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  print: '<path d="M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z"/>',
  history: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l4 2"/>',
  spark: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M5.6 5.6l2.8 2.8M15.6 15.6l2.8 2.8M5.6 18.4l2.8-2.8M15.6 8.4l2.8-2.8"/>',
};

export function icon(name, cls = 'icon') {
  const span = document.createElement('span');
  span.className = cls;
  span.setAttribute('aria-hidden', 'true');
  span.innerHTML = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</svg>`;
  return span;
}

// ---------- formatting ----------

export const rupees = (n) => `₹${Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
// ₹1.2L / ₹3.4K style for tiles and axis labels.
export function compactRupees(n) {
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1).replace(/\.0$/, '')}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1).replace(/\.0$/, '')}L`;
  if (n >= 1e3) return `₹${(n / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return rupees(n);
}
export const formatDateTime = (iso) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const formatTime = (iso) => new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' });
export const formatDuration = (s) => `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
// 1 case / 10 cases
export const qty = (n, unit) => `${n} ${n === 1 ? unit.replace(/s$/, '') : unit}`;
export const formatLatency = (ms) => (ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
export const plural = (n, word, many = word.replace(/([^aeiou])y$/, '$1ie') + 's') => `${n} ${n === 1 ? word : many}`;

export function timeAgo(iso) {
  const mins = Math.round((Date.now() - new Date(iso)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${plural(hours, 'hour')} ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}

// A stable colour per name (4 gradients), so a retailer looks the same on every screen.
export const avatarClass = (name) => `avatar a${[...name].reduce((sum, c) => sum + c.charCodeAt(0), 0) % 4}`;

export const initials = (name) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('');

export const OUTCOME_LABELS = {
  order_enquiry: 'Order enquiry',
  follow_up_required: 'Follow-up required',
  info_only: 'Info only',
  not_interested: 'Not interested',
};
export const outcomePill = (outcome) => h('span', { class: `pill ${outcome}` }, OUTCOME_LABELS[outcome]);
export const humanize = (s) => s.replace(/_/g, ' ');
// 'sales_visit' -> 'Sales visit'
export const sentence = (s) => humanize(s).replace(/^./, (c) => c.toUpperCase());

// ---------- toasts ----------

export function toast(message, kind = 'info') {
  const item = h('div', { class: `toast ${kind}`, role: kind === 'error' ? 'alert' : 'status' },
    icon(kind === 'error' ? 'alert' : 'check'), h('span', {}, message));
  $('#toasts').append(item);
  setTimeout(() => item.classList.add('leaving'), 3200);
  setTimeout(() => item.remove(), 3600);
}

export function downloadFile(name, content, type) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
