// backend/src/routes/publicItinerary.js
// Public, UNAUTHENTICATED passenger-itinerary pages. The 24-char dispatch id is the
// access token (same model as the public quote). Mounted OUTSIDE the /api auth guard.
import express from 'express';
import { buildItinerary } from '../services/itineraryData.js';
import { renderItineraryHtml } from '../services/itineraryHtml.js';
import { renderQuotePdf } from '../services/quotePdf.js';

const router = express.Router();

// GET /itinerary/:id — interactive web passenger itinerary.
router.get('/:id', async (req, res) => {
  try {
    const vm = await buildItinerary(req.params.id);
    if (!vm) return res.status(404).send('Itinerary not found');
    vm.pdfUrl = `/itinerary/${req.params.id}/pdf`;
    res.type('html').send(renderItineraryHtml(vm, { print: false, web: true }));
  } catch (e) { res.status(500).send('Error generating itinerary'); }
});

// GET /itinerary/:id/pdf — PDF (reuses the HTML-agnostic quote PDF renderer).
router.get('/:id/pdf', async (req, res) => {
  try {
    const vm = await buildItinerary(req.params.id);
    if (!vm) return res.status(404).json({ error: 'Itinerary not found' });
    const pdf = await renderQuotePdf(renderItineraryHtml(vm, { print: true }));
    res.type('application/pdf')
      .set('Content-Disposition', `inline; filename="exjet-itinerary-${vm.tripNumber || req.params.id}.pdf"`)
      .send(pdf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
