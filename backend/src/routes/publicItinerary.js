// backend/src/routes/publicItinerary.js
// Public, UNAUTHENTICATED passenger-itinerary pages. The 24-char dispatch id is the
// access token (same model as the public quote). Mounted OUTSIDE the /api auth guard.
import express from 'express';
import { buildItinerary } from '../services/itineraryData.js';
import { renderItineraryHtml } from '../services/itineraryHtml.js';
import { renderQuotePdf } from '../services/quotePdf.js';
import { EXJET_EMAIL_PNG } from '../assets/quote/assets.js';

const router = express.Router();

// GET /itinerary/email-logo.png — the Exjet email-signature logo, served publicly so
// it renders in sent emails. Declared before /:id so it isn't treated as a dispatch id.
router.get('/email-logo.png', (req, res) => {
  if (!EXJET_EMAIL_PNG) return res.status(404).end();
  res.type('png').set('Cache-Control', 'public, max-age=86400').send(EXJET_EMAIL_PNG);
});

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
