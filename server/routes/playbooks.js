'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

function dataFile() {
  return path.join(process.env.DATA_PATH, 'sector_playbooks.json');
}

function readData() {
  const data = JSON.parse(fs.readFileSync(dataFile(), 'utf8'));
  // Lazy migration: ensure all sectors have top_pe_firms and top_companies
  (data.sectors || []).forEach(s => {
    if (!s.top_pe_firms) s.top_pe_firms = [];
    if (!s.top_companies) s.top_companies = [];
    if (!s.target_companies) s.target_companies = [];
  });
  return data;
}

function writeData(data) {
  fs.writeFileSync(dataFile(), JSON.stringify(data, null, 2), 'utf8');
}

// GET /api/playbooks — return all sectors
router.get('/', (req, res) => {
  try {
    const data = readData();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/playbooks/:id — return single sector
router.get('/:id', (req, res) => {
  try {
    const data = readData();
    const sector = data.sectors.find(s => s.sector_id === req.params.id);
    if (!sector) return res.status(404).json({ error: 'Sector not found' });
    res.json(sector);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/playbooks — update top-level config fields (e.g. roster_titles)
router.patch('/', (req, res) => {
  try {
    const data = readData();
    Object.assign(data, req.body);
    writeData(data);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/playbooks/:id — update sector (full replacement)
router.put('/:id', (req, res) => {
  try {
    const data = readData();
    const idx = data.sectors.findIndex(s => s.sector_id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Sector not found' });
    data.sectors[idx] = Object.assign({}, data.sectors[idx], req.body, {
      sector_id: req.params.id,
      last_updated: new Date().toISOString().slice(0, 10)
    });
    writeData(data);
    res.json(data.sectors[idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
