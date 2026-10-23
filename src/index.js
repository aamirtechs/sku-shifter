'use strict';

const { parseTable, stringifyTable } = require('./csv');
const model = require('./model');
const convert = require('./convert');

module.exports = {
  convertFile: convert.convertFile,
  detectFormat: convert.detectFormat,
  PLATFORMS: convert.PLATFORMS,
  readers: convert.readers,
  writers: convert.writers,
  parseTable,
  stringifyTable,
  model,
};
