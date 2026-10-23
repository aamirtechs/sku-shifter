# sku-shifter

Move your product catalog between e-commerce platforms, by file. Export your products from one platform, convert the file, and import it into the other. No store logins, no accounts, no per-SKU fees, and the conversion runs entirely on your own machine.

Hosted migration services ask for your store credentials and charge per product. sku-shifter is the opposite trade: free, offline, file-in and file-out, and honest about what a file can and cannot carry. Every conversion produces a **conversion report** listing what was converted, what was transformed (and how), and every field that was dropped, with the reason. Nothing is dropped silently.

**Try it in the browser:** the web app in `docs/` runs 100 percent locally. Your file never leaves your device. (Live on GitHub Pages once this repo is published.)

## Supported platforms

| Platform | Read (source) | Write (target) | Notes |
|---|---|---|---|
| Shopify | Yes | Yes | Both header generations read (current `URL handle` / `Price` / `Barcodes` and legacy `Handle` / `Variant Price` / `Image Src`); current generation written |
| WooCommerce | Yes | Yes | Variable products and variations; parent row written before its variations |
| Wix | Yes | Yes | PRODUCT, VARIANT and MEDIA rows; up to 6 options |
| Squarespace | Yes | Not in v1 | Squarespace CSV cannot set featured or variant images, so a writer would promise imports that arrive without images |
| Etsy | Yes | Never | Etsy has no native listing CSV import. Its shop download is export-only, so Etsy is a source, not a target |
| BigCommerce | Yes | Not in v1 | Both Modern and Legacy generations read. A writer is blocked by numeric category and brand IDs that a file cannot supply |
| Magento / Adobe Commerce | Yes | Not in v1 | Simple and configurable products read (configurables rebuilt from their simple products). Writer deferred: Magento images are local file paths and attribute sets are store-specific |
| Google Merchant Center | Feed only | Yes | Tab-delimited feed. Needs your store base URL and a currency, asked at conversion time and never invented |
| PrestaShop | Not in v1 | Not in v1 | Products and combinations are two separate import files and categories are numeric IDs. Planned as a two-file writer |
| OpenCart | Not in v1 | Not in v1 | OpenCart core has no product CSV. Its de-facto Export/Import Tool is multi-sheet XLSX |
| eBay | Not in v1 | Not in v1 | eBay bulk files are category-template listing files with numeric category IDs, not catalog files |

## Install

Requires Node.js 20 or newer. Zero dependencies.

```bash
git clone https://github.com/aamirtechs/sku-shifter.git
cd sku-shifter
node bin/cli.js platforms
```

Or use it as a library:

```js
const { convertFile } = require('./src');
const result = convertFile(fileBuffer, { from: 'shopify', to: 'woocommerce' });
console.log(result.output);     // the converted file contents
console.log(result.reportText); // the human-readable conversion report
```

## Usage

### CLI

```bash
# Shopify export to a WooCommerce import file
node bin/cli.js convert --from shopify --to woocommerce products.csv -o woo-products.csv

# Any source to a Google Merchant Center feed (base URL and currency are required)
node bin/cli.js convert --to gmc products.csv --base-url https://your-store.com --currency USD

# Source platform is auto-detected from the headers when --from is omitted
node bin/cli.js convert --to shopify exports.csv
```

Options: `--report <file>` (default `<output>.report.md`), `--no-report`, `--source-weight-unit <g|kg|lb|oz>`, `--target-weight-unit <g|kg|lb|oz>`.

### Real example

Input, the first rows of `examples/shopify-sample.csv` (a tee with two variants on sale, plus an extra back-view image row):

```csv
Title,URL handle,Description,Vendor,Product category,Type,Tags,Published on online store,Status,SKU,Barcodes,Option1 name,Option1 value,Option2 name,Option2 value,Price,Compare-at price,...
Everyday Cotton Tee,everyday-cotton-tee,"<p>Soft combed cotton tee, pre-shrunk and garment dyed.</p>",Northwind Supply,Apparel > Clothing > T-Shirts,T-Shirts,"cotton, basics, summer",true,active,TEE-BLK-M,012345678905,Size,M,Color,Black,24.99,34.99,...
```

Running `node bin/cli.js convert --from shopify --to woocommerce examples/shopify-sample.csv` prints:

```text
Converted 2 products, 3 variants, 4 rows written.
Fields dropped with reasons: 5 (see the report)
```

and the report explains exactly what happened:

