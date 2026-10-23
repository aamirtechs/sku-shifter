'use strict';

const M = require('../model');

// Google Merchant Center writer. Emits a tab-delimited feed with GMC attribute
// headers. GMC is a feed target, not a store: link and currency-coded price are
// merchant inputs and are never invented. If baseUrl or currency is missing the
// conversion stops with the blockers listed, instead of fabricating URLs.
// One row per variant, variants grouped by item_group_id (the product handle).
// Availability is derived from quantity: GMC has no quantity field.

const HEADERS = [
  'id', 'title', 'description', 'link', 'image_link', 'additional_image_link',
  'availability', 'price', 'sale_price', 'brand', 'gtin', 'mpn', 'identifier_exists',
  'condition', 'item_group_id', 'google_product_category', 'product_type',
  'color', 'size', 'product_weight',
];

function write(products, ctx) {
  const rep = ctx.report;
  const baseUrl = String(ctx.options.baseUrl || '').replace(/\/+$/, '');
  const currency = String(ctx.options.currency || '').toUpperCase();
  const blockers = [];
  if (!baseUrl) blockers.push('baseUrl: your store base URL (for example https://your-store.com) is required to build each product link. GMC rejects a feed without link.');
  if (!currency) blockers.push('currency: a 3-letter currency code (for example USD) is required because GMC prices must carry a currency, like "29.99 USD".');
  if (blockers.length) {
    const err = new Error('Google Merchant Center output needs merchant inputs that a product file does not contain:\n- ' + blockers.join('\n- '));
    err.blockers = blockers;
    throw err;
  }
  const hi = (name) => HEADERS.indexOf(name);
  const rows = [HEADERS];

  for (const p of products) {
    if (p.tags.length) M.repDrop(rep, p.title, 'tags', 'Google Merchant Center feeds have no tags attribute.');
    if (p.seoTitle || p.seoDescription) M.repDrop(rep, p.title, 'SEO title and description', 'Google Merchant Center uses the product title and description directly. There are no separate SEO fields.');
    const handle = p.handle || M.slugify(p.title);
    const variants = p.variants.length ? p.variants : [M.emptyVariant()];
    variants.forEach((v, vi) => {
      const row = new Array(HEADERS.length).fill('');
      const id = v.sku || (variants.length > 1 ? `${handle}-${vi + 1}` : handle);
      row[hi('id')] = id.slice(0, 50);
      let title = p.title;
      const optVals = Object.values(v.optionValues || {}).filter(Boolean);
      if (optVals.length) title += ' ' + optVals.join(' ');
      if (title.length > 150) { M.repWarn(rep, `"${p.title}": feed title truncated to 150 characters, the GMC maximum.`); title = title.slice(0, 150); }
      row[hi('title')] = title;
      let desc = p.descriptionText || M.stripHtml(p.descriptionHtml);
      if (desc.length > 5000) { M.repWarn(rep, `"${p.title}": description truncated to 5000 characters, the GMC maximum.`); desc = desc.slice(0, 5000); }
      row[hi('description')] = desc;
      row[hi('link')] = `${baseUrl}/${handle}`;
      const img = v.imageUrl || (p.images[0] && p.images[0].url) || '';
      if (!img) M.repWarn(rep, `"${p.title}" (${id}): no image. GMC requires image_link; this row will be rejected by Merchant Center until an image is added.`);
      row[hi('image_link')] = img;
      const extra = p.images.map((i) => i.url).filter((u) => u && u !== img).slice(0, 10);
      row[hi('additional_image_link')] = extra.join(',');
      row[hi('availability')] = v.quantity === null || v.quantity === undefined || v.quantity > 0 ? 'in_stock' : 'out_of_stock';
      const pair = M.regularSalePair(v);
      const sell = M.sellingPrice(v);
      const base = pair.sale !== null && pair.sale !== undefined ? pair.regular : sell;
      row[hi('price')] = base === null || base === undefined ? '' : `${M.fmtPrice(base)} ${currency}`;
      row[hi('sale_price')] = pair.sale !== null && pair.sale !== undefined ? `${M.fmtPrice(pair.sale)} ${currency}` : '';
      row[hi('brand')] = p.vendor || '';
      const codes = v.barcodes || [];
      const gtin = codes.find((c) => /^\d{8}$|^\d{12}$|^\d{13}$|^\d{14}$/.test(String(c).replace(/[\s-]/g, '')));
      if (gtin) row[hi('gtin')] = String(gtin).replace(/[\s-]/g, '');
      else if (codes.length) row[hi('mpn')] = codes[0];
      if (!gtin && !codes.length) {
        row[hi('identifier_exists')] = 'false';
        M.repNote(rep, `"${p.title}" (${id}): no GTIN, UPC or MPN in the source. identifier_exists was set to false, which is correct only for handmade or custom products without assigned identifiers.`);
      }
      row[hi('condition')] = p.extras.condition || 'new';
      if (variants.length > 1) row[hi('item_group_id')] = handle;
      if (p.extras.googleProductCategory) row[hi('google_product_category')] = p.extras.googleProductCategory;
      row[hi('product_type')] = p.typeFree || p.categoryPaths[0] || '';
      for (const [k, val] of Object.entries(v.optionValues || {})) {
        if (/^colou?r$/i.test(k)) row[hi('color')] = val;
        if (/^size$/i.test(k)) row[hi('size')] = val;
      }
      if (v.weight) row[hi('product_weight')] = `${M.fmtNumber(v.weight.value)} ${v.weight.unit}`;
      rows.push(row);
    });
  }
  M.repNote(rep, 'GMC price and availability must match the landing page or products are disapproved. The link for every item was built as base URL plus product handle, from the base URL you supplied.');
  return rows;
}

module.exports = { id: 'gmc', name: 'Google Merchant Center', write, delimiter: '\t', extension: 'tsv' };
