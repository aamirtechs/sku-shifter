'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { parseTable } = require('../src/csv');
const M = require('../src/model');

function readFixture(name, text, options = {}) {
  const mod = require('../src/readers/' + name);
  const report = M.createReport(name, 'test');
  return { products: mod.read(parseTable(text), { report, options }), report };
}

const SHOPIFY_LEGACY = [
  'Handle,Title,Body (HTML),Vendor,Type,Tags,Published,Variant SKU,Variant Grams,Variant Price,Variant Compare At Price,Image Src',
  'legacy-hat,Legacy Hat,<p>Old format hat</p>,Acme,Hats,wool,true,HAT-1,200,19.99,24.99,https://img.example.com/hat.jpg',
].join('\n');

test('shopify reader: current sample with variants, sale price and image-only row', () => {
  const text = fs.readFileSync(path.join(__dirname, '..', 'examples', 'shopify-sample.csv'), 'utf8');
  const { products } = readFixture('shopify', text);
  assert.strictEqual(products.length, 2);
  const tee = products[0];
  assert.strictEqual(tee.title, 'Everyday Cotton Tee');
  assert.strictEqual(tee.variants.length, 2);
  assert.strictEqual(tee.options.length, 2);
  assert.deepStrictEqual(tee.options.map((o) => o.name), ['Size', 'Color']);
  assert.strictEqual(tee.variants[0].sale, 24.99);
  assert.strictEqual(tee.variants[0].regular, 34.99);
  assert.strictEqual(tee.variants[0].weight.value, 180);
  assert.strictEqual(tee.variants[0].weight.unit, 'g');
  assert.strictEqual(tee.images.length, 2);
  assert.strictEqual(tee.variants[1].imageUrl, 'https://cdn.example.com/images/tee-white-front.jpg');
  const mug = products[1];
  assert.strictEqual(mug.variants.length, 1);
  assert.strictEqual(mug.options.length, 0);
});

test('shopify reader: legacy headers accepted', () => {
  const { products } = readFixture('shopify', SHOPIFY_LEGACY);
  assert.strictEqual(products.length, 1);
  assert.strictEqual(products[0].handle, 'legacy-hat');
  assert.strictEqual(products[0].variants[0].regular, 24.99);
  assert.strictEqual(products[0].variants[0].sale, 19.99);
  assert.strictEqual(products[0].images.length, 1);
});

const WOO = [
  'ID,Type,SKU,"GTIN, UPC, EAN, or ISBN",Name,Published,Description,Short description,Regular price,Sale price,Stock,Categories,Tags,Images,Parent,Attribute 1 name,Attribute 1 value(s)',
  ',variable,PARENT-1,,Parent Product,1,<p>Desc</p>,,54.00,,,Clothing,,"https://img.example.com/p.jpg",,Size,"S, M"',
  ',variation,CHILD-1,,Parent Product,1,,,54.00,44.00,7,,,,PARENT-1,Size,S',
].join('\n');

test('woocommerce reader: variable parent plus variation, price pair and stock', () => {
  const { products } = readFixture('woocommerce', WOO);
  assert.strictEqual(products.length, 1);
  const p = products[0];
  assert.strictEqual(p.options.length, 1);
  assert.deepStrictEqual(p.options[0].values, ['S', 'M']);
  assert.strictEqual(p.variants.length, 1);
  assert.strictEqual(p.variants[0].sku, 'CHILD-1');
  assert.strictEqual(p.variants[0].regular, 54);
  assert.strictEqual(p.variants[0].sale, 44);
  assert.strictEqual(p.variants[0].quantity, 7);
  assert.strictEqual(p.variants[0].optionValues.Size, 'S');
});

