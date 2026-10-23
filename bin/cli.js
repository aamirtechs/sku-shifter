#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { convertFile, PLATFORMS } = require('../src/index');

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) { args[key] = argv[++i]; }
      else args[key] = true;
    } else if (a === '-o') {
      args.output = argv[++i];
    } else args._.push(a);
  }
  return args;
}

function usage() {
  console.log(`sku-shifter: offline product catalog file converter

Usage:
  sku-shifter platforms
  sku-shifter convert --from <platform> --to <platform> <input file> [options]

Options:
  -o, --output <file>          Output file (default: converted-<from>-to-<to>.<ext> in the current folder)
  --report <file>              Conversion report file (default: <output>.report.md). Use --no-report to skip.
  --base-url <url>             Store base URL. Required for Google Merchant Center output (link building).
  --currency <code>            Currency code, for example USD. Required for Google Merchant Center output.
  --source-weight-unit <unit>  Assumed unit for bare-number source weights (g, kg, lb, oz).
  --target-weight-unit <unit>  Unit written to targets with bare-number weights (default kg).

Platforms: shopify, woocommerce, wix, squarespace, etsy, bigcommerce, magento, gmc.
Run "sku-shifter platforms" for the reader and writer matrix.`);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const cmd = args._[0];
  if (!cmd || cmd === 'help' || args.help) { usage(); return; }
  if (cmd === 'platforms') {
    console.log('Platform        Reader  Writer  Notes');
    for (const p of PLATFORMS) {
      console.log(`${p.name.padEnd(28)}${(p.reader ? 'yes' : 'no').padEnd(8)}${(p.writer ? 'yes' : 'no').padEnd(8)}${p.note}`);
    }
    return;
  }
  if (cmd === 'convert') {
    const input = args._[1];
    if (!input || !args.to) { usage(); process.exit(2); }
    const buf = fs.readFileSync(input);
    const options = {
      from: args.from,
      to: args.to,
      baseUrl: args['base-url'],
      currency: args.currency,
      sourceWeightUnit: args['source-weight-unit'],
      targetWeightUnit: args['target-weight-unit'],
    };
    let result;
    try {
      result = convertFile(buf, options);
    } catch (e) {
      console.error('Conversion stopped: ' + e.message);
      process.exit(1);
    }
    const outPath = args.output || args.o || result.outputName;
    fs.writeFileSync(outPath, result.output, 'utf8');
    let reportPath = null;
    if (!args['no-report']) {
      reportPath = typeof args.report === 'string' ? args.report : outPath + '.report.md';
      fs.writeFileSync(reportPath, result.reportText, 'utf8');
    }
    console.log(`Converted ${result.report.products} products, ${result.report.variants} variants, ${result.report.rowsWritten} rows written.`);
    console.log(`Output: ${path.resolve(outPath)}`);
    if (reportPath) console.log(`Report: ${path.resolve(reportPath)}`);
    if (result.report.warnings.length) console.log(`Warnings: ${result.report.warnings.length} (see the report)`);
    if (result.report.dropped.length) console.log(`Fields dropped with reasons: ${result.report.dropped.length} (see the report)`);
    return;
  }
  usage();
  process.exit(2);
}

main();
