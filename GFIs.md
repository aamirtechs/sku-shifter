# Good first issues

## 1. Magento writer

**Labels:** enhancement, adapter
**Scope:** Add `src/writers/magento.js`. Explode canonical variants into child simple products plus a configurable parent, using `_super_products_sku` and `_super_attribute_code`, attributes in `additional_attributes`. The hard part is honesty, not code: Magento images are relative file paths and imports expect files under `var/import/images`. The conversion report must state that remote image URLs are written as paths only when a base media path option is supplied, and list every image that will need a manual step. Round-trip test against the existing Magento reader fixture.

## 2. PrestaShop two-file writer

**Labels:** enhancement, adapter
**Scope:** Add `src/writers/prestashop.js` emitting three semicolon-delimited files: a category import (so category IDs exist), a products file using the official sample headers, and a combinations file keyed by product reference, with variant prices converted to price impacts (`impact = variant price - base price`) and the impact model flagged in the report when the base price is not the first variant's price. Tax rule ID must be an explicit option, never a default guess.

## 3. XLSX support for the OpenCart Export/Import Tool

**Labels:** enhancement, format
**Scope:** OpenCart core has no product CSV; its de-facto standard is the JNeuhoff Export/Import Tool, a multi-sheet XLSX. Add a minimal XLSX reader (zip plus sheet XML parsing, no heavy dependency, or a documented optional one) for the Products sheet matched by header name, and a reader adapter `src/readers/opencart.js`. `model` is OpenCart's admin-required key and option prices are deltas: both must be handled explicitly in the reader and the report.

## 4. eBay writer with category ID mapping

**Labels:** enhancement, adapter
**Scope:** Add `src/writers/ebay.js` producing a Seller Hub Reports listing file: `Action`, `Category ID`, `Custom Label (SKU)`, `Title`, `Relationship`, `Relationship Details`, `P:UPC`, `Start Price`, `Quantity`, `Item Photo URL`. Category IDs cannot come from a product file, so the writer needs a category mapping option (name to ID, supplied as a small CSV or JSON) and must stop with the unmapped categories listed when the mapping is missing. Titles truncate at 80 characters with per-product warnings.

## 5. BigCommerce Legacy writer

**Labels:** enhancement, adapter
**Scope:** Add `src/writers/bigcommerce.js` targeting the Legacy format first (categories and brands are names there, so a file-only conversion can actually complete). Modern output can follow once a category and brand ID mapping option exists. Legacy variants need the SKU row plus Rule row pair written in the right order under each product row.

## 6. Output auto-split by target size limits

**Labels:** enhancement, core
**Scope:** Writers currently emit one file. Add an option to split outputs at target limits (BigCommerce 20 MB, Squarespace 10,000 products, Wix 50,000 products) into numbered files, keeping each product's rows together, with the split listed in the conversion report.
