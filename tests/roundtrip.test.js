'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { convertFile } = require('../src/index');
const { parseTable } = require('../src/csv');

const shopifySample = fs.readFileSync(path.join(__dirname, '..', 'examples', 'shopify-sample.csv'), 'utf8');
const wooSample = fs.readFileSync(path.join(__dirname, '..', 'examples', 'woocommerce-sample.csv'), 'utf8');

function byTitle(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r['Title'] || r['Name'] || '';
    if (key && !map.has(key)) map.set(key, []);
    if (key) map.get(key).push(r);
  }
  return map;
}

test('round trip: Shopify to Woo to Shopify preserves title, prices, SKUs, variants, quantities, images', () => {
  const toWoo = convertFile(shopifySample, { from: 'shopify', to: 'woocommerce' });
  assert.strictEqual(toWoo.report.products, 2);
  const back = convertFile(toWoo.output, { from: 'woocommerce', to: 'shopify' });
  const t = parseTable(back.output);
  const tee = t.rows.filter((r) => r['URL handle'] === 'everyday-cotton-tee');
  const skus = tee.map((r) => r['SKU']).filter(Boolean).sort();
  assert.deepStrictEqual(skus, ['TEE-BLK-M', 'TEE-WHT-M']);
  const blk = tee.find((r) => r['SKU'] === 'TEE-BLK-M');
  assert.strictEqual(blk['Price'], '24.99');
  assert.strictEqual(blk['Compare-at price'], '34.99');
  assert.strictEqual(blk['Inventory quantity'], '42');
  assert.strictEqual(blk['Weight value (grams)'], '180');
  const titles = new Set(t.rows.map((r) => r['Title']).filter(Boolean));
  assert.ok(titles.has('Everyday Cotton Tee'));
  assert.ok(titles.has('Trail Enamel Mug 350ml'));
  const teeImages = tee.map((r) => r['Product image URL']).filter(Boolean);
  assert.strictEqual(teeImages.length, 3);
});

test('round trip: Woo to Shopify to Woo preserves title, prices, SKUs, variant structure, quantities, images', () => {
  const toShop = convertFile(wooSample, { from: 'woocommerce', to: 'shopify' });
  assert.strictEqual(toShop.report.products, 2);
  const back = convertFile(toShop.output, { from: 'shopify', to: 'woocommerce' });
  const t = parseTable(back.output);
  const hoodieRows = t.rows.filter((r) => r['Name'] === 'Everyday Hoodie');
  const variations = hoodieRows.filter((r) => r['Type'] === 'variation');
  assert.strictEqual(variations.length, 2);
  const grey = variations.find((r) => r['SKU'] === 'HOOD-GRY-S');
  assert.strictEqual(grey['Regular price'], '54.00');
  assert.strictEqual(grey['Sale price'], '44.00');
  assert.strictEqual(grey['Stock'], '12');
  const blanket = t.rows.find((r) => r['SKU'] === 'BSK-OAK-01');
  assert.strictEqual(blanket['Regular price'], '49.00');
  assert.ok(blanket['Images'].includes('blanket-1.jpg'));
  assert.strictEqual(blanket['GTIN, UPC, EAN, or ISBN'], '045123498765');
});

test('cross conversion: Shopify sample to GMC feed validates required attributes', () => {
  const feed = convertFile(shopifySample, { from: 'shopify', to: 'gmc', baseUrl: 'https://shop.example.com', currency: 'EUR' });
  const t = parseTable(feed.output);
  assert.strictEqual(t.delimiter, '\t');
  assert.strictEqual(t.rows.length, 3);
  for (const r of t.rows) {
    assert.ok(r.id && r.title && r.link && r.price.endsWith(' EUR'));
    assert.ok(r.link.startsWith('https://shop.example.com/'));
    assert.ok(['in_stock', 'out_of_stock'].includes(r.availability));
  }
  const tee = t.rows.filter((r) => r.item_group_id === 'everyday-cotton-tee');
  assert.strictEqual(tee.length, 2);
  assert.strictEqual(tee[0].price, '34.99 EUR');
  assert.strictEqual(tee[0].sale_price, '24.99 EUR');
});

test('format auto-detection works for both samples', () => {
  const a = convertFile(shopifySample, { to: 'woocommerce' });
  assert.strictEqual(a.report.from, 'Shopify');
  const b = convertFile(wooSample, { to: 'shopify' });
  assert.strictEqual(b.report.from, 'WooCommerce');
});

test('conversion report counts and dropped fields are populated', () => {
  const r = convertFile(shopifySample, { from: 'shopify', to: 'woocommerce' });
  assert.strictEqual(r.report.variants, 3);
  assert.ok(r.reportText.includes('Products converted: 2'));
  assert.ok(r.report.dropped.some((d) => /brand/.test(d.field + d.reason)));
});
