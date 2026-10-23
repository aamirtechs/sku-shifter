'use strict';

const M = require('../model');

// Etsy reader. Etsy's native download (Shop Manager, Settings, Options, Download Data,
// "Currently for Sale Listings") is export-only: Etsy has no native listing CSV import,
// which is why Etsy is a reader-only platform here. The official field list is thin:
// Title, Description, Price, Currency Code, Quantity, Tags, Materials, Image URLs,
// SKU numbers. No variants, no weight, no barcode, no sale price, active listings only.
// Real files spread image URLs across several columns, so any image-looking column
// is collected in file order.

function detect(headers) {
  return headers.includes('Title') && headers.includes('Currency Code') &&
    (headers.includes('Materials') || headers.some((h) => /image/i.test(h)));
}

function read(table, ctx) {
  const rep = ctx.report;
  const imageCols = table.headers.filter((h) => /image/i.test(h));
  const products = [];
  let currencySeen = '';
  for (const row of table.rows) {
    if (!row['Title']) continue;
    const p = M.emptyProduct();
    p.title = row['Title'];
    p.handle = M.slugify(p.title);
    p.descriptionText = row['Description'] || '';
    p.descriptionHtml = M.textToHtml(p.descriptionText);
    p.tags = M.splitList(row['Tags'] || '');
    if (row['Materials']) p.extras.materials = row['Materials'];
    p.status = 'active';
    p.published = true;
    for (const col of imageCols) {
      const cell = row[col];
      if (!cell) continue;
      for (const url of M.splitList(cell)) {
        if (!p.images.some((i) => i.url === url)) p.images.push({ url, alt: '', position: p.images.length + 1 });
      }
    }
    const v = M.emptyVariant();
    v.regular = M.parseNumber(row['Price']);
    v.quantity = M.parseIntOrNull(row['Quantity']);
    v.trackInventory = v.quantity !== null;
    const skuCell = row['SKU numbers'] || row['SKU'] || '';
    if (skuCell.includes(',')) {
      M.repWarn(rep, `"${p.title}": the Etsy SKU cell holds multiple values ("${skuCell}"). Variations are not separate rows in an Etsy export, so the values were kept together on one variant. Split them manually if each is a separate variant.`);
    }
    v.sku = skuCell.trim();
    p.variants = [v];
    if (row['Currency Code']) currencySeen = row['Currency Code'];
    products.push(p);
  }
  if (currencySeen) M.repTransform(rep, `Etsy prices are in ${currencySeen} (from the export Currency Code). Target files carry bare numbers in that same currency.`);
  M.repNote(rep, 'Etsy exports contain no variants, weight, barcodes, sale prices or draft status (active listings only). Anything missing here was absent at the source, not lost in conversion.');
  if (products.some((p) => p.extras.materials)) M.repNote(rep, 'Etsy Materials are kept in the conversion data and reported per target: most target platforms have no materials field.');
  return products;
}

module.exports = { id: 'etsy', name: 'Etsy (export only)', detect, read };
