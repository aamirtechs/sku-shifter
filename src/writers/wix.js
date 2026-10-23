'use strict';

const M = require('../model');

// Wix writer. Row model: one PRODUCT row, one VARIANT row per variant, one MEDIA
// row per image, all sharing the handle. Descriptions are plain text (HTML is
// stripped and reported). Inventory is never blank: in Wix a blank inventory
// cell means OUT_OF_STOCK, so untracked stock is written as IN_STOCK.
// strikethroughPrice must be higher than price, or Wix rejects it.

function write(products, ctx) {
  const rep = ctx.report;
  const unit = ctx.options.targetWeightUnit || 'kg';
  const maxOpts = Math.min(6, Math.max(1, ...products.map((p) => (p.options || []).length)));
  const HEADERS = [
    'handle', 'fieldType', 'name', 'visible', 'plainDescription', 'categorySlugs',
    'primaryCategorySlug', 'media', 'mediaAltText', 'ribbon', 'brand', 'price',
    'strikethroughPrice', 'cost', 'inventory', 'sku', 'barcode', 'weight',
  ];
  for (let n = 1; n <= maxOpts; n++) HEADERS.push(`productOptionName[${n}]`, `productOptionType[${n}]`, `productOptionChoices[${n}]`);
  const hi = (name) => HEADERS.indexOf(name);
  const rows = [HEADERS];

  const invOut = (v) => (v.quantity === null || v.quantity === undefined ? 'IN_STOCK' : String(v.quantity));
  const weightOut = (v) => {
    if (!v.weight) return '';
    const c = M.convertWeight(v.weight, unit);
    return c ? M.fmtNumber(c.value) : '';
  };
  const slugOf = (path) => M.slugify(String(path).split('>').pop().split('/').pop());

  for (const p of products) {
    if (p.seoTitle || p.seoDescription) M.repDrop(rep, p.title, 'SEO title and description', 'The Wix product CSV template has no SEO columns. Wix builds title tags from the product name and site name.');
    if (p.tags.length) M.repDrop(rep, p.title, 'tags', 'The Wix product CSV template has no tags field.');
    if (p.extras.shortDescription) M.repDrop(rep, p.title, 'short description', 'Wix has one description field (plainDescription). The main description was used.');
    if ((p.options || []).length > 6) M.repWarn(rep, `"${p.title}" has ${p.options.length} options. Wix supports a maximum of 6. Only the first 6 were written.`);
    if (p.descriptionHtml && M.stripHtml(p.descriptionHtml) !== p.descriptionText && p.descriptionHtml.replace(/<[^>]*>/g, '') !== p.descriptionText) {
      M.repTransform(rep, `"${p.title}": HTML description converted to plain text. Wix plainDescription does not support HTML.`);
    }
    const handle = p.handle || M.slugify(p.title);
    const isDraft = p.status === 'draft' || p.status === 'archived' || !p.published;
    const slugs = p.categoryPaths.map(slugOf).filter(Boolean);
    const variants = p.variants.length ? p.variants : [M.emptyVariant()];
    const hasVariants = (p.options || []).length > 0 && variants.length >= 1 && Object.keys(variants[0].optionValues || {}).length > 0;

    const prow = new Array(HEADERS.length).fill('');
    prow[hi('handle')] = handle;
    prow[hi('fieldType')] = 'PRODUCT';
    let name = p.title;
    if (name.length > 80) { M.repWarn(rep, `"${p.title}": name truncated to 80 characters, the Wix maximum.`); name = name.slice(0, 80); }
    prow[hi('name')] = name;
    prow[hi('visible')] = isDraft ? 'FALSE' : 'TRUE';
    prow[hi('plainDescription')] = p.descriptionText || M.stripHtml(p.descriptionHtml);
    prow[hi('categorySlugs')] = slugs.join(';');
    prow[hi('primaryCategorySlug')] = slugs[0] || '';
    prow[hi('ribbon')] = p.extras.ribbon || '';
    prow[hi('brand')] = (p.vendor || '').slice(0, 50);
    (p.options || []).slice(0, 6).forEach((opt, oi) => {
      prow[hi(`productOptionName[${oi + 1}]`)] = opt.name;
      prow[hi(`productOptionType[${oi + 1}]`)] = 'TEXT_CHOICES';
      prow[hi(`productOptionChoices[${oi + 1}]`)] = opt.values.join(';');
    });
    if (hasVariants) {
      // The PRODUCT row must never carry blank inventory either (blank means
      // OUT_OF_STOCK in Wix). Variant rows hold the real per-variant numbers;
      // the product row gets the total, or IN_STOCK when stock is untracked.
      const qtys = variants.map((v) => v.quantity);
      prow[hi('inventory')] = qtys.every((q) => q === null || q === undefined)
        ? 'IN_STOCK'
        : String(qtys.reduce((a, q) => a + (q || 0), 0));
    } else {
      const v = variants[0];
      const pair = M.regularSalePair(v);
      const sell = M.sellingPrice(v);
      prow[hi('price')] = sell === null ? '' : M.fmtPrice(sell);
      prow[hi('strikethroughPrice')] = pair.sale !== null && pair.sale !== undefined && pair.regular > sell ? M.fmtPrice(pair.regular) : '';
      prow[hi('cost')] = v.cost === null || v.cost === undefined ? '' : M.fmtPrice(v.cost);
      prow[hi('inventory')] = invOut(v);
      prow[hi('sku')] = (v.sku || '').slice(0, 40);
      prow[hi('barcode')] = (v.barcodes || [])[0] || '';
      prow[hi('weight')] = weightOut(v);
    }
    rows.push(prow);

    if (hasVariants) {
      variants.forEach((v) => {
        const row = new Array(HEADERS.length).fill('');
        const pair = M.regularSalePair(v);
        const sell = M.sellingPrice(v);
        row[hi('handle')] = handle;
        row[hi('fieldType')] = 'VARIANT';
        row[hi('price')] = sell === null ? '' : M.fmtPrice(sell);
        row[hi('strikethroughPrice')] = pair.sale !== null && pair.sale !== undefined && pair.regular > sell ? M.fmtPrice(pair.regular) : '';
        row[hi('cost')] = v.cost === null || v.cost === undefined ? '' : M.fmtPrice(v.cost);
        row[hi('inventory')] = invOut(v);
        row[hi('sku')] = (v.sku || '').slice(0, 40);
        row[hi('barcode')] = (v.barcodes || [])[0] || '';
        row[hi('weight')] = weightOut(v);
        (p.options || []).slice(0, 6).forEach((opt, oi) => {
          row[hi(`productOptionChoices[${oi + 1}]`)] = (v.optionValues || {})[opt.name] || '';
        });
        rows.push(row);
      });
    }
    p.images.forEach((img) => {
      const row = new Array(HEADERS.length).fill('');
      row[hi('handle')] = handle;
      row[hi('fieldType')] = 'MEDIA';
      row[hi('media')] = img.url;
      row[hi('mediaAltText')] = img.alt || '';
      rows.push(row);
    });
  }
  M.repNote(rep, 'Wix imports can create categories from slugs but cannot nest them. Build any category hierarchy in the Wix dashboard after import.');
  M.repTransform(rep, `Weights written in ${unit} (target weight unit option, default kg), matching the store measurement setting Wix expects.`);
  return rows;
}

module.exports = { id: 'wix', name: 'Wix', write, delimiter: ',', extension: 'csv' };
