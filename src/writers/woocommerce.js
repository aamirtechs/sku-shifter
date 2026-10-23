'use strict';

const M = require('../model');

// WooCommerce writer. Variable products: a Type=variable parent row listing all
// attribute values, followed by Type=variation rows whose Parent is the parent
// SKU (the parent row must come first for single-pass imports). Images are one
// comma-separated cell, first image featured. WooCommerce core has no brand
// column and no SEO columns, so vendor and SEO data are reported as dropped.
// Weight is written in the target store unit (option, default kg); the header
// carries that unit, exactly like a real WooCommerce export.

function write(products, ctx) {
  const rep = ctx.report;
  const unit = ctx.options.targetWeightUnit || 'kg';
  const maxAttrs = Math.max(1, ...products.map((p) => (p.options || []).length));
  const HEADERS = [
    'ID', 'Type', 'SKU', 'GTIN, UPC, EAN, or ISBN', 'Name', 'Published', 'Is featured?',
    'Visibility in catalog', 'Short description', 'Description', 'Tax status',
    'In stock?', 'Stock', 'Backorders allowed?', 'Sold individually?',
    `Weight (${unit})`, 'Sale price', 'Regular price', 'Categories', 'Tags', 'Images', 'Parent', 'Position',
  ];
  for (let n = 1; n <= maxAttrs; n++) {
    HEADERS.push(`Attribute ${n} name`, `Attribute ${n} value(s)`, `Attribute ${n} visible`, `Attribute ${n} global`);
  }
  const hi = (name) => HEADERS.indexOf(name);
  const rows = [HEADERS];

  const weightOut = (v) => {
    if (!v.weight) return '';
    const c = M.convertWeight(v.weight, unit);
    return c ? M.fmtNumber(c.value) : '';
  };
  const publishedVal = (p) => (p.status === 'draft' ? '-1' : (p.status === 'private' ? '0' : '1'));

  products.forEach((p, pi) => {
    if (p.vendor) M.repDrop(rep, p.title, 'vendor / brand', 'WooCommerce core product CSV has no brand column. Brands live in a plugin taxonomy; add the brand in WooCommerce after import if you use one.');
    if (p.seoTitle || p.seoDescription) M.repDrop(rep, p.title, 'SEO title and description', 'WooCommerce core CSV has no SEO columns. SEO plugins store them as meta fields with plugin-specific keys.');
    if (p.extras.materials) M.repDrop(rep, p.title, 'materials', 'WooCommerce product CSV has no materials field.');
    const hasOptions = (p.options || []).length > 0 && p.variants.length > 1 || (p.options || []).length > 0 && p.variants.some((v) => Object.keys(v.optionValues || {}).length);
    const parentSku = (p.variants[0] && !hasOptions && p.variants[0].sku)
      ? p.variants[0].sku
      : (p.handle || M.slugify(p.title));
    const parentRow = new Array(HEADERS.length).fill('');
    parentRow[hi('Type')] = hasOptions ? 'variable' : 'simple';
    parentRow[hi('SKU')] = hasOptions ? parentSku : (p.variants[0] ? p.variants[0].sku : '');
    parentRow[hi('Name')] = p.title;
    parentRow[hi('Published')] = publishedVal(p);
    parentRow[hi('Is featured?')] = p.extras.featured ? '1' : '0';
    parentRow[hi('Visibility in catalog')] = p.extras.visibility || 'visible';
    parentRow[hi('Short description')] = p.extras.shortDescription || '';
    parentRow[hi('Description')] = p.descriptionHtml || M.textToHtml(p.descriptionText);
    parentRow[hi('Tax status')] = 'taxable';
    parentRow[hi('Categories')] = p.categoryPaths.map(M.escapeCommas).join(', ');
    parentRow[hi('Tags')] = p.tags.join(', ');
    parentRow[hi('Images')] = p.images.map((i) => i.url).join(', ');
    parentRow[hi('Position')] = String(pi);
    if (p.images.some((i) => i.alt)) M.repDrop(rep, p.title, 'image alt text', 'The WooCommerce core importer cannot set image alt text. Alt text from the source was not written.');
    if (!hasOptions) {
      const v = p.variants[0] || M.emptyVariant();
      const pair = M.regularSalePair(v);
      parentRow[hi('Regular price')] = pair.regular === null || pair.regular === undefined ? '' : M.fmtPrice(pair.regular);
      parentRow[hi('Sale price')] = pair.sale === null || pair.sale === undefined ? '' : M.fmtPrice(pair.sale);
      parentRow[hi('GTIN, UPC, EAN, or ISBN')] = (v.barcodes || [])[0] || '';
      parentRow[hi('In stock?')] = v.quantity === null || v.quantity === undefined || v.quantity > 0 ? '1' : '0';
      parentRow[hi('Stock')] = v.quantity === null || v.quantity === undefined ? '' : String(v.quantity);
      parentRow[hi('Backorders allowed?')] = v.continueSelling ? 'notify' : '0';
      parentRow[hi(`Weight (${unit})`)] = weightOut(v);
      (p.options || []).forEach((opt, oi) => {
        parentRow[hi(`Attribute ${oi + 1} name`)] = opt.name;
        parentRow[hi(`Attribute ${oi + 1} value(s)`)] = opt.values.map(M.escapeCommas).join(', ');
        parentRow[hi(`Attribute ${oi + 1} visible`)] = '1';
        parentRow[hi(`Attribute ${oi + 1} global`)] = '0';
      });
      rows.push(parentRow);
      return;
    }
    (p.options || []).forEach((opt, oi) => {
      parentRow[hi(`Attribute ${oi + 1} name`)] = opt.name;
      parentRow[hi(`Attribute ${oi + 1} value(s)`)] = opt.values.map(M.escapeCommas).join(', ');
      parentRow[hi(`Attribute ${oi + 1} visible`)] = '1';
      parentRow[hi(`Attribute ${oi + 1} global`)] = '0';
    });
    rows.push(parentRow);
    p.variants.forEach((v, vi) => {
      const row = new Array(HEADERS.length).fill('');
      row[hi('Type')] = 'variation';
      let sku = v.sku;
      if (!sku) {
        sku = `${parentSku}-${vi + 1}`;
        M.repWarn(rep, `"${p.title}": a variation had no SKU. Generated "${sku}". WooCommerce needs a unique SKU per variation.`);
      }
      row[hi('SKU')] = sku;
      row[hi('GTIN, UPC, EAN, or ISBN')] = (v.barcodes || [])[0] || '';
      row[hi('Name')] = p.title;
      row[hi('Published')] = publishedVal(p);
      const pair = M.regularSalePair(v);
      row[hi('Regular price')] = pair.regular === null || pair.regular === undefined ? '' : M.fmtPrice(pair.regular);
      row[hi('Sale price')] = pair.sale === null || pair.sale === undefined ? '' : M.fmtPrice(pair.sale);
      row[hi('In stock?')] = v.quantity === null || v.quantity === undefined || v.quantity > 0 ? '1' : '0';
      row[hi('Stock')] = v.quantity === null || v.quantity === undefined ? '' : String(v.quantity);
      row[hi('Backorders allowed?')] = v.continueSelling ? 'notify' : '0';
      row[hi(`Weight (${unit})`)] = weightOut(v);
      row[hi('Images')] = v.imageUrl || '';
      row[hi('Parent')] = parentSku;
      row[hi('Position')] = String(vi);
      (p.options || []).forEach((opt, oi) => {
        row[hi(`Attribute ${oi + 1} name`)] = opt.name;
        row[hi(`Attribute ${oi + 1} value(s)`)] = (v.optionValues || {})[opt.name] || '';
        row[hi(`Attribute ${oi + 1} visible`)] = '1';
        row[hi(`Attribute ${oi + 1} global`)] = '0';
      });
      rows.push(row);
    });
  });
  M.repTransform(rep, `Weights written in ${unit} (the target store unit option, default kg). Set your WooCommerce store weight unit to ${unit}, or pass a different target weight unit.`);
  return rows;
}

module.exports = { id: 'woocommerce', name: 'WooCommerce', write, delimiter: ',', extension: 'csv' };