```text
## Transforms applied
- Shopify "Product category" (Shopify standard taxonomy) carried as a category path.
- Weights written in kg (the target store unit option, default kg).

## Fields dropped (nothing is dropped silently)
- Everyday Cotton Tee: vendor / brand dropped. WooCommerce core product CSV has no brand column.
- Everyday Cotton Tee: SEO title and description dropped. WooCommerce core CSV has no SEO columns.
- Everyday Cotton Tee: image alt text dropped. The WooCommerce core importer cannot set image alt text.
```

Note the price rule at work: Shopify stores the selling price in `Price` (24.99) and the original in `Compare-at price` (34.99). The WooCommerce output carries `Regular price` 34.99 and `Sale price` 24.99. Copying `Price` into `Regular price` directly would silently turn every sale product into a full-price product, which is the classic bug in hand-rolled converters.

### Web app

Open `docs/index.html` (after `npm run build:web`, which bundles `src/` into `docs/app.js`). Pick the file, the source and target platforms, add the base URL and currency when the target is Merchant Center, and download the converted file plus the report. Everything runs in the page; nothing is uploaded.

## How it works

```text
file in -> Reader (per platform) -> Canonical product model -> Writer (per platform) -> file out
                                        |
                                        +-> Conversion report (drops, transforms, warnings)
```

The canonical model stores price as a triple (regular, sale, compareAt) because no two platforms model sales the same way, weight as value plus unit because Shopify stores integer grams while most others store bare numbers in a store-level unit, and variants as option-value tuples that each reader reconstructs from its platform's row model (grouped handle rows, parent/variation links, typed rows, or configurable products and their children).

The CSV engine strips BOMs, sniffs the delimiter (comma, semicolon or tab), handles quoted fields with embedded commas and newlines, and falls back to ISO-8859-1 for legacy files.

## Honest limitations

- **Images are references, not files.** Product files carry image URLs (or, for Magento, relative file paths). This tool carries the references across and never downloads, re-hosts or uploads images. Import your target store while the source store is still live so the target can fetch the images. Squarespace is the sharpest case: its CSV marks the hosted image URL as not editable and imports arrive without a featured image, which is why Squarespace is read-only here.
- **Category IDs cannot be invented.** BigCommerce (Modern), PrestaShop and eBay key categories by numeric IDs that exist only inside your target store. BigCommerce Modern exports therefore arrive with category IDs that the reader reports but cannot turn back into names.
- **Weights in bare-number platforms need a declared unit.** WooCommerce, Wix, BigCommerce, Magento and Squarespace files store weight as a bare number in a store-level unit the file does not state. The reader assumes a unit (default per platform, shown in the report) and you can override it. Shopify grams are exact.
- **Option limits differ.** Shopify and Squarespace allow 3 options, Wix allows 6, WooCommerce is unbounded. Converting a 4+ option product into Shopify writes the first 3 options and lists the affected products in a loud warning. Nothing is silently dropped.
- **Prices are numbers, not accounting.** Prices are copied in the source store's currency and tax setting. Only the Merchant Center writer adds a currency, and only the one you supply.
- **Import size limits belong to the platforms.** BigCommerce caps files at 20 MB, Squarespace at 10,000 products and 250 variants per product, Wix at 50,000 products. Split very large outputs before importing.
- **Squarespace column order.** Squarespace instructs users to preserve its template structure; this reader matches columns by header name, which is order-proof. The exact tail column order of the official template could not be verified from published text, so no writer order is claimed.
- **BigCommerce Modern Options encoding.** The Options cell on variant rows uses BigCommerce's complex-attributes string format. This reader parses the common name=value and name:value pair forms and keeps the raw value with a warning when a cell does not parse.

## Roadmap

- Magento writer (with the image-path hosting step made explicit)
- PrestaShop writer (products file plus combinations file plus a companion category import)
- BigCommerce writer (Legacy format first, where categories and brands are names)
- XLSX support for the OpenCart Export/Import Tool layout
- eBay writer with category ID mapping

## Tests

```bash
npm test
```

Suites cover the CSV engine (quoting, embedded newlines, BOM, semicolon and tab sniffing, ISO-8859-1 fallback), every reader against a synthetic export fixture, every writer's required columns, and full round trips (Shopify to Woo to Shopify, Woo to Shopify to Woo) preserving titles, prices under the price rule, SKUs, variant structure, quantities and images.

## License

MIT, Copyright 2026 Amir Hussain. See LICENSE.
