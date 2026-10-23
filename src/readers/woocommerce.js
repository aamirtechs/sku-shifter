'use strict';

const M = require('../model');

// WooCommerce reader. Same schema for import and export. Variable products are a
// Type=variable parent row plus Type=variation rows linked by Parent (parent SKU
// or id:NN). Parent row lists all attribute values; each variation holds one value
// per attribute. Images are one comma-separated cell (first = featured).
// Weight is a bare number in the store unit; the assumed unit is an explicit option
// (default kg) and is always declared in the conversion report.

function detect(headers) {
  return headers.includes('Type') && headers.includes('Name') &&
    (headers.includes('Regular price') || headers.includes('Attribute 1 name'));
}

function attrIndexes(headers) {
  const idx = [];
  headers.forEach((h) => {
    const m = h.match(/^Attribute (\d+) name$/);
    if (m) idx.push(Number(m[1]));
  });
  return idx.sort((a, b) => a - b);
}

function read(table, ctx) {
  const rep = ctx.report;
  const unit = ctx.options.sourceWeightUnit || 'kg';
  M.repTransform(rep, `WooCommerce weights are bare numbers in the store unit. Assumed source weight unit: ${unit}. Override with the source weight unit option if your store uses another unit.`);
  const attrs = attrIndexes(table.headers);
  const products = [];
  const byKey = new Map();

  const baseProduct = (row) => {
    const p = M.emptyProduct();
    p.title = row['Name'] || '';
    p.handle = M.slugify(p.title);
    p.descriptionHtml = row['Description'] || '';
    p.descriptionText = M.stripHtml(p.descriptionHtml);
    p.extras.shortDescription = row['Short description'] || '';
    p.extras.wooId = row['ID'] || '';
    p.extras.featured = row['Is featured?'] === '1';
    const pub = (row['Published'] || '1').trim();
    p.status = pub === '-1' ? 'draft' : (pub === '0' ? 'private' : 'active');
    p.published = pub === '1' || pub === 'true';
    if (row['Visibility in catalog']) p.extras.visibility = row['Visibility in catalog'];
    p.categoryPaths = M.splitEscapedCommas(row['Categories'] || '');
    p.tags = M.splitList(row['Tags'] || '');
    p.images = M.splitList(row['Images'] || '').map((url, i) => ({ url, alt: '', position: i + 1 }));
    return p;
  };

  const fillVariant = (row, v) => {
    v.sku = row['SKU'] || '';
    const gtin = row['GTIN, UPC, EAN, or ISBN'];
    if (gtin) v.barcodes = [gtin.trim()];
    v.regular = M.parseNumber(row['Regular price']);
    v.sale = M.parseNumber(row['Sale price']);
    if (row['Date sale price starts'] || row['Date sale price ends']) {
      v.extras = { saleFrom: row['Date sale price starts'] || '', saleTo: row['Date sale price ends'] || '' };
      M.repNote(rep, 'Sale price start and end dates are carried only to targets that support them (WooCommerce). Other targets receive the prices without the window.');
    }
    const stock = row['Stock'];
    v.quantity = stock === '' || stock === undefined ? null : M.parseIntOrNull(stock);
    v.trackInventory = v.quantity !== null;
    v.continueSelling = row['Backorders allowed?'] === '1' || row['Backorders allowed?'] === 'notify';
    const w = M.parseNumber(row['Weight (kg)'] || row['Weight (lb)'] || row['Weight (g)'] || row['Weight (oz)'] || row['Weight (unit)']);
    // (weight value read above via common unit headers; generic fallback below)
    const wAny = w !== null ? w : M.parseNumber(findWeight(row));
    if (wAny !== null) v.weight = { value: wAny, unit };
    const imgs = M.splitList(row['Images'] || '');
    if (imgs.length) v.imageUrl = imgs[0];
    return v;
  };

  function findWeight(row) {
    for (const k of Object.keys(row)) if (/^Weight \(/.test(k)) return row[k];
    return '';
  }

  const parents = [];
  const variations = [];
  for (const row of table.rows) {
    const type = (row['Type'] || 'simple').trim();
    if (type === 'variation') { variations.push(row); continue; }
    const p = baseProduct(row);
    if (type === 'variable') {
      p.options = attrs
        .map((n) => ({ name: row[`Attribute ${n} name`] || '', values: M.splitEscapedCommas(row[`Attribute ${n} value(s)`] || '') }))
        .filter((o) => o.name);
      p.__attrSlots = attrs;
      p.__parentSku = row['SKU'] || '';
      p.__firstRow = row;
      parents.push(p);
    } else {
      const v = fillVariant(row, M.emptyVariant());
      p.variants = [v];
      if (row['SKU']) byKey.set(row['SKU'], p);
    }
    if (row['ID']) byKey.set('id:' + row['ID'], p);
    if (row['SKU']) byKey.set(row['SKU'], p);
    products.push(p);
  }

  for (const p of parents) {
    // Parent row itself carries the parent-level stock and price fallback in some exports.
    const fallback = fillVariant(p.__firstRow, M.emptyVariant());
    p.__fallback = fallback;
    delete p.__firstRow;
  }

  for (const row of variations) {
    const parentRef = (row['Parent'] || '').trim();
    const parent = byKey.get(parentRef) || parents.find((p) => p.__parentSku && p.__parentSku === parentRef);
    if (!parent) {
      M.repWarn(rep, `Variation row (SKU ${row['SKU'] || 'unknown'}) references parent "${parentRef}" which was not found. Row skipped.`);
      continue;
    }
    const v = fillVariant(row, M.emptyVariant());
    const slots = parent.__attrSlots || attrs;
    const ov = {};
    slots.forEach((n) => {
      const name = row[`Attribute ${n} name`] || (parent.options[slots.indexOf(n)] || {}).name;
      const val = row[`Attribute ${n} value(s)`];
      if (name && val) ov[name] = val.trim();
    });
    v.optionValues = ov;
    if (v.regular === null && parent.__fallback) v.regular = parent.__fallback.regular;
    if (v.quantity === null && parent.__fallback) v.quantity = parent.__fallback.quantity;
    parent.variants.push(v);
  }

  for (const p of parents) { delete p.__attrSlots; delete p.__parentSku; delete p.__fallback; }
  M.repNote(rep, 'WooCommerce core CSV has no brand or vendor column and no SEO title or description columns (those belong to plugins). Vendor and SEO data cannot come from a WooCommerce core export.');
  return products;
}

module.exports = { id: 'woocommerce', name: 'WooCommerce', detect, read };
