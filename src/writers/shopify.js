'use strict';

const M = require('../model');

// Shopify writer. Current header generation. One row per variant grouped by
// URL handle; first row carries the product fields; extra images are extra rows
// with only handle, image URL, position and alt text. Price rule: Price is the
// selling price and Compare-at price is the original when a sale or compareAt
// exists. Shopify supports a maximum of 3 options: overflow is a loud warning
// with the affected products listed, never a silent drop.

const HEADERS = [
  'Title', 'URL handle', 'Description', 'Vendor', 'Product category', 'Type', 'Tags',
  'Published on online store', 'Status', 'SKU', 'Barcodes',
  'Option1 name', 'Option1 value', 'Option1 LinkedTo',
  'Option2 name', 'Option2 value', 'Option2 LinkedTo',
  'Option3 name', 'Option3 value', 'Option3 LinkedTo',
  'Price', 'Compare-at price', 'Cost per item', 'Charge tax',
  'Inventory tracker', 'Inventory quantity', 'Continue selling when out of stock',
  'Weight value (grams)', 'Weight unit for display', 'Requires shipping',
  'Product image URL', 'Image position', 'Image alt text', 'Variant image URL',
  'Gift card', 'SEO title', 'SEO description',
];

function write(products, ctx) {
  const rep = ctx.report;
  const rows = [HEADERS];
  const overflow = [];

  for (const p of products) {
    if (p.extras.shortDescription) M.repDrop(rep, p.title, 'short description', 'Shopify product CSV has no short description field.');
    if (p.categoryPaths.length > 1) {
      M.repDrop(rep, p.title, `${p.categoryPaths.length - 1} extra categories`, 'Shopify product CSV carries one Type and at most one collection assignment per product. Extra category paths cannot be represented.');
    }
    let options = p.options || [];
    if (options.length > 3) {
      overflow.push(p.title);
      M.repDrop(rep, p.title, `options ${options.slice(3).map((o) => o.name).join(', ')}`, 'Shopify supports a maximum of 3 options per product. The first 3 options were written; variants differing only in the dropped options may collide.');
      options = options.slice(0, 3);
    }
    // Effective image list: product images plus any variant images not already
    // listed, the same way Shopify's own exports surface variant images.
    const effImages = [...p.images];
    for (const v of p.variants) {
      if (v.imageUrl && !effImages.some((i) => i.url === v.imageUrl)) effImages.push({ url: v.imageUrl, alt: '', position: effImages.length + 1 });
    }
    const variants = p.variants.length ? p.variants : [M.emptyVariant()];
    variants.forEach((v, vi) => {
      const row = new Array(HEADERS.length).fill('');
      const hi = (name) => HEADERS.indexOf(name);
      if (vi === 0) {
        row[hi('Title')] = p.title;
        row[hi('Description')] = p.descriptionHtml || M.textToHtml(p.descriptionText);
        row[hi('Vendor')] = p.vendor;
        row[hi('Type')] = p.typeFree || (p.categoryPaths[0] || '');
        row[hi('Tags')] = p.tags.join(', ');
        row[hi('Published on online store')] = p.published ? 'true' : 'false';
        row[hi('Status')] = ['draft', 'archived'].includes(p.status) ? p.status : 'active';
        row[hi('SEO title')] = p.seoTitle;
        row[hi('SEO description')] = p.seoDescription;
        if (effImages[0]) {
          row[hi('Product image URL')] = effImages[0].url;
          row[hi('Image position')] = '1';
          row[hi('Image alt text')] = effImages[0].alt || '';
        }
      }
      row[hi('URL handle')] = p.handle || M.slugify(p.title);
      options.forEach((opt, oi) => {
        row[hi(`Option${oi + 1} name`)] = vi === 0 ? opt.name : '';
        row[hi(`Option${oi + 1} value`)] = (v.optionValues || {})[opt.name] || '';
      });
      if (!options.length) {
        row[hi('Option1 name')] = vi === 0 ? 'Title' : '';
        row[hi('Option1 value')] = 'Default Title';
      }
      const sell = M.sellingPrice(v);
      row[hi('Price')] = sell === null ? '' : M.fmtPrice(sell);
      const pair = M.regularSalePair(v);
      const compareAt = v.sale !== null && v.sale !== undefined ? pair.regular : (v.compareAt !== null && v.compareAt !== undefined ? v.compareAt : null);
      row[hi('Compare-at price')] = compareAt !== null && sell !== null && compareAt > sell ? M.fmtPrice(compareAt) : '';
      row[hi('Cost per item')] = v.cost === null || v.cost === undefined ? '' : M.fmtPrice(v.cost);
      row[hi('Charge tax')] = 'true';
      row[hi('SKU')] = v.sku;
      row[hi('Barcodes')] = (v.barcodes || []).join('; ');
      row[hi('Inventory tracker')] = v.trackInventory || v.quantity !== null ? 'shopify' : '';
      row[hi('Inventory quantity')] = v.quantity === null || v.quantity === undefined ? '' : String(v.quantity);
      row[hi('Continue selling when out of stock')] = v.continueSelling ? 'continue' : 'deny';
      if (v.weight) {
        const grams = M.toGrams(v.weight.value, v.weight.unit);
        if (grams !== null) {
          const rounded = Math.round(grams);
          if (Math.abs(rounded - grams) > 1) M.repWarn(rep, `"${p.title}" (${v.sku || 'no SKU'}): weight ${grams} g rounded to ${rounded} g. Shopify stores integer grams.`);
          row[hi('Weight value (grams)')] = String(rounded);
          row[hi('Weight unit for display')] = 'g';
        }
      }
      row[hi('Requires shipping')] = 'true';
      row[hi('Variant image URL')] = v.imageUrl || '';
      row[hi('Gift card')] = 'false';
      rows.push(row);
    });
    // Extra images as image-only rows.
    effImages.slice(1).forEach((img, i) => {
      const row = new Array(HEADERS.length).fill('');
      row[HEADERS.indexOf('URL handle')] = p.handle || M.slugify(p.title);
      row[HEADERS.indexOf('Product image URL')] = img.url;
      row[HEADERS.indexOf('Image position')] = String(i + 2);
      row[HEADERS.indexOf('Image alt text')] = img.alt || '';
      rows.push(row);
    });
  }
  if (overflow.length) {
    M.repWarn(rep, `Products with more than 3 options (Shopify maximum): ${overflow.join('; ')}. Only the first 3 options were written for these products. Split them into separate products or trim options before importing.`);
  }
  M.repNote(rep, 'Shopify blank cells overwrite existing values on update imports. Columns this writer leaves blank are intentional: compare-at price, cost and weight are blank only when the source had none.');
  return rows;
}

module.exports = { id: 'shopify', name: 'Shopify', write, delimiter: ',', extension: 'csv' };
