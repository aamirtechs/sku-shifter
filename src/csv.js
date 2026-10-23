'use strict';

// Robust CSV / TSV engine.
// Reading: BOM stripping, delimiter sniffing (comma, semicolon, tab),
// quote-aware parsing (embedded commas, doubled quotes, embedded newlines),
// UTF-8 decoding with an ISO-8859-1 fallback for legacy files (PrestaShop era).
// Writing: quote-when-needed with doubled internal quotes, per-target delimiter and EOL.

function decodeInput(input) {
  if (typeof input === 'string') {
    return input.charCodeAt(0) === 0xfeff ? input.slice(1) : input;
  }
  const buf = (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) ? input : new Uint8Array(input);
  let start = 0;
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) start = 3;
  const slice = buf.subarray(start);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(slice);
  } catch (e) {
    return new TextDecoder('iso-8859-1').decode(slice);
  }
}

function sniffDelimiter(text) {
  // Look at the first non-empty line, counting candidate delimiters outside quotes.
  const lines = text.split(/\r\n|\r|\n/);
  for (const line of lines) {
    if (!line.trim()) continue;
    const counts = { ',': 0, ';': 0, '\t': 0 };
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') i++;
        else inQuotes = !inQuotes;
      } else if (!inQuotes && counts[ch] !== undefined) counts[ch]++;
    }
    let best = ',';
    for (const d of [';', '\t', ',']) if (counts[d] > counts[best]) best = d;
    return best;
  }
  return ',';
}

function parseRows(text, delimiter) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  let fieldStarted = false;
  const pushField = () => { row.push(field); field = ''; fieldStarted = false; };
  const pushRow = () => { pushField(); rows.push(row); row = []; };
  let i = 0;
  const s = text;
  while (i < s.length) {
    const ch = s[i];
    if (inQuotes) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i += 2; continue; }
        inQuotes = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && !fieldStarted && field === '') { inQuotes = true; fieldStarted = true; i++; continue; }
    if (ch === delimiter) { pushField(); i++; continue; }
    if (ch === '\r') { if (s[i + 1] === '\n') i++; pushRow(); i++; continue; }
    if (ch === '\n') { pushRow(); i++; continue; }
    field += ch; fieldStarted = true; i++;
  }
  if (field !== '' || row.length > 0 || fieldStarted) pushRow();
  // Drop fully empty trailing rows.
  while (rows.length && rows[rows.length - 1].every((c) => c === '')) rows.pop();
  return rows;
}

// Parse delimited text into { headers, rows, delimiter }.
// rows are objects keyed by trimmed header names; __line holds the 1-based source line (approx: record number + 1).
function parseTable(input, options = {}) {
  const text = decodeInput(input);
  const delimiter = options.delimiter || sniffDelimiter(text);
  const raw = parseRows(text, delimiter);
  if (!raw.length) return { headers: [], rows: [], delimiter };
  const headers = raw[0].map((h) => String(h).trim());
  const rows = [];
  for (let r = 1; r < raw.length; r++) {
    const cells = raw[r];
    if (cells.every((c) => String(c).trim() === '')) continue;
    const obj = { __record: r + 1 };
    headers.forEach((h, idx) => { obj[h] = cells[idx] !== undefined ? cells[idx] : ''; });
    rows.push(obj);
  }
  return { headers, rows, delimiter };
}

function escapeField(value, delimiter) {
  const s = value === null || value === undefined ? '' : String(value);
  if (s.includes(delimiter) || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
}

// rows: array of arrays. Options: delimiter, eol.
function stringifyTable(rows, options = {}) {
  const delimiter = options.delimiter || ',';
  const eol = options.eol || '\n';
  return rows.map((r) => r.map((c) => escapeField(c, delimiter)).join(delimiter)).join(eol) + eol;
}

module.exports = { decodeInput, sniffDelimiter, parseTable, stringifyTable };
