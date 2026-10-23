'use strict';

const M = require('../model');

// Squarespace reader. One row per variant: the first row is the product plus its
// first variant, following rows repeat the product identity with a new Variant ID
// and their own SKU, price and stock. Option pairs are Option Name/Value 1..3.
// Column matching is by header name (Squarespace instructs users to preserve its
// template structure; the exact tail column order could not be verified from
// official text and is documented in the README known-unknowns).

function detect(headers) {
  return headers.some((h) => h.startsWith('Product ID')) || headers.includes('Variant ID [Non Editable]');
}

function read(table, ctx) {
  const rep = ctx.report;
  const unit = ctx.options.sourceWeightUnit || 'lb';
  M.repTransform(rep, `Squarespace weights are bare numbers in the store unit. Assumed source weight unit: ${unit}.`);
  const products = [];
  let current = null;
  let currentKey = null;

  for (const row of table.rows) {
    const title = row['Title'] || '';
    const url = row['Product URL'] || '';
    const key = url || title;
    if (!key) continue;
    if (!current || key !== currentKey) {
      current = M.emptyProduct();
      current.title = title;
      current.handle = url ? url.split('/').filter(Boolean).pop() : M.slugify(title);
      current.descriptionHtml = row['Description'] || '';
      current.descriptionText = M.stripHtml(current.descriptionHtml);
      current.tags = M.splitList(row['Tags'] || '');
      current.categoryPaths = M.splitList(row['Categories'] || '');
      current.published = String(row['Visible'] || 'true').toLowerCase() !== 'false';
      current.status = 'active';
      for (let n = 1; n <= 3; n++) {
        const name = row[`Option Name ${n}`];
        if (name) current.options.push({ name, values: [] });
      }
      currentKey = key;
      products.push(current);
    }
    const v = M.emptyVariant();
    v.sku = row['SKU'] || '';
    const price = M.parseNumber(row['Price']);
    const salePrice = M.parseNumber(row['Sale Price']);
    const onSale = String(row['On Sale'] || '').toLowerCase() === 'true' || String(row['On Sale'] || '').toLowerCase() === 'yes';
    if (onSale && salePrice !== null && price !== null) { v.regular = price; v.sale = salePrice; v.compareAt = price; }
    else { v.regular = price; }
    const unlimited = String(row['Unlimited'] || '').toLowerCase() === 'true';
    v.quantity = unlimited ? null : M.parseIntOrNull(row['Stock']);
    v.trackInventory = !unlimited;
    const w = M.parseNumber(row['Weight']);
    if (w !== null) v.weight = { value: w, unit };
    const ov = {};
    for (let n = 1; n <= 3; n++) {
      const name = row[`Option Name ${n}`];
      const val = row[`Option Value ${n}`];
      if (name && val) {
        ov[name] = val;
        const opt = current.options.find((o) => o.name === name);
        if (opt && !opt.values.includes(val)) opt.values.push(val);
      }
    }
    v.optionValues = ov;
    const img = row['Hosted Image URL'];
    if (img && !current.images.some((i) => i.url === img)) {
      current.images.push({ url: img, alt: '', position: current.images.length + 1 });
    }
    current.variants.push(v);
  }
  M.repNote(rep, 'Squarespace marks Hosted Image URL as not editable via CSV, and imported products do not get a featured or variant image set from the file. Image URLs are carried, but expect to set featured images manually in Squarespace after import.');
  M.repNote(rep, 'Squarespace product CSV has no brand, SEO title or SEO description columns, so none can come from a Squarespace export.');
  return products;
}

module.exports = { id: 'squarespace', name: 'Squarespace', detect, read };
