'use strict';

const M = require('../model');

// BigCommerce reader, both generations.
// Modern: typed rows under a product row (Item = Product, Variant, Image, Video).
// Legacy: Item Type = Product, SKU (variant stock and dimensions), Rule (variant
// price, weight, image adjustments merged per variant in order).
// Modern categories are numeric IDs and brand is a numeric Brand ID, so names
// cannot be recovered from a Modern file: they are reported, never invented.
// The Modern Options cell is an encoded name/value string per BigCommerce's
// complex-attributes format; the exact encoding could not be verified from
// official text, so parsing is tolerant and the raw value is kept on failure.

function detect(headers) {
  return headers.includes('Item Type') || (headers.includes('Item') && headers.includes('SKU') && headers.includes('Name'));
}

function parseOptionsCell(cell) {
  if (!cell) return {};
  const ov = {};
  const parts = String(cell).split('|');
  for (const part of parts) {
    const t = part.trim();
    if (!t) continue;
    const eq = t.indexOf('=');
    const colon = t.indexOf(':');
    const idx = eq > 0 ? eq : colon;
    if (idx > 0) ov[t.slice(0, idx).trim()] = t.slice(idx + 1).trim();
  }
  return ov;
}

function read(table, ctx) {
  const generation = table.headers.includes('Item Type') ? 'legacy' : 'modern';
  return generation === 'legacy' ? readLegacy(table, ctx) : readModern(table, ctx);
}

function fillPrices(row, v, names = {}) {
  const price = M.parseNumber(row[names.price || 'Price']);
  const sale = M.parseNumber(row[names.sale || 'Sale Price']);
  const retail = M.parseNumber(row[names.retail || 'Retail Price']);
  v.regular = price;
  v.sale = sale;
  v.compareAt = retail;
  v.cost = M.parseNumber(row[names.cost || 'Cost Price']);
}

function readModern(table, ctx) {
  const rep = ctx.report;
  const unit = ctx.options.sourceWeightUnit || 'kg';
  const products = [];
  let current = null;
  for (const row of table.rows) {
    const item = row['Item'];
    if (item === 'Product') {
      current = M.emptyProduct();
      current.title = row['Name'] || '';
      current.handle = row['Product URL'] ? row['Product URL'].split('/').filter(Boolean).pop() : M.slugify(current.title);
      current.descriptionHtml = row['Description'] || '';
      current.descriptionText = M.stripHtml(current.descriptionHtml);
      current.published = String(row['Is Visible'] || 'TRUE').toUpperCase() !== 'FALSE';
      current.status = 'active';
      current.seoTitle = row['Page Title'] || '';
      current.seoDescription = row['Meta Description'] || '';
      if (row['Search Keywords']) current.tags = M.splitList(row['Search Keywords']);
      if (row['Brand ID']) {
        current.extras.brandId = row['Brand ID'];
        M.repDrop(rep, current.title, 'brand name', 'BigCommerce Modern files carry a numeric Brand ID only. The brand name cannot be recovered from the file.');
      }
      if (row['Categories']) {
        current.extras.categoryIds = row['Categories'];
        M.repDrop(rep, current.title, 'category names', 'BigCommerce Modern files carry numeric category IDs only. Category names cannot be recovered from the file; map IDs in your BigCommerce dashboard.');
      }
      const v = M.emptyVariant();
      fillPrices(row, v);
      v.sku = row['SKU'] || '';
      if (row['UPC/EAN']) v.barcodes = [row['UPC/EAN'].trim()];
      else if (row['Global Trade Number']) v.barcodes = [row['Global Trade Number'].trim()];
      v.quantity = M.parseIntOrNull(row['Current Stock']);
      v.trackInventory = (row['Inventory Tracking'] || 'none') !== 'none';
      const w = M.parseNumber(row['Weight']);
      if (w !== null) v.weight = { value: w, unit };
      v.imageUrl = row['Variant Image URL'] || '';
      current.__productVariant = v;
      products.push(current);
    } else if (item === 'Variant') {
      if (!current) { M.repWarn(rep, `Row ${row.__record}: Variant row with no preceding Product row was skipped.`); continue; }
      const v = M.emptyVariant();
      fillPrices(row, v);
      v.sku = row['SKU'] || '';
      if (row['UPC/EAN']) v.barcodes = [row['UPC/EAN'].trim()];
      else if (row['Global Trade Number']) v.barcodes = [row['Global Trade Number'].trim()];
      v.quantity = M.parseIntOrNull(row['Current Stock']);
      v.trackInventory = true;
      const w = M.parseNumber(row['Weight']);
      if (w !== null) v.weight = { value: w, unit };
      v.imageUrl = row['Variant Image URL'] || '';
      v.optionValues = parseOptionsCell(row['Options']);
      if (!Object.keys(v.optionValues).length && row['Options']) {
        v.extras = { rawOptions: row['Options'] };
        M.repWarn(rep, `"${current.title}": the BigCommerce Options cell "${row['Options']}" could not be parsed into name and value pairs and was kept raw. Check this variant's options after import.`);
      }
      current.variants.push(v);
    } else if (item === 'Image') {
      if (!current) { M.repWarn(rep, `Row ${row.__record}: Image row with no preceding Product row was skipped.`); continue; }
      const url = row['Image URL (Import)'] || row['Internal Image URL (Export)'] || '';
      if (url) {
        current.images.push({ url, alt: row['Image Description'] || '', position: M.parseIntOrNull(row['Image Sort Order']) || current.images.length + 1 });
        if (!row['Image URL (Import)'] && row['Internal Image URL (Export)']) {
          M.repTransform(rep, 'BigCommerce export image column "Internal Image URL (Export)" was carried as the image URL. BigCommerce import expects "Image URL (Import)"; writers here emit the import form.');
        }
      }
    }
  }
  for (const p of products) {
    const pv = p.__productVariant;
    delete p.__productVariant;
    if (p.variants.length === 0) { pv.optionValues = {}; p.variants = [pv]; }
    else if (pv && pv.sku) { pv.optionValues = pv.optionValues || {}; p.variants.unshift(pv); }
    const names = new Set();
    for (const v of p.variants) Object.keys(v.optionValues || {}).forEach((k) => names.add(k));
    p.options = [...names].map((name) => ({ name, values: [...new Set(p.variants.map((v) => (v.optionValues || {})[name]).filter(Boolean))] }));
  }
  M.repTransform(rep, `BigCommerce weights are bare numbers in the store unit. Assumed source weight unit: ${unit}.`);
  return products;
}

