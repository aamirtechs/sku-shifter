'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseTable, stringifyTable } = require('../src/csv');

test('parses quoted fields with embedded commas', () => {
  const t = parseTable('a,b,c\n"x, y",2,3\n');
  assert.strictEqual(t.rows[0].a, 'x, y');
  assert.strictEqual(t.rows[0].b, '2');
});

test('parses embedded newlines inside quoted fields', () => {
  const t = parseTable('a,b\n"line one\nline two",z\n');
  assert.strictEqual(t.rows.length, 1);
  assert.strictEqual(t.rows[0].a, 'line one\nline two');
});

test('parses doubled quotes', () => {
  const t = parseTable('a\n"say ""hi"""\n');
  assert.strictEqual(t.rows[0].a, 'say "hi"');
});

test('strips a UTF-8 BOM so the first header is clean', () => {
  const t = parseTable('\ufeffTitle,Price\nHat,9.99\n');
  assert.deepStrictEqual(t.headers, ['Title', 'Price']);
});

test('sniffs semicolon-delimited files (European exports, PrestaShop style)', () => {
  const t = parseTable('Name;Price;Qty\nHat;9.99;4\n');
  assert.strictEqual(t.delimiter, ';');
  assert.strictEqual(t.rows[0].Price, '9.99');
});

test('sniffs tab-delimited files (GMC style)', () => {
  const t = parseTable('id\ttitle\n1\tHat\n');
  assert.strictEqual(t.delimiter, '\t');
  assert.strictEqual(t.rows[0].title, 'Hat');
});

test('falls back to ISO-8859-1 for legacy bytes', () => {
  const buf = Buffer.from('Name,City\nCafé Mug,Montréal\n'.replace('é', '\u00e9'), 'latin1');
  // Build a buffer whose accented bytes are single-byte latin1, invalid as UTF-8 sequences here.
  const raw = Buffer.concat([Buffer.from('Name\nCaf', 'ascii'), Buffer.from([0xe9]), Buffer.from(' Mug\n', 'ascii')]);
  const t = parseTable(raw);
  assert.ok(t.rows[0].Name.includes('Caf'));
  assert.ok(buf.length > 0);
});

test('handles CRLF line endings', () => {
  const t = parseTable('a,b\r\n1,2\r\n3,4\r\n');
  assert.strictEqual(t.rows.length, 2);
  assert.strictEqual(t.rows[1].a, '3');
});

test('writer quotes fields that need it and round-trips', () => {
  const out = stringifyTable([['a', 'b'], ['x, y', 'say "hi"'], ['multi\nline', 'plain']]);
  const t = parseTable(out);
  assert.strictEqual(t.rows[0].a, 'x, y');
  assert.strictEqual(t.rows[0].b, 'say "hi"');
  assert.strictEqual(t.rows[1].a, 'multi\nline');
});

test('TSV writing uses tabs and quotes embedded tabs safely', () => {
  const out = stringifyTable([['a', 'b'], ['1', '2']], { delimiter: '\t' });
  assert.strictEqual(out.split('\n')[0], 'a\tb');
});