const WIX_H = ['handle', 'fieldType', 'name', 'visible', 'plainDescription', 'categorySlugs', 'primaryCategorySlug', 'media', 'mediaAltText', 'ribbon', 'brand', 'price', 'strikethroughPrice', 'inventory', 'sku', 'barcode', 'weight', 'productOptionName[1]', 'productOptionType[1]', 'productOptionChoices[1]'];
function wixRow(kw) {
  const r = new Array(WIX_H.length).fill('');
  for (const [k, v] of Object.entries(kw)) r[WIX_H.indexOf(k)] = v;
  return r.join(',');
}
const WIX = [
  WIX_H.join(','),
  wixRow({ handle: 'wix-tee', fieldType: 'PRODUCT', name: 'Wix Tee', visible: 'TRUE', plainDescription: 'Plain text description', categorySlugs: 'tees', brand: 'BrandCo', price: '20.00', strikethroughPrice: '28.00', sku: 'TEE-1', barcode: '123456789012', weight: '0.2', 'productOptionName[1]': 'Size', 'productOptionType[1]': 'TEXT_CHOICES', 'productOptionChoices[1]': 'Small;Large' }),
  wixRow({ handle: 'wix-tee', fieldType: 'VARIANT', price: '20.00', strikethroughPrice: '28.00', inventory: '9', sku: 'TEE-1-S', weight: '0.2', 'productOptionChoices[1]': 'Small' }),
  wixRow({ handle: 'wix-tee', fieldType: 'VARIANT', price: '20.00', strikethroughPrice: '28.00', inventory: '4', sku: 'TEE-1-L', weight: '0.25', 'productOptionChoices[1]': 'Large' }),
  wixRow({ handle: 'wix-tee', fieldType: 'MEDIA', media: 'https://img.example.com/wix.jpg', mediaAltText: 'Wix tee' }),
].join('\n');

test('wix reader: PRODUCT, VARIANT and MEDIA rows, strikethrough sale model', () => {
  const { products } = readFixture('wix', WIX);
  assert.strictEqual(products.length, 1);
  const p = products[0];
  assert.strictEqual(p.vendor, 'BrandCo');
  assert.strictEqual(p.variants.length, 2);
  assert.strictEqual(p.variants[0].regular, 28);
  assert.strictEqual(p.variants[0].sale, 20);
  assert.strictEqual(p.variants[0].optionValues.Size, 'Small');
  assert.strictEqual(p.images.length, 1);
});

const SQUARESPACE = [
  'Product ID [Non Editable],Variant ID [Non Editable],Product Type [Non Editable],Product Page,Product URL,Title,SKU,Option Name 1,Option Value 1,Price,Sale Price,On Sale,Stock,Unlimited,Weight,Description,Tags,Categories,Visible,Hosted Image URL',
  ',,Physical,shop,/shop/candle-01,Soy Candle,CND-01,Scent,Cedar,18.00,14.00,true,20,false,1.2,<p>Wax candle</p>,"home, gift",Candles,true,https://images.example.com/candle.jpg',
  ',,Physical,shop,/shop/candle-01,Soy Candle,CND-02,Scent,Fig,18.00,,false,0,false,1.2,<p>Wax candle</p>,"home, gift",Candles,true,https://images.example.com/candle.jpg',
].join('\n');

test('squarespace reader: product row plus option row, On Sale pair', () => {
  const { products } = readFixture('squarespace', SQUARESPACE);
  assert.strictEqual(products.length, 1);
  const p = products[0];
  assert.strictEqual(p.handle, 'candle-01');
  assert.strictEqual(p.variants.length, 2);
  assert.strictEqual(p.variants[0].sale, 14);
  assert.strictEqual(p.variants[0].regular, 18);
  assert.strictEqual(p.variants[1].quantity, 0);
  assert.strictEqual(p.options[0].values.join(','), 'Cedar,Fig');
});

const ETSY = [
  'Title,Description,Price,Currency Code,Quantity,Tags,Materials,Image URL 1,Image URL 2,SKU numbers',
  'Handwoven Scarf,Warm woven scarf in rust tones.,32.00,USD,6,"scarf, winter",wool,https://img.example.com/scarf-1.jpg,https://img.example.com/scarf-2.jpg,SCARF-RUST-1',
].join('\n');

test('etsy reader: thin export, split image columns collected, materials kept', () => {
  const { products } = readFixture('etsy', ETSY);
  assert.strictEqual(products.length, 1);
  const p = products[0];
  assert.strictEqual(p.images.length, 2);
  assert.strictEqual(p.variants[0].regular, 32);
  assert.strictEqual(p.variants[0].quantity, 6);
  assert.strictEqual(p.extras.materials, 'wool');
  assert.strictEqual(p.options.length, 0);
});

const BC_MODERN = [
  'Item,ID,Name,Type,SKU,Options,Inventory Tracking,Current Stock,Price,Sale Price,Retail Price,Brand ID,Categories,Description,Product URL,Is Visible,Weight,Image URL (Import),Image Description,Image is Thumbnail,Image Sort Order,Variant Image URL',
  'Product,101,Modern Widget,physical,WID-1,,variant,10,30.00,,,7,12;15,<p>Widget</p>,/modern-widget/,TRUE,0.4,,,,,',
  'Variant,,Modern Widget,physical,WID-1-RED,Color=Red,variant,4,30.00,,,,,<p>Widget</p>,,TRUE,0.4,,,,,https://img.example.com/red.jpg',
  'Image,,Modern Widget,,,,,,,,,,<p>Widget</p>,,,,,https://img.example.com/widget.jpg,Front,TRUE,1,',
].join('\n');