function readLegacy(table, ctx) {
  const rep = ctx.report;
  const unit = ctx.options.sourceWeightUnit || 'kg';
  const products = [];
  let current = null;
  for (const row of table.rows) {
    const itemType = row['Item Type'];
    if (itemType === 'Product') {
      current = M.emptyProduct();
      current.title = row['Product Name'] || '';
      current.handle = M.slugify(current.title);
      current.descriptionHtml = row['Description'] || '';
      current.descriptionText = M.stripHtml(current.descriptionHtml);
      current.vendor = row['Brand Name'] || row['Brand'] || '';
      current.categoryPaths = (row['Category String'] || '').split(';').map((x) => x.trim()).filter(Boolean);
      current.published = String(row['Product Visible'] || 'TRUE').toUpperCase() !== 'FALSE';
      current.status = 'active';
      current.seoTitle = row['Page Title'] || '';
      current.seoDescription = row['Meta Description'] || '';
      const v = M.emptyVariant();
      fillPrices(row, v);
      v.sku = row['Product Code/SKU'] || '';
      if (row['UPC']) v.barcodes = [row['UPC'].trim()];
      v.quantity = M.parseIntOrNull(row['Stock Level']);
      v.trackInventory = (row['Track Inventory'] || 'none') !== 'none';
      const w = M.parseNumber(row['Product Weight'] || row['Weight']);
      if (w !== null) v.weight = { value: w, unit };
      if (row['Product Image URL']) current.images.push({ url: row['Product Image URL'], alt: '', position: 1 });
      current.__productVariant = v;
      current.__legacyVariants = [];
      products.push(current);
    } else if (itemType === 'SKU') {
      if (!current) { M.repWarn(rep, `Row ${row.__record}: legacy SKU row with no preceding Product row was skipped.`); continue; }
      const v = M.emptyVariant();
      v.sku = row['Product Code/SKU'] || '';
      v.quantity = M.parseIntOrNull(row['Stock Level']);
      v.trackInventory = true;
      const w = M.parseNumber(row['Product Weight'] || row['Weight']);
      if (w !== null) v.weight = { value: w, unit };
      v.__optionText = row['Option'] || row['Options'] || '';
      current.__legacyVariants.push(v);
    } else if (itemType === 'Rule') {
      if (!current) { M.repWarn(rep, `Row ${row.__record}: legacy Rule row with no preceding Product row was skipped.`); continue; }
      const target = current.__legacyVariants[current.__legacyVariants.length - 1];
      if (target) {
        fillPrices(row, target);
        if (row['Product Image URL']) target.imageUrl = row['Product Image URL'];
        const w = M.parseNumber(row['Product Weight'] || row['Weight']);
        if (w !== null) target.weight = { value: w, unit };
      }
    }
  }
  for (const p of products) {
    const pv = p.__productVariant;
    const legacy = p.__legacyVariants || [];
    delete p.__productVariant; delete p.__legacyVariants;
    if (legacy.length) {
      for (const v of legacy) {
        v.optionValues = parseOptionsCell(v.__optionText || '');
        delete v.__optionText;
        p.variants.push(v);
      }
    } else { pv.optionValues = {}; p.variants = [pv]; }
    const names = new Set();
    for (const v of p.variants) Object.keys(v.optionValues || {}).forEach((k) => names.add(k));
    p.options = [...names].map((name) => ({ name, values: [...new Set(p.variants.map((v) => (v.optionValues || {})[name]).filter(Boolean))] }));
    if (legacy.length && !p.options.length) {
      M.repWarn(rep, `"${p.title}": legacy variant rows carried no parseable option text. Variants were imported with SKUs, prices and stock, but option names and values need a manual check.`);
    }
  }
  M.repNote(rep, 'BigCommerce Legacy file detected. Legacy variant data is split across SKU rows (stock, dimensions) and Rule rows (price, weight, image); the two were merged per variant in row order.');
  return products;
}

module.exports = { id: 'bigcommerce', name: 'BigCommerce', detect, read };
