// backend/src/routes/publicTripSheet.js
// Web crew Trip Sheet (Flight Release) page — same access model as the public
// passenger itinerary: the 24-char dispatch id is the access token, mounted OUTSIDE
// the /api auth guard so the page opens directly in a browser tab / shareable link.
// Note: trip sheets carry crew + maintenance detail, so treat the link as sensitive.
import express from 'express';
import { buildCrewTripSheet } from '../services/tripSheet.js';
import { renderTripSheetHtml } from '../services/tripSheetHtml.js';
import { renderQuotePdf } from '../services/quotePdf.js';

const router = express.Router();

// GET /tripsheet/:id — interactive web trip sheet (with a Download PDF button).
router.get('/:id', async (req, res) => {
  try {
    const vm = await buildCrewTripSheet(req.params.id);
    if (!vm) return res.status(404).send('Trip sheet not available for this trip yet');
    vm.pdfUrl = `/tripsheet/${req.params.id}/pdf`;
    res.type('html').send(renderTripSheetHtml(vm, { print: false, web: true }));
  } catch (e) { res.status(502).send('Error building trip sheet'); }
});

// GET /tripsheet/:id/pdf — the rendered trip sheet printed to PDF.
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
