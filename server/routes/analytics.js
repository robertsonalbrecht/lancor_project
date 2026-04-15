'use strict';

const express = require('express');
const router  = express.Router();
const pool    = require('../db');

// ── GET /api/analytics/overview ─────────────────────────────────────────────

router.get('/overview', async (req, res) => {
  try {
    const [totalReviewed, activePipeline, firmsCovered, byArchetype, byStage] =
      await Promise.all([
        pool.query(`SELECT COUNT(DISTINCT candidate_id)::int AS cnt FROM search_pipeline`)
          .then(r => r.rows[0].cnt).catch(() => null),

        pool.query(
          `SELECT COUNT(DISTINCT sp.candidate_id)::int AS cnt
           FROM search_pipeline sp JOIN searches s ON s.id = sp.search_id
           WHERE s.status IN ('active','open')
             AND sp.stage NOT IN ('DQ','DQ/Not Interested','NI')`
        ).then(r => r.rows[0].cnt).catch(() => null),

        pool.query(`SELECT COUNT(DISTINCT company_id)::int AS cnt FROM search_coverage_firms`)
          .then(r => r.rows[0].cnt).catch(() => null),

        pool.query(
          `SELECT COALESCE(archetype, 'Untagged') AS archetype, COUNT(*)::int AS cnt
           FROM search_pipeline GROUP BY archetype ORDER BY cnt DESC`
        ).then(r => r.rows).catch(() => null),

        pool.query(
          `SELECT COALESCE(stage, 'Unknown') AS stage, COUNT(*)::int AS cnt
           FROM search_pipeline GROUP BY stage ORDER BY cnt DESC`
        ).then(r => r.rows).catch(() => null)
      ]);

    res.json({
      total_reviewed: totalReviewed,
      active_pipeline: activePipeline,
      firms_covered: firmsCovered,
      by_archetype: byArchetype,
      by_stage: byStage
    });
  } catch (err) {
    console.error('Analytics overview error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/analytics/geography ────────────────────────────────────────────

router.get('/geography', async (req, res) => {
  try {
    const { rows } = await pool.query(`
      SELECT
        TRIM(SPLIT_PART(sp.location, ',', 2)) AS state,
        sp.stage AS stage_reached,
        COUNT(*)::int AS cnt
      FROM search_pipeline sp
      WHERE sp.location IS NOT NULL AND sp.location != ''
        AND TRIM(SPLIT_PART(sp.location, ',', 2)) != ''
      GROUP BY state, sp.stage
      ORDER BY cnt DESC
    `);

    // Aggregate by state with stage breakdown
    const stateMap = {};
    for (const r of rows) {
      if (!stateMap[r.state]) {
        stateMap[r.state] = { state: r.state, total: 0, stages: {} };
      }
      stateMap[r.state].total += r.cnt;
      stateMap[r.state].stages[r.stage_reached || 'Unknown'] =
        (stateMap[r.state].stages[r.stage_reached || 'Unknown'] || 0) + r.cnt;
    }

    const states = Object.values(stateMap)
      .sort((a, b) => b.total - a.total);

    res.json({ states });
  } catch (err) {
    console.error('Analytics geography error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/analytics/firms ────────────────────────────────────────────────

router.get('/firms', async (req, res) => {
  try {
    const [firmCoverage, pipelineCounts] = await Promise.all([
      // Firms from coverage + roster counts
      pool.query(`
        SELECT
          scf.company_id,
          scf.name AS firm_name,
          scf.size_tier AS firm_tier,
          COUNT(DISTINCT fr.id)::int AS total_identified
        FROM search_coverage_firms scf
        LEFT JOIN firm_roster fr ON fr.company_id = scf.company_id
        GROUP BY scf.company_id, scf.name, scf.size_tier
        ORDER BY scf.name
      `).then(r => r.rows).catch(() => null),

      // Pipeline entries per firm (candidates whose current_firm matches)
      pool.query(`
        SELECT
          sp.current_firm,
          sp.stage,
          COUNT(*)::int AS cnt
        FROM search_pipeline sp
        WHERE sp.current_firm IS NOT NULL AND sp.current_firm != ''
        GROUP BY sp.current_firm, sp.stage
      `).then(r => r.rows).catch(() => null)
    ]);

    if (!firmCoverage) {
      return res.json({ firms: null });
    }

    // Build pipeline lookup by firm name (case-insensitive)
    const pipelineByFirm = {};
    if (pipelineCounts) {
      for (const r of pipelineCounts) {
        const key = r.current_firm.toLowerCase();
        if (!pipelineByFirm[key]) pipelineByFirm[key] = { total: 0, stages: {} };
        pipelineByFirm[key].total += r.cnt;
        pipelineByFirm[key].stages[r.stage] = (pipelineByFirm[key].stages[r.stage] || 0) + r.cnt;
      }
    }

    const firms = firmCoverage.map(f => {
      const pip = pipelineByFirm[f.firm_name.toLowerCase()] || { total: 0, stages: {} };
      const reviewed = f.total_identified;
      const inPipeline = pip.total;
      const yieldRate = reviewed > 0 ? Math.round((inPipeline / reviewed) * 100) : 0;

      return {
        firm_name: f.firm_name,
        firm_tier: f.firm_tier,
        total_identified: reviewed,
        total_in_pipeline: inPipeline,
        pipeline_stages: pip.stages,
        yield_rate: yieldRate
      };
    });

    // Deduplicate by firm name (coverage may have multiple entries per search)
    const deduped = {};
    for (const f of firms) {
      const key = f.firm_name.toLowerCase();
      if (!deduped[key] || f.total_identified > deduped[key].total_identified) {
        deduped[key] = f;
      }
    }

    res.json({
      firms: Object.values(deduped).sort((a, b) => b.yield_rate - a.yield_rate)
    });
  } catch (err) {
    console.error('Analytics firms error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/analytics/export/candidates ────────────────────────────────────

router.get('/export/candidates', async (req, res) => {
  try {
    const ExcelJS = require('exceljs');
    const { search_id, date_from, date_to, stage, archetype } = req.query;

    const conditions = [];
    const params = [];
    let p = 0;

    if (search_id) {
      conditions.push(`s.slug = $${++p}`);
      params.push(search_id);
    }
    if (date_from) {
      conditions.push(`sp.date_added >= $${++p}`);
      params.push(date_from);
    }
    if (date_to) {
      conditions.push(`sp.date_added <= $${++p}`);
      params.push(date_to);
    }
    if (stage) {
      conditions.push(`sp.stage = $${++p}`);
      params.push(stage);
    }
    if (archetype) {
      conditions.push(`sp.archetype = $${++p}`);
      params.push(archetype);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const { rows } = await pool.query(`
      SELECT
        sp.name, sp.current_firm, sp.current_title, sp.archetype,
        sp.location AS home_location, sp.linkedin_url,
        s.client_name || ' — ' || s.role_title AS search_name,
        sp.stage, sp.date_added, sp.screen_date, sp.dq_reason, sp.notes,
        (SELECT COUNT(*)::int FROM pipeline_client_meetings pcm
         WHERE pcm.pipeline_entry_id = sp.id) AS client_meeting_count
      FROM search_pipeline sp
      JOIN searches s ON s.id = sp.search_id
      ${where}
      ORDER BY s.client_name, sp.stage, sp.name
    `, params);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Candidate Review Log');

    ws.columns = [
      { header: 'Name', key: 'name', width: 25 },
      { header: 'Current Firm', key: 'current_firm', width: 25 },
      { header: 'Current Title', key: 'current_title', width: 30 },
      { header: 'Archetype', key: 'archetype', width: 18 },
      { header: 'Location', key: 'home_location', width: 25 },
      { header: 'LinkedIn', key: 'linkedin_url', width: 40 },
      { header: 'Search', key: 'search_name', width: 30 },
      { header: 'Stage', key: 'stage', width: 18 },
      { header: 'Date Added', key: 'date_added', width: 14 },
      { header: 'Screen Date', key: 'screen_date', width: 14 },
      { header: 'DQ Reason', key: 'dq_reason', width: 25 },
      { header: 'Notes', key: 'notes', width: 40 },
      { header: 'Client Meetings', key: 'client_meeting_count', width: 16 }
    ];

    // Style header row
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: 'FF6B2D5B' }
    };
    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

    for (const row of rows) {
      ws.addRow({
        ...row,
        date_added: row.date_added ? new Date(row.date_added).toLocaleDateString() : '',
        screen_date: row.screen_date ? new Date(row.screen_date).toLocaleDateString() : ''
      });
    }

    const today = new Date().toISOString().split('T')[0];
    const filename = `lancor-candidate-export-${today}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Candidate export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/analytics/export/coverage ──────────────────────────────────────

router.get('/export/coverage', async (req, res) => {
  try {
    const ExcelJS = require('exceljs');

    const { rows } = await pool.query(`
      SELECT
        co.name AS firm_name,
        co.size_tier AS tier,
        co.last_fund_size AS aum,
        COALESCE(
          (SELECT STRING_AGG(sec.slug, ', ' ORDER BY sec.slug)
           FROM company_sector_tags cst
           JOIN sectors sec ON sec.id = cst.sector_id
           WHERE cst.company_id = co.id),
          ''
        ) AS sectors,
        COUNT(DISTINCT fr.id)::int AS total_identified,
        COUNT(DISTINCT CASE WHEN fr.roster_status NOT IN ('Identified') THEN fr.id END)::int AS total_reviewed,
        COUNT(DISTINCT CASE WHEN sp.id IS NOT NULL
          AND sp.stage NOT IN ('DQ','DQ/Not Interested','NI') THEN sp.candidate_id END)::int AS in_pipeline
      FROM search_coverage_firms scf
      JOIN companies co ON co.id = scf.company_id
      LEFT JOIN firm_roster fr ON fr.company_id = co.id
      LEFT JOIN search_pipeline sp ON sp.candidate_id = fr.candidate_id
      GROUP BY co.id, co.name, co.size_tier, co.last_fund_size
      ORDER BY co.name
    `);

    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet('Coverage Summary');

    ws.columns = [
      { header: 'Firm Name', key: 'firm_name', width: 30 },
      { header: 'Tier', key: 'tier', width: 18 },
      { header: 'AUM ($M)', key: 'aum', width: 14 },
      { header: 'Sectors', key: 'sectors', width: 40 },
      { header: 'Total Identified', key: 'total_identified', width: 16 },
      { header: 'Total Reviewed', key: 'total_reviewed', width: 16 },
      { header: 'In Pipeline', key: 'in_pipeline', width: 14 },
      { header: 'Yield Rate (%)', key: 'yield_rate', width: 14 }
    ];

    ws.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    ws.getRow(1).fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: 'FF6B2D5B' }
    };

    for (const row of rows) {
      const identified = row.total_identified || 0;
      const inPipe = row.in_pipeline || 0;
      ws.addRow({
        ...row,
        yield_rate: identified > 0 ? Math.round((inPipe / identified) * 100) : 0
      });
    }

    const today = new Date().toISOString().split('T')[0];
    const filename = `lancor-coverage-export-${today}.xlsx`;

    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await wb.xlsx.write(res);
    res.end();
  } catch (err) {
    console.error('Coverage export error:', err);
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/analytics/database ─────────────────────────────────────────────

router.get('/database', async (req, res) => {
  try {
    const [
      candidateArchetypes,
      candidateGeography,
      candidateGrowth,
      candidatePipelineParticipation,
      firmTierDistribution,
      firmSectorDistribution,
      firmCoverageConfidence,
      firmCandidateDensity
    ] = await Promise.all([

      // (1) Candidate archetypes
      pool.query(
        `SELECT COALESCE(archetype, 'Untagged') AS archetype, COUNT(*)::int AS cnt
         FROM candidates GROUP BY archetype ORDER BY cnt DESC`
      ).then(r => r.rows).catch(() => null),

      // (2) Candidate geography — top 20 states
      pool.query(
        `SELECT TRIM(SPLIT_PART(home_location, ',', 2)) AS state, COUNT(*)::int AS cnt
         FROM candidates
         WHERE home_location IS NOT NULL AND home_location != ''
           AND TRIM(SPLIT_PART(home_location, ',', 2)) != ''
         GROUP BY state ORDER BY cnt DESC LIMIT 20`
      ).then(r => r.rows).catch(() => null),

      // (3) Candidate growth — per month, last 18 months
      pool.query(
        `SELECT DATE_TRUNC('month', created_at) AS month, COUNT(*)::int AS cnt
         FROM candidates
         WHERE created_at >= NOW() - INTERVAL '18 months'
         GROUP BY month ORDER BY month`
      ).then(r => r.rows).catch(() => null),

      // (4) Pipeline participation
      pool.query(
        `SELECT
           (SELECT COUNT(*)::int FROM candidates) AS total_candidates,
           (SELECT COUNT(DISTINCT candidate_id)::int FROM search_pipeline) AS ever_pipelined`
      ).then(r => r.rows[0]).catch(() => null),

      // (5) Firm tier distribution
      pool.query(
        `SELECT COALESCE(size_tier, 'Unknown') AS tier, COUNT(*)::int AS cnt
         FROM companies WHERE company_type = 'PE Firm'
         GROUP BY size_tier ORDER BY cnt DESC`
      ).then(r => r.rows).catch(() => null),

      // (6) Firm sector distribution — 12 playbook sectors
      pool.query(
        `SELECT s.slug AS sector, COUNT(DISTINCT cst.company_id)::int AS cnt
         FROM company_sector_tags cst
         JOIN sectors s ON s.id = cst.sector_id
         JOIN companies co ON co.id = cst.company_id AND co.company_type = 'PE Firm'
         GROUP BY s.slug ORDER BY cnt DESC`
      ).then(r => r.rows).catch(() => null),

      // (7) Firm coverage confidence — derived from roster/verification state
      pool.query(
        `SELECT confidence, COUNT(*)::int AS cnt FROM (
           SELECT
             CASE
               WHEN fr_stats.fr_cnt = 0 THEN 'Unsearched'
               WHEN co.roster_last_verified IS NOT NULL THEN 'High'
               WHEN fr_stats.fr_cnt >= 5 THEN 'Medium'
               ELSE 'Low'
             END AS confidence
           FROM companies co
           LEFT JOIN LATERAL (
             SELECT COUNT(*)::int AS fr_cnt FROM firm_roster fr WHERE fr.company_id = co.id
           ) fr_stats ON true
           WHERE co.company_type = 'PE Firm'
         ) sub
         GROUP BY confidence
         ORDER BY CASE confidence
           WHEN 'Unsearched' THEN 1 WHEN 'Low' THEN 2
           WHEN 'Medium' THEN 3 WHEN 'High' THEN 4 END`
      ).then(r => r.rows).catch(() => null),

      // (8) Firm candidate density — histogram buckets
      pool.query(
        `SELECT bucket, COUNT(*)::int AS cnt FROM (
           SELECT
             CASE
               WHEN cand_count = 0 THEN '0'
               WHEN cand_count BETWEEN 1 AND 2 THEN '1-2'
               WHEN cand_count BETWEEN 3 AND 5 THEN '3-5'
               WHEN cand_count BETWEEN 6 AND 10 THEN '6-10'
               ELSE '10+'
             END AS bucket
           FROM (
             SELECT co.id, COUNT(DISTINCT fr.id)::int AS cand_count
             FROM companies co
             LEFT JOIN firm_roster fr ON fr.company_id = co.id
             WHERE co.company_type = 'PE Firm'
             GROUP BY co.id
           ) firm_counts
         ) bucketed
         GROUP BY bucket
         ORDER BY CASE bucket
           WHEN '0' THEN 1 WHEN '1-2' THEN 2 WHEN '3-5' THEN 3
           WHEN '6-10' THEN 4 WHEN '10+' THEN 5 END`
      ).then(r => r.rows).catch(() => null)
    ]);

    res.json({
      candidate_archetypes: candidateArchetypes,
      candidate_geography: candidateGeography,
      candidate_growth: candidateGrowth,
      candidate_pipeline_participation: candidatePipelineParticipation,
      firm_tier_distribution: firmTierDistribution,
      firm_sector_distribution: firmSectorDistribution,
      firm_coverage_confidence: firmCoverageConfidence,
      firm_candidate_density: firmCandidateDensity
    });
  } catch (err) {
    console.error('Database analytics error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