test('bigcommerce reader: Modern rows, variant options, brand and category IDs reported', () => {
  const { products, report } = readFixture('bigcommerce', BC_MODERN);
  assert.strictEqual(products.length, 1);
  const p = products[0];
  assert.strictEqual(p.variants.length, 2);
  const red = p.variants.find((v) => v.sku === 'WID-1-RED');
  assert.strictEqual(red.optionValues.Color, 'Red');
  assert.strictEqual(p.images.length, 1);
  assert.ok(report.dropped.some((d) => /Brand ID/.test(d.reason)));
  assert.ok(report.dropped.some((d) => /category IDs/.test(d.reason)));
});

const BC_LH = ['Item Type', 'Product Name', 'Product Code/SKU', 'Category String', 'Brand Name', 'Price', 'Sale Price', 'Stock Level', 'Track Inventory', 'Product Visible', 'Product Image URL'];
function bcRow(kw) {
  const r = new Array(BC_LH.length).fill('');
  for (const [k, v] of Object.entries(kw)) r[BC_LH.indexOf(k)] = v;
  return r.join(',');
}
const BC_LEGACY = [
  BC_LH.join(','),
  bcRow({ 'Item Type': 'Product', 'Product Name': 'Legacy Gadget', 'Product Code/SKU': 'GAD-1', 'Category String': 'Tech;Gadgets', 'Brand Name': 'GadgetCo', Price: '45.00', 'Track Inventory': 'by product', 'Product Visible': 'TRUE', 'Product Image URL': 'https://img.example.com/gadget.jpg' }),
  bcRow({ 'Item Type': 'SKU', 'Product Code/SKU': 'GAD-1-BLK', 'Stock Level': '11' }),
  bcRow({ 'Item Type': 'Rule', 'Product Code/SKU': 'GAD-1-BLK', Price: '47.00' }),
].join('\n');

test('bigcommerce reader: Legacy product, SKU row and Rule row merged', () => {
  const { products } = readFixture('bigcommerce', BC_LEGACY);
  assert.strictEqual(products.length, 1);
  const p = products[0];
  assert.strictEqual(p.vendor, 'GadgetCo');
  assert.deepStrictEqual(p.categoryPaths, ['Tech', 'Gadgets']);
  assert.ok(p.variants.some((v) => v.sku === 'GAD-1-BLK'));
});

const MAGENTO = [
  'sku,store_view_code,attribute_set_code,product_type,categories,name,description,price,special_price,qty,product_online,url_key,weight,base_image,additional_images,_super_products_sku,_super_attribute_code,additional_attributes',
  'SHIRT-BLUE-S,,"Default",simple,"Default Category/Apparel,Default Category/Apparel/Shirts",Oxford Shirt Blue S,,22.00,,3,1,oxford-shirt-blue-s,0.2,/shirt-blue.jpg,,,"","color=Blue,size=S"',
  'SHIRT-BLUE-M,,"Default",simple,"Default Category/Apparel",Oxford Shirt Blue M,,22.00,,5,1,oxford-shirt-blue-m,0.21,/shirt-blue.jpg,,,"","color=Blue,size=M"',
  'SHIRT-CONF,,"Default",configurable,"Default Category/Apparel",Oxford Shirt,,25.00,,0,1,oxford-shirt,,"/shirt.jpg",,"SHIRT-BLUE-S, SHIRT-BLUE-M","color,size",""',
].join('\n');

test('magento reader: configurable reconstructed from simple children', () => {
  const { products } = readFixture('magento', MAGENTO);
  const conf = products.find((p) => p.title === 'Oxford Shirt');
  assert.ok(conf, 'configurable present');
  assert.strictEqual(conf.variants.length, 2);
  assert.deepStrictEqual(conf.options.map((o) => o.name), ['color', 'size']);
  assert.strictEqual(conf.variants[0].optionValues.color, 'Blue');
  assert.strictEqual(products.filter((p) => p.title.startsWith('Oxford Shirt Blue')).length, 0);
  assert.ok(conf.images.some((i) => i.url === '/shirt-blue.jpg'));
  assert.ok(conf.images.some((i) => i.url === '/shirt.jpg'));
});
