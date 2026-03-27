'use strict';

/**
 * shared.js — Shared server-side utility functions
 *
 * Used by route handlers and scripts for consistent data operations.
 */

const fs   = require('fs');
const path = require('path');

// ── Slugify ──────────────────────────────────────────────────────────────────

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60);
}

// ── Company name normalization ───────────────────────────────────────────────

function normCompanyName(s) {
  return (s || '')
    .replace(/\s*[·•]\s*(Full-time|Part-time|Contract|Freelance|Self-employed|Seasonal|Internship).*$/i, '')
    .replace(/\s*\(.*?\)\s*/g, '')
    .replace(/,?\s+(Inc\.?|LLC|LP|L\.P\.|Corp\.?|Ltd\.?|Co\.?|PLC|SA|AG|GmbH|NV|BV)\.?\s*$/i, '')
    .trim()
    .toLowerCase();
}

// ── LinkedIn company slug extraction ─────────────────────────────────────────

function extractLinkedInCompanySlug(url) {
  if (!url) return null;
  const m = url.match(/linkedin\.com\/company\/([a-zA-Z0-9_-]+)/i);
  return m ? m[1].toLowerCase() : null;
}

// ── JSON file I/O ────────────────────────────────────────────────────────────

function dataPath() {
  return process.env.DATA_PATH || path.join(__dirname, '..', '..', 'data');
}

function readJsonFile(filename) {
  const filePath = path.join(dataPath(), filename);
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function writeJsonFile(filename, data) {
  const filePath = path.join(dataPath(), filename);
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf8');
}

function jsonFilePath(filename) {
  return path.join(dataPath(), filename);
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  slugify,
  normCompanyName,
  extractLinkedInCompanySlug,
  readJsonFile,
  writeJsonFile,
  jsonFilePath,
  dataPath
};
