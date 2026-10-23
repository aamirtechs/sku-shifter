'use strict';

// Canonical product model helpers, price and weight transforms, and the conversion report.
// Canonical price is a triple: regular, sale, compareAt (any may be null).
// Canonical weight is { value, unit } with unit in g, kg, lb, oz. Never a bare number.

function emptyProduct() {
  return {
    title: '', handle: '', descriptionHtml: '', descriptionText: '',
    vendor: '', typeFree: '', categoryPaths: [], tags: [],
    status: 'active', published: true,
    seoTitle: '', seoDescription: '',
    images: [], options: [], variants: [], extras: {},
  };
}

function emptyVariant() {
  return {
    optionValues: {}, regular: null, sale: null, compareAt: null, cost: null,
    sku: '', barcodes: [], quantity: null, trackInventory: false,
    continueSelling: false, weight: null, imageUrl: '',
  };
}

function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function parseNumber(v) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v).trim().replace(/[$£€\s]/g, '').replace(/,(?=\d{3}(\D|$))/g, '');
  const n = parseFloat(cleaned.replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

function parseIntOrNull(v) {
  const n = parseNumber(v);
  return n === null ? null : Math.trunc(n);
}

function fmtPrice(n) {
  if (n === null || n === undefined) return '';
  return Number(n).toFixed(2);
}

function fmtNumber(n) {
  if (n === null || n === undefined) return '';
  return String(parseFloat(Number(n).toFixed(4)));
}

// The selling price of a canonical variant.
function sellingPrice(v) {
  if (v.sale !== null && v.sale !== undefined) return v.sale;
  if (v.regular !== null && v.regular !== undefined) return v.regular;
  return null;
}

// Price pair for regular-plus-sale platforms (WooCommerce, Wix strikethrough logic, GMC).
// If a compareAt above the selling price exists with no explicit sale, it becomes
// the regular price and the current price becomes the sale price. Selling price never changes.
function regularSalePair(v) {
  let regular = v.regular;
  let sale = v.sale;
  if ((sale === null || sale === undefined) && v.compareAt !== null && v.compareAt !== undefined) {
    const sell = sellingPrice(v);
    if (sell !== null && v.compareAt > sell) { regular = v.compareAt; sale = sell; }
  }
  return { regular, sale };
}

const WEIGHT_TO_GRAMS = { g: 1, kg: 1000, lb: 453.59237, oz: 28.349523125 };

function toGrams(value, unit) {
  if (value === null || value === undefined) return null;
  const f = WEIGHT_TO_GRAMS[String(unit || 'g').toLowerCase()];
  return f ? value * f : null;
}

function fromGrams(grams, unit) {
  const f = WEIGHT_TO_GRAMS[String(unit || 'g').toLowerCase()];
  return f ? grams / f : null;
}

function convertWeight(weight, targetUnit) {
  if (!weight) return null;
  const grams = toGrams(weight.value, weight.unit);
  if (grams === null) return null;
  return { value: fromGrams(grams, targetUnit), unit: targetUnit, grams };
}

const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&apos;': "'", '&nbsp;': ' ' };

function stripHtml(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<\s*br\s*\/?>/gi, '\n');
  s = s.replace(/<\/\s*(p|div|li|tr|h[1-6])\s*>/gi, '\n');
  s = s.replace(/<[^>]*>/g, '');
  s = s.replace(/&[a-z#0-9]+;/gi, (m) => (ENTITIES[m] !== undefined ? ENTITIES[m] : m));
  return s.replace(/\n{3,}/g, '\n\n').trim();
}

function textToHtml(text) {
  if (!text) return '';
  const esc = String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return esc.split(/\n{2,}/).map((p) => '<p>' + p.replace(/\n/g, '<br>') + '</p>').join('\n');
}

function splitList(cell, separator = ',') {
  if (!cell) return [];
  return String(cell).split(separator).map((x) => x.trim()).filter(Boolean);
}

// Split on commas that are not backslash-escaped (WooCommerce category lists), then unescape.
function splitEscapedCommas(cell) {
  if (!cell) return [];
  const out = [];
  let cur = '';
  const s = String(cell);
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '\\' && s[i + 1] === ',') { cur += ','; i++; continue; }
    if (s[i] === ',') { out.push(cur); cur = ''; continue; }
    cur += s[i];
  }
  out.push(cur);
  return out.map((x) => x.trim()).filter(Boolean);
}

function escapeCommas(value) {
  return String(value).replace(/,/g, '\\,');
}

// ---- Conversion report ----
function createReport(from, to) {
  return {
    from, to, products: 0, variants: 0, images: 0, rowsWritten: 0,
    warnings: [], dropped: [], transforms: [], notes: [],
  };
}
function repOnce(list, msg) { if (!list.includes(msg)) list.push(msg); }
function repWarn(rep, msg) { repOnce(rep.warnings, msg); }
function repTransform(rep, msg) { repOnce(rep.transforms, msg); }
function repNote(rep, msg) { repOnce(rep.notes, msg); }
function repDrop(rep, product, field, reason) {
  rep.dropped.push({ product: product || '(unknown product)', field, reason });
}

function renderReport(rep) {
  const lines = [];
  lines.push('# Conversion report');
  lines.push('');
  lines.push(`- Source format: ${rep.from}`);
  lines.push(`- Target format: ${rep.to}`);
  lines.push(`- Products converted: ${rep.products}`);
  lines.push(`- Variants converted: ${rep.variants}`);
  lines.push(`- Images carried: ${rep.images}`);
  lines.push(`- Rows written: ${rep.rowsWritten}`);
  lines.push('');
  if (rep.transforms.length) {
    lines.push('## Transforms applied');
    rep.transforms.forEach((t) => lines.push(`- ${t}`));
    lines.push('');
  }
  if (rep.warnings.length) {
    lines.push('## Warnings');
    rep.warnings.forEach((t) => lines.push(`- ${t}`));
    lines.push('');
  }
  if (rep.dropped.length) {
    lines.push('## Fields dropped (nothing is dropped silently)');
    rep.dropped.forEach((d) => lines.push(`- ${d.product}: ${d.field} dropped. ${d.reason}`));
    lines.push('');
  }
  if (rep.notes.length) {
    lines.push('## Notes');
    rep.notes.forEach((t) => lines.push(`- ${t}`));
    lines.push('');
  }
  lines.push('Prices are copied as numbers in the source store currency and tax setting. Image entries are URLs or file references carried from the source file; this tool never downloads, re-hosts, or uploads images.');
  return lines.join('\n') + '\n';
}

module.exports = {
  emptyProduct, emptyVariant, slugify, parseNumber, parseIntOrNull, fmtPrice, fmtNumber,
  sellingPrice, regularSalePair, WEIGHT_TO_GRAMS, toGrams, fromGrams, convertWeight,
  stripHtml, textToHtml, splitList, splitEscapedCommas, escapeCommas,
  createReport, repWarn, repTransform, repNote, repDrop, renderReport,
};
