// backend/src/routes/tripSheet.js
// Authenticated crew Trip Sheet (Flight Release). PII-bearing, so mounted UNDER the
// /api auth guard (NOT public like /itinerary). Proxies LevelFlight's release HTML and
// prints it to PDF with the existing Puppeteer renderer.
import express from 'express';
import { fetchReleaseHtml } from '../services/tripSheet.js';
import { getTripLog } from '../services/levelflight.js';
import { renderQuotePdf } from '../services/quotePdf.js';

const router = express.Router();

// GET /api/tripsheet/:id — full release HTML for the in-dashboard modal view.
router.get('/:id', async (req, res) => {
  try {
    const html = await fetchReleaseHtml(req.params.id);
    if (!html) return res.status(404).send('Trip sheet not available for this trip yet');
    res.type('html').send(html);
  } catch (e) { res.status(502).send('Error fetching trip sheet'); }
});

// GET /api/tripsheet/:id/pdf — the release printed to PDF.
router.get('/:id/pdf', async (req, res) => {
  try {
    const html = await fetchReleaseHtml(req.params.id);
    if (!html) return res.status(404).json({ error: 'Trip sheet not available' });
    let tripId = req.params.id;
    try { const tl = await getTripLog(req.params.id); if (tl?.dispatch?.tripId != null) tripId = tl.dispatch.tripId; } catch { /* fall back to id */ }
    const pdf = await renderQuotePdf(html, { waitForMapReady: false });
    res.type('application/pdf')
      .set('Content-Disposition', `inline; filename="Trip Sheet ${tripId}.pdf"`)
      .send(pdf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
