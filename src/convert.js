'use strict';

const { parseTable, stringifyTable } = require('./csv');
const M = require('./model');

const readers = {
  shopify: require('./readers/shopify'),
  woocommerce: require('./readers/woocommerce'),
  wix: require('./readers/wix'),
  squarespace: require('./readers/squarespace'),
  etsy: require('./readers/etsy'),
  bigcommerce: require('./readers/bigcommerce'),
  magento: require('./readers/magento'),
};

const writers = {
  shopify: require('./writers/shopify'),
  woocommerce: require('./writers/woocommerce'),
  wix: require('./writers/wix'),
  gmc: require('./writers/gmc'),
};

// Support matrix, exactly what v1 builds. Kept honest on purpose.
const PLATFORMS = [
  { id: 'shopify', name: 'Shopify', reader: true, writer: true, note: 'Full support. Both header generations read; current generation written.' },
  { id: 'woocommerce', name: 'WooCommerce', reader: true, writer: true, note: 'Full support. Variable and variation rows, parent before variations.' },
  { id: 'wix', name: 'Wix', reader: true, writer: true, note: 'Full support. PRODUCT, VARIANT and MEDIA rows.' },
  { id: 'squarespace', name: 'Squarespace', reader: true, writer: false, note: 'Reader only in v1. Squarespace CSV cannot set featured or variant images, so a writer would promise imports that arrive without images.' },
  { id: 'etsy', name: 'Etsy', reader: true, writer: false, note: 'Reader only, permanently. Etsy has no native listing CSV import; its download is export-only.' },
  { id: 'bigcommerce', name: 'BigCommerce', reader: true, writer: false, note: 'Reader only in v1, both Modern and Legacy generations. A writer is blocked by numeric category and brand IDs that a file cannot supply.' },
  { id: 'magento', name: 'Magento / Adobe Commerce', reader: true, writer: false, note: 'Reader only in v1. Writer deferred: Magento images are local file paths and attribute sets are store-specific.' },
  { id: 'gmc', name: 'Google Merchant Center', reader: false, writer: true, note: 'Writer only, permanently. A feed target, not a store. Needs your base URL and currency.' },
  { id: 'prestashop', name: 'PrestaShop', reader: false, writer: false, note: 'Not in v1. Products and combinations are two separate import files and categories are numeric IDs; planned as a two-file writer.' },
  { id: 'opencart', name: 'OpenCart', reader: false, writer: false, note: 'Not in v1. OpenCart core has no product CSV; its de-facto Export/Import Tool is multi-sheet XLSX.' },
  { id: 'ebay', name: 'eBay', reader: false, writer: false, note: 'Not in v1. eBay bulk files are category-template listing files with numeric category IDs, not catalog files.' },
];

function detectFormat(table) {
  for (const id of Object.keys(readers)) {
    if (readers[id].detect(table.headers)) return id;
  }
  return null;
}

// input: string or Buffer of the source file.
// options: { from, to, baseUrl, currency, sourceWeightUnit, targetWeightUnit }
// Returns { output (string), outputName, report, reportText, products }.
function convertFile(input, options = {}) {
  const table = parseTable(input, {});
  if (!table.headers.length) throw new Error('The input file appears empty or has no header row.');
  const from = options.from || detectFormat(table);
  if (!from) throw new Error('Could not detect the source platform from the file headers. Pass --from with one of: ' + Object.keys(readers).join(', '));
  if (!readers[from]) throw new Error(`No reader for "${from}". Readers in v1: ${Object.keys(readers).join(', ')}`);
  const to = options.to;
  if (!to || !writers[to]) throw new Error(`No writer for "${to}". Writers in v1: ${Object.keys(writers).join(', ')}`);

  const report = M.createReport(readers[from].name, writers[to].name);
  const ctx = { report, options };
  const products = readers[from].read(table, ctx);
  const rows = writers[to].write(products, ctx);
  const output = stringifyTable(rows, { delimiter: writers[to].delimiter, eol: '\n' });

  report.products = products.length;
  report.variants = products.reduce((n, p) => n + p.variants.length, 0);
  report.images = products.reduce((n, p) => n + p.images.length, 0);
  report.rowsWritten = rows.length - 1;
  // Materials have no home on any v1 target; record once per affected product if not already recorded.
  for (const p of products) {
    if (p.extras && p.extras.materials && to !== 'woocommerce') {
      // WooCommerce writer already records materials; avoid duplicates there.
      if (!report.dropped.some((d) => d.product === p.title && d.field === 'materials')) {
        M.repDrop(report, p.title, 'materials', `${writers[to].name} product files have no materials field.`);
      }
    }
  }
  return {
    output,
    outputName: `converted-${from}-to-${to}.${writers[to].extension}`,
    report,
    reportText: M.renderReport(report),
    products,
  };
}

module.exports = { readers, writers, PLATFORMS, detectFormat, convertFile };
