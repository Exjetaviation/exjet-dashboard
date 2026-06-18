// backend/src/routes/publicTripSheets.js
// Public, UNAUTHENTICATED trip-sheet pages. The 24-char dispatch id is the access
// token (same model as the public quote). Mounted OUTSIDE the /api auth guard.
import express from 'express';
import { buildTripSheet } from '../services/tripSheetData.js';
import { renderTripSheetHtml } from '../services/tripSheetHtml.js';
import { renderQuotePdf } from '../services/quotePdf.js';

const router = express.Router();

// GET /tripsheet/:id — interactive web trip sheet.
router.get('/:id', async (req, res) => {
  try {
    const vm = await buildTripSheet(req.params.id);
    if (!vm) return res.status(404).send('Trip sheet not found');
    vm.pdfUrl = `/tripsheet/${req.params.id}/pdf`;
    res.type('html').send(renderTripSheetHtml(vm, { print: false, web: true }));
  } catch (e) { res.status(500).send('Error generating trip sheet'); }
});

// GET /tripsheet/:id/pdf — PDF (reuses the HTML-agnostic quote PDF renderer).
router.get('/:id/pdf', async (req, res) => {
  try {
    const vm = await buildTripSheet(req.params.id);
    if (!vm) return res.status(404).json({ error: 'Trip sheet not found' });
    const pdf = await renderQuotePdf(renderTripSheetHtml(vm, { print: true }));
    res.type('application/pdf')
      .set('Content-Disposition', `inline; filename="exjet-tripsheet-${vm.tripNumber || req.params.id}.pdf"`)
      .send(pdf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
