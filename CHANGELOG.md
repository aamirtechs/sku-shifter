# Changelog

## 1.0.0, 2026-10-23

Initial release.

- Canonical product model with per-platform reader and writer adapters.
- Readers: Shopify (current and legacy headers), WooCommerce, Wix, Squarespace, Etsy (export only, Etsy has no native CSV import), BigCommerce (Modern and Legacy generations), Magento (simple and configurable products).
- Writers: Shopify, WooCommerce, Wix, Google Merchant Center (TSV feed).
- Robust CSV engine: BOM stripping, delimiter sniffing (comma, semicolon, tab), quoted fields with embedded commas and newlines, UTF-8 with ISO-8859-1 fallback.
- First-class conversion report on every run: products and variants converted, rows written, every dropped field with a reason, every transform and warning.
- Three interfaces over the same code: Node library, CLI, and a 100 percent local browser app in docs/.
- Not in v1 (see README roadmap): Magento writer, eBay writer, OpenCart (its ecosystem is XLSX based), PrestaShop two-file writer.
