'use strict';

const test = require('node:test');
const assert = require('node:assert');
const M = require('../src/model');

function sampleProduct() {
  const p = M.emptyProduct();
  p.title = 'Sample Jacket';
  p.handle = 'sample-jacket';
  p.descriptionHtml = '<p>Warm jacket</p>';
  p.descriptionText = 'Warm jacket';
  p.vendor = 'Northwind';
  p.typeFree = 'Jackets';
  p.tags = ['winter'];
  p.seoTitle = 'Sample Jacket SEO';
  p.seoDescription = 'A warm sample jacket';
  p.images = [
    { url: 'https://img.example.com/j1.jpg', alt: 'Front', position: 1 },
    { url: 'https://img.example.com/j2.jpg', alt: 'Back', position: 2 },
  ];
  p.options = [{ name: 'Size', values: ['S', 'L'] }];
  const v1 = M.emptyVariant();
  v1.optionValues = { Size: 'S' }; v1.regular = 80; v1.sale = 64; v1.compareAt = 80;
  v1.sku = 'JKT-S'; v1.barcodes = ['012345678905']; v1.quantity = 3; v1.trackInventory = true;
  v1.weight = { value: 900, unit: 'g' };
  const v2 = M.emptyVariant();
  v2.optionValues = { Size: 'L' }; v2.regular = 82; v2.sku = 'JKT-L'; v2.quantity = 0; v2.trackInventory = true;
  v2.weight = { value: 950, unit: 'g' };
  p.variants = [v1, v2];
  return p;
}

function runWriter(id, options = {}) {
  const mod = require('../src/writers/' + id);
  const report = M.createReport('test', id);
  const rows = mod.write([sampleProduct()], { report, options });
  return { rows, report, headers: rows[0] };
}

test('shopify writer: required columns, price rule, grams stay grams, extra image row', () => {
  const { rows, headers } = runWriter('shopify');
  for (const col of ['Title', 'URL handle', 'Price', 'Compare-at price', 'SKU', 'Weight value (grams)', 'Product image URL']) {
    assert.ok(headers.includes(col), 'missing header ' + col);
  }
  const hi = (n) => headers.indexOf(n);
  const r1 = rows[1];
  assert.strictEqual(r1[hi('Price')], '64.00');
  assert.strictEqual(r1[hi('Compare-at price')], '80.00');
  assert.strictEqual(r1[hi('Weight value (grams)')], '900');
  const imageRows = rows.filter((r) => r[hi('Product image URL')] === 'https://img.example.com/j2.jpg' && !r[hi('SKU')]);
  assert.strictEqual(imageRows.length, 1);
});

test('shopify writer: more than 3 options is a loud warning naming the product', () => {
  const p = sampleProduct();
  p.options = ['A', 'B', 'C', 'D'].map((n) => ({ name: n, values: ['x'] }));
  const mod = require('../src/writers/shopify');
  const report = M.createReport('test', 'shopify');
  mod.write([p], { report, options: {} });
  assert.ok(report.warnings.some((w) => /more than 3 options/.test(w) && /Sample Jacket/.test(w)));
  assert.ok(report.dropped.some((d) => /maximum of 3 options/.test(d.reason)));
});

test('woocommerce writer: parent precedes variations, Parent links by SKU, price pair', () => {
  const { rows, headers } = runWriter('woocommerce');
  const hi = (n) => headers.indexOf(n);
  const parentIdx = rows.findIndex((r) => r[hi('Type')] === 'variable');
  const varIdx = rows.findIndex((r) => r[hi('Type')] === 'variation');
  assert.ok(parentIdx > 0 && varIdx > parentIdx, 'parent must precede variations');
  const parentSku = rows[parentIdx][hi('SKU')];
  assert.strictEqual(rows[varIdx][hi('Parent')], parentSku);
  assert.strictEqual(rows[varIdx][hi('Regular price')], '80.00');
  assert.strictEqual(rows[varIdx][hi('Sale price')], '64.00');
  assert.ok(headers.some((h) => h === 'Weight (kg)'));
  const v = rows[varIdx];
  assert.strictEqual(v[hi('Weight (kg)')], '0.9');
});

test('woocommerce writer: vendor is reported dropped (no core brand column)', () => {
  const { report } = runWriter('woocommerce');
  assert.ok(report.dropped.some((d) => /brand/.test(d.field + d.reason)));
});

test('wix writer: inventory never blank, MEDIA rows exist, strikethrough above price', () => {
  const { rows, headers } = runWriter('wix');
  const hi = (n) => headers.indexOf(n);
  const media = rows.filter((r) => r[hi('fieldType')] === 'MEDIA');
  assert.strictEqual(media.length, 2);
  const variants = rows.filter((r) => r[hi('fieldType')] === 'VARIANT');
  assert.strictEqual(variants.length, 2);
  for (const r of rows.slice(1).filter((x) => x[hi('fieldType')] !== 'MEDIA')) assert.notStrictEqual(r[hi('inventory')], '');
  assert.strictEqual(variants[0][hi('price')], '64.00');
  assert.strictEqual(variants[0][hi('strikethroughPrice')], '80.00');
});

test('gmc writer: required feed attributes, currency-coded price, item group, TSV shape', () => {
  const { rows, headers } = runWriter('gmc', { baseUrl: 'https://shop.example.com', currency: 'USD' });
  for (const col of ['id', 'title', 'description', 'link', 'image_link', 'availability', 'price']) {
    assert.ok(headers.includes(col), 'missing GMC attribute ' + col);
  }
  const hi = (n) => headers.indexOf(n);
  const r1 = rows[1];
  assert.strictEqual(r1[hi('link')], 'https://shop.example.com/sample-jacket');
  assert.strictEqual(r1[hi('price')], '80.00 USD');
  assert.strictEqual(r1[hi('sale_price')], '64.00 USD');
  assert.strictEqual(r1[hi('gtin')], '012345678905');
  assert.strictEqual(r1[hi('item_group_id')], 'sample-jacket');
  assert.strictEqual(r1[hi('availability')], 'in_stock');
  assert.strictEqual(rows[2][hi('availability')], 'out_of_stock');
  const mod = require('../src/writers/gmc');
  assert.strictEqual(mod.delimiter, '\t');
});

test('gmc writer: refuses to invent link or currency', () => {
  const mod = require('../src/writers/gmc');
  const report = M.createReport('test', 'gmc');
  assert.throws(() => mod.write([sampleProduct()], { report, options: {} }), /baseUrl|currency/);
});
