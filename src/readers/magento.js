'use strict';

const M = require('../model');

// Magento (Adobe Commerce) reader. Headers are attribute codes; only sku is
// required. A configurable product's variations are separate simple products,
// linked by the _super_products_sku service column on the configurable rows and
// the _super_attribute_code list; varying values sit in additional_attributes
// (encoded code=value,code=value). Rows without a sku carry extra images and
// options for the product row above them. Images are relative file paths, not
// URLs: they are carried as references and flagged in every conversion report.

function detect(headers) {
  return headers.includes('sku') && (headers.includes('attribute_set_code') || headers.includes('product_type') || headers.includes('_super_products_sku'));
}

function parseEncodedPairs(cell) {
  const out = {};
  if (!cell) return out;
  for (const part of String(cell).split(',')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = part.slice(idx + 1).trim();
  }
  return out;
}

function read(table, ctx) {
  const rep = ctx.report;
  const unit = ctx.options.sourceWeightUnit || 'kg';
  const products = [];
  const bySku = new Map();
  let current = null;

  const imageUrls = (row) => {
    const urls = [];
    for (const col of ['base_image', 'small_image', 'thumbnail_image', 'swatch_image']) {
      if (row[col] && !urls.includes(row[col])) urls.push(row[col]);
    }
    if (row['additional_images']) {
      for (const u of M.splitList(row['additional_images'])) if (!urls.includes(u)) urls.push(u);
    }
    return urls;
  };

  for (const row of table.rows) {
    const sku = (row['sku'] || '').trim();
    if (!sku) {
      if (current) {
        for (const u of imageUrls(row)) {
          if (!current.images.some((i) => i.url === u)) current.images.push({ url: u, alt: '', position: current.images.length + 1 });
        }
      } else {
        M.repWarn(rep, `Row ${row.__record}: row without a sku and no preceding product row was skipped.`);
      }
      continue;
    }
    const p = M.emptyProduct();
    p.title = row['name'] || sku;
    p.handle = row['url_key'] || M.slugify(p.title);
    p.descriptionHtml = row['description'] || '';
    p.descriptionText = M.stripHtml(p.descriptionHtml);
    p.extras.shortDescription = row['short_description'] || '';
    p.categoryPaths = M.splitList(row['categories'] || '').map((c) => c.split('/').slice(1).join('/')).filter(Boolean);
    p.status = row['product_online'] === '2' ? 'draft' : 'active';
    p.published = p.status === 'active';
    p.seoTitle = row['meta_title'] || '';
    p.seoDescription = row['meta_description'] || '';
    if (row['meta_keywords']) p.extras.metaKeywords = row['meta_keywords'];
    for (const u of imageUrls(row)) p.images.push({ url: u, alt: row['base_image_label'] || '', position: p.images.length + 1 });
    const v = M.emptyVariant();
    v.sku = sku;
    v.regular = M.parseNumber(row['price']);
    v.sale = M.parseNumber(row['special_price']);
    if (row['special_price_from_date'] || row['special_price_to_date']) {
      v.extras = { saleFrom: row['special_price_from_date'] || '', saleTo: row['special_price_to_date'] || '' };
    }
    v.quantity = M.parseIntOrNull(row['qty']);
    v.trackInventory = row['manage_stock'] !== '0';
    const w = M.parseNumber(row['weight']);
    if (w !== null) v.weight = { value: w, unit };
    p.variants = [v];
    p.extras.magentoType = row['product_type'] || 'simple';
    p.extras.superAttributeCodes = M.splitList(row['_super_attribute_code'] || '');
    p.extras.superProductSkus = M.splitList(row['_super_products_sku'] || '');
    p.extras.additionalAttributes = parseEncodedPairs(row['additional_attributes']);
    if (row['store_view_code'] || row['product_websites']) {
      M.repDrop(rep, p.title, 'multi-store assignment', 'store_view_code and product_websites have no equivalent in other platforms product files.');
    }
    bySku.set(sku, p);
    products.push(p);
    current = p;
  }

  // Reconstruct configurables: children become variants of their parent and are
  // removed from the top-level product list.
  const childSkus = new Set();
  for (const p of products) {
    if (p.extras.magentoType !== 'configurable') continue;
    const codes = p.extras.superAttributeCodes;
    const children = p.extras.superProductSkus.map((s) => bySku.get(s)).filter(Boolean);
    if (!children.length) {
      M.repWarn(rep, `"${p.title}": configurable product lists no associated simple products in _super_products_sku. It was converted as a simple product.`);
      continue;
    }
    const variants = [];
    const optionNames = [];
    for (const child of children) {
      childSkus.add(child.variants[0].sku);
      const cv = child.variants[0];
      const attrs = child.extras.additionalAttributes || {};
      const ov = {};
      const useCodes = codes.length ? codes : Object.keys(attrs);
      for (const code of useCodes) {
        if (attrs[code]) {
          ov[code] = attrs[code];
          if (!optionNames.includes(code)) optionNames.push(code);
        }
      }
      if (!Object.keys(ov).length) {
        M.repWarn(rep, `"${p.title}": associated product ${cv.sku} has no super attribute values in additional_attributes. Its option values could not be reconstructed.`);
      }
      cv.optionValues = ov;
      if (!cv.imageUrl && child.images.length) cv.imageUrl = child.images[0].url;
      variants.push(cv);
      for (const img of child.images) {
        if (!p.images.some((i) => i.url === img.url)) p.images.push(img);
      }
    }
    p.options = optionNames.map((name) => ({ name, values: [...new Set(variants.map((v) => v.optionValues[name]).filter(Boolean))] }));
    p.variants = variants;
  }
  const topLevel = products.filter((p) => !(p.extras.magentoType === 'simple' && childSkus.has(p.variants[0] && p.variants[0].sku)));
  for (const p of topLevel) {
    delete p.extras.magentoType; delete p.extras.superAttributeCodes; delete p.extras.superProductSkus; delete p.extras.additionalAttributes;
  }
  M.repTransform(rep, `Magento weights are bare numbers in the store unit. Assumed source weight unit: ${unit}.`);
  M.repNote(rep, 'Magento image fields are relative file paths (for example /mb01-blue-0.jpg), not URLs. They were carried as references. Targets that fetch images from public URLs cannot use a bare path: host the images first, or expect to attach them manually.');
  M.repNote(rep, 'Magento has no GTIN column in the default attribute set (it is normally a custom attribute), so barcodes are usually absent from Magento exports.');
  return topLevel;
}

module.exports = { id: 'magento', name: 'Magento / Adobe Commerce', detect, read };
