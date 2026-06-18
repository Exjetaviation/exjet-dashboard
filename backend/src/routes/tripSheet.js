// backend/src/routes/tripSheet.js
// Authenticated crew Trip Sheet (Flight Release). PII-bearing, so mounted UNDER the
// /api auth guard (NOT public like /itinerary). The backend builds the view-model from
// LevelFlight's /release JSON and renders branded HTML/PDF — the frontend only ever
// receives the finished document.
import express from 'express';
import { buildCrewTripSheet } from '../services/tripSheet.js';
import { renderTripSheetHtml } from '../services/tripSheetHtml.js';
import { renderQuotePdf } from '../services/quotePdf.js';

const router = express.Router();

// GET /api/tripsheet/:id — rendered trip-sheet HTML for the in-dashboard modal view.
router.get('/:id', async (req, res) => {
  try {
    const vm = await buildCrewTripSheet(req.params.id);
    if (!vm) return res.status(404).send('Trip sheet not available for this trip yet');
    res.type('html').send(renderTripSheetHtml(vm, { print: false }));
  } catch (e) { res.status(502).send('Error building trip sheet'); }
});

// GET /api/tripsheet/:id/pdf — the rendered trip sheet printed to PDF.
router.get('/:id/pdf', async (req, res) => {
  try {
    const vm = await buildCrewTripSheet(req.params.id);
    if (!vm) return res.status(404).json({ error: 'Trip sheet not available' });
    const pdf = await renderQuotePdf(renderTripSheetHtml(vm, { print: true }), { waitForMapReady: true });
    res.type('application/pdf')
      .set('Content-Disposition', `inline; filename="Trip Sheet ${vm.tripNumber || req.params.id}.pdf"`)
      .send(pdf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
