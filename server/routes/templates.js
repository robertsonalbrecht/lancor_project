'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');
const router = express.Router();

const VALID_TYPES = ['boolean_strings', 'pitchbook_params', 'outreach_messages', 'ideal_candidate_profiles', 'screen_question_guides'];

// Map URL segment to JSON key
const TYPE_MAP = {
  'boolean':    'boolean_strings',
  'pitchbook':  'pitchbook_params',
  'outreach':   'outreach_messages',
  'profile':    'ideal_candidate_profiles',
  'screen':     'screen_question_guides'
};

function templatesFile() {
  return path.join(process.env.DATA_PATH, 'search_templates.json');
}

function readData() {
  return JSON.parse(fs.readFileSync(templatesFile(), 'utf8'));
}
function writeData(data) {
  fs.writeFileSync(templatesFile(), JSON.stringify(data, null, 2), 'utf8');
}

function resolveType(typeParam) {
  return TYPE_MAP[typeParam] || (VALID_TYPES.includes(typeParam) ? typeParam : null);
}

// GET /api/templates — return all templates
router.get('/', (req, res) => {
  try {
    res.json(readData());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/templates/:type — add template
router.post('/:type', (req, res) => {
  try {
    const typeKey = resolveType(req.params.type);
    if (!typeKey) return res.status(400).json({ error: `Invalid template type. Valid types: ${Object.keys(TYPE_MAP).join(', ')}` });

    const data = readData();
    const newTemplate = Object.assign({
      id: `${typeKey}-${Date.now()}`,
      created_date: new Date().toISOString().slice(0, 10)
    }, req.body);

    data.templates[typeKey].push(newTemplate);
    writeData(data);
    res.status(201).json(newTemplate);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/templates/:type/:id — update template
router.put('/:type/:id', (req, res) => {
  try {
    const typeKey = resolveType(req.params.type);
    if (!typeKey) return res.status(400).json({ error: 'Invalid template type' });

    const data = readData();
    const idx = data.templates[typeKey].findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Template not found' });

    data.templates[typeKey][idx] = Object.assign({}, data.templates[typeKey][idx], req.body, { id: req.params.id });
    writeData(data);
    res.json(data.templates[typeKey][idx]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/templates/:type/:id — delete template
router.delete('/:type/:id', (req, res) => {
  try {
    const typeKey = resolveType(req.params.type);
    if (!typeKey) return res.status(400).json({ error: 'Invalid template type' });

    const data = readData();
    const idx = data.templates[typeKey].findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ error: 'Template not found' });

    const removed = data.templates[typeKey].splice(idx, 1)[0];
    writeData(data);
    res.json({ deleted: true, template: removed });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
