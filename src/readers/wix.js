'use strict';

const M = require('../model');

// Wix Stores reader. Every row is fieldType PRODUCT, VARIANT or MEDIA (case sensitive),
// rows share the product handle. Options are productOptionName[N] groups (max 6):
// the PRODUCT row lists all choices semicolon-separated, each VARIANT row holds one
// choice. Descriptions are plain text (plainDescription). Inventory blank in a source
// file means OUT_OF_STOCK in Wix, which is why the writer never emits blank inventory.

function detect(headers) {
  return headers.includes('fieldType') && headers.includes('handle');
}

function optionCount(headers) {
  let max = 0;
  headers.forEach((h) => { const m = h.match(/^productOptionName\[(\d+)\]$/); if (m) max = Math.max(max, Number(m[1])); });
  return max;
}

function read(table, ctx) {
  const rep = ctx.report;
  const unit = ctx.options.sourceWeightUnit || 'kg';
  const optN = optionCount(table.headers);
  const products = [];
  let current = null;

  const cleanChoice = (c) => {
    const t = String(c || '').trim();
    // Swatch encoding looks like "#FFFFFF:White": the label after the colon is the value.
    if (/^#[0-9a-fA-F]{3,8}:/.test(t)) return t.slice(t.indexOf(':') + 1).trim();
    return t;
  };

  for (const row of table.rows) {
    const type = row['fieldType'];
    if (type === 'PRODUCT') {
      current = M.emptyProduct();
      current.title = row['name'] || '';
      current.handle = row['handle'] || M.slugify(current.title);
      current.descriptionText = row['plainDescription'] || '';
      current.descriptionHtml = M.textToHtml(current.descriptionText);
      current.vendor = row['brand'] || '';
      current.categoryPaths = (row['categorySlugs'] || '').split(';').map((x) => x.trim()).filter(Boolean);
      current.published = (row['visible'] || 'TRUE').toUpperCase() !== 'FALSE';
      current.status = 'active';
      current.extras.ribbon = row['ribbon'] || '';
      for (let n = 1; n <= optN; n++) {
        const name = row[`productOptionName[${n}]`];
        if (!name) continue;
        const choices = (row[`productOptionChoices[${n}]`] || '').split(';').map(cleanChoice).filter(Boolean);
        current.options.push({ name, values: choices });
      }
      const v = variantFromRow(row, current, optN, cleanChoice, unit);
      current.__productRowVariant = v;
      products.push(current);
    } else if (type === 'VARIANT') {
      if (!current) { M.repWarn(rep, `Row ${row.__record}: VARIANT row with no preceding PRODUCT row was skipped.`); continue; }
      current.variants.push(variantFromRow(row, current, optN, cleanChoice, unit));
    } else if (type === 'MEDIA') {
      if (!current) { M.repWarn(rep, `Row ${row.__record}: MEDIA row with no preceding PRODUCT row was skipped.`); continue; }
      const url = row['media'];
      if (url) current.images.push({ url, alt: row['mediaAltText'] || '', position: current.images.length + 1 });
    }
  }

  for (const p of products) {
    const pv = p.__productRowVariant;
    delete p.__productRowVariant;
    if (p.variants.length === 0 && pv) {
      // Simple product: the PRODUCT row itself carries price, stock and SKU.
      pv.optionValues = {};
      p.variants = [pv];
    } else if (pv && (pv.sku || pv.regular !== null)) {
      // PRODUCT row values describe the first variant in Wix exports only when no
      // explicit VARIANT rows exist; with VARIANT rows present the PRODUCT row
      // values are catalogue-level and are not a separate variant.
    }
  }
  M.repTransform(rep, `Wix weights are bare numbers in the store unit. Assumed source weight unit: ${unit}.`);
  M.repNote(rep, 'Wix product CSV has no tags and no SEO title or description columns, so neither can come from a Wix export.');
  return products;
}

function variantFromRow(row, product, optN, cleanChoice, unit) {
  const v = M.emptyVariant();
  const price = M.parseNumber(row['price']);
  const strike = M.parseNumber(row['strikethroughPrice']);
  if (strike !== null && price !== null && strike > price) { v.regular = strike; v.sale = price; v.compareAt = strike; }
  else { v.regular = price; }
  v.cost = M.parseNumber(row['cost']);
  v.sku = row['sku'] || '';
  if (row['barcode']) v.barcodes = [row['barcode'].trim()];
  const inv = (row['inventory'] || '').trim();
  if (/^-?\d+(\.\d+)?$/.test(inv)) { v.quantity = M.parseIntOrNull(inv); v.trackInventory = true; }
  else if (inv.toUpperCase() === 'IN_STOCK') { v.quantity = null; v.trackInventory = false; }
  else if (inv.toUpperCase() === 'OUT_OF_STOCK' || inv === '') { v.quantity = 0; v.trackInventory = true; }
  const w = M.parseNumber(row['weight']);
  if (w !== null) v.weight = { value: w, unit };
  const ov = {};
  for (let n = 1; n <= optN; n++) {
    const name = product.options[n - 1] ? product.options[n - 1].name : '';
    const choice = cleanChoice(row[`productOptionChoices[${n}]`] || '');
    if (name && choice) ov[name] = choice;
  }
  v.optionValues = ov;
  if (row['media']) v.imageUrl = row['media'];
  return v;
}

module.exports = { id: 'wix', name: 'Wix', detect, read };
