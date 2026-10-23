'use strict';

const M = require('../model');

// Shopify reader. Accepts current headers (URL handle, Description, Price, Barcodes,
// Product image URL) and legacy headers (Handle, Body (HTML), Variant Price, Barcode,
// Image Src). Variants are extra rows sharing the URL handle; image-only rows carry
// only a handle, an image URL, a position and alt text. Weight is integer grams.

function get(row, names) {
  for (const n of names) {
    if (row[n] !== undefined && row[n] !== '') return row[n];
  }
  return '';
}

function has(row, names) { return get(row, names) !== ''; }

function detect(headers) {
  return headers.includes('URL handle') || headers.includes('Handle') ||
    (headers.includes('Title') && (headers.includes('Variant Price') || headers.includes('Option1 value')));
}

function read(table, ctx) {
  const rep = ctx.report;
  const products = [];
  let current = null;
  let optionNames = [];

  const finishOptionSetup = () => {
    if (!current) return;
    const real = optionNames.filter((n) => n && n !== 'Title');
    current.options = real.map((name) => ({ name, values: [] }));
    for (const v of current.variants) {
      current.options.forEach((opt, i) => {
        const val = v.__optVals ? v.__optVals[i] : '';
        if (val && !opt.values.includes(val)) opt.values.push(val);
      });
    }
    for (const v of current.variants) {
      const ov = {};
      current.options.forEach((opt, i) => { if (v.__optVals && v.__optVals[i]) ov[opt.name] = v.__optVals[i]; });
      v.optionValues = ov;
      delete v.__optVals;
    }
    // Legacy "Default Title" pseudo-option means a simple product.
    if (current.options.length === 0) {
      for (const v of current.variants) v.optionValues = {};
    }
  };

  for (const row of table.rows) {
    const handle = get(row, ['URL handle', 'Handle']);
    const title = get(row, ['Title']);
    const isVariantRow = has(row, ['Option1 value', 'Option2 value', 'Option3 value', 'SKU']) || has(row, ['Price', 'Variant Price']);
    const imageUrl = get(row, ['Product image URL', 'Image Src']);

    if (title) {
      if (current) finishOptionSetup();
      current = M.emptyProduct();
      optionNames = [get(row, ['Option1 name']), get(row, ['Option2 name']), get(row, ['Option3 name'])];
      current.title = title;
      current.handle = handle || M.slugify(title);
      current.descriptionHtml = get(row, ['Description', 'Body (HTML)']);
      current.descriptionText = M.stripHtml(current.descriptionHtml);
      current.vendor = get(row, ['Vendor']);
      current.typeFree = get(row, ['Type']);
      const cat = get(row, ['Product category']);
      if (cat) {
        current.categoryPaths = [cat];
        M.repTransform(rep, 'Shopify "Product category" (Shopify standard taxonomy) carried as a category path. Targets without that taxonomy treat it as a plain category name.');
      }
      current.tags = M.splitList(get(row, ['Tags']));
      const status = get(row, ['Status']).toLowerCase();
      current.status = ['draft', 'archived'].includes(status) ? status : 'active';
      current.published = get(row, ['Published on online store']).toLowerCase() !== 'false';
      current.seoTitle = get(row, ['SEO title']);
      current.seoDescription = get(row, ['SEO description']);
      products.push(current);
    }

    if (!current) {
      if (imageUrl || isVariantRow) M.repWarn(rep, `Row ${row.__record}: variant or image row with no preceding product row was skipped.`);
      continue;
    }
    if (handle && current.handle && handle !== current.handle && !title) {
      M.repWarn(rep, `Row ${row.__record}: row handle "${handle}" does not match the current product "${current.handle}"; row attached to the current product. Check grouping in the source file.`);
    }

    if (isVariantRow) {
      const v = M.emptyVariant();
      v.__optVals = [get(row, ['Option1 value']), get(row, ['Option2 value']), get(row, ['Option3 value'])];
      const price = M.parseNumber(get(row, ['Price', 'Variant Price']));
      const compareAt = M.parseNumber(get(row, ['Compare-at price', 'Variant Compare At Price']));
      if (compareAt !== null && price !== null && compareAt > price) { v.regular = compareAt; v.sale = price; }
      else { v.regular = price; }
      v.compareAt = compareAt;
      v.cost = M.parseNumber(get(row, ['Cost per item']));
      v.sku = get(row, ['SKU']);
      const bc = get(row, ['Barcodes', 'Barcode', 'Variant Barcode']);
      if (bc) v.barcodes = bc.split(';').map((x) => { const t = x.trim(); const c = t.indexOf(':'); return c > 0 ? t.slice(c + 1) : t; }).filter(Boolean);
      const qtyRaw = get(row, ['Inventory quantity']);
      v.quantity = qtyRaw === '' ? null : M.parseIntOrNull(qtyRaw);
      v.trackInventory = get(row, ['Inventory tracker']) !== '';
      v.continueSelling = get(row, ['Continue selling when out of stock']).toLowerCase() === 'continue';
      const grams = M.parseNumber(get(row, ['Weight value (grams)', 'Variant Grams']));
      if (grams !== null) v.weight = { value: grams, unit: 'g' };
      v.imageUrl = get(row, ['Variant image URL', 'Variant Image']);
      current.variants.push(v);
      if (imageUrl) current.images.push({ url: imageUrl, alt: get(row, ['Image alt text']), position: M.parseIntOrNull(get(row, ['Image position'])) || current.images.length + 1 });
    } else if (imageUrl) {
      current.images.push({ url: imageUrl, alt: get(row, ['Image alt text']), position: M.parseIntOrNull(get(row, ['Image position'])) || current.images.length + 1 });
    }
  }
  if (current) finishOptionSetup();
  M.repNote(rep, 'Shopify inventory in a product CSV is single-location only. Multi-location stock cannot be carried by this file format.');
  return products;
}

module.exports = { id: 'shopify', name: 'Shopify', detect, read };
