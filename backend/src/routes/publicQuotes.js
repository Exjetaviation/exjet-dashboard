// Public, UNAUTHENTICATED client quote pages. The 24-char dispatch id is the access
// token (LevelFlight's model). Mounted OUTSIDE the /api auth guard.
import express from 'express';
import { buildViewModel } from '../services/quoteData.js';
import { renderQuoteHtml } from '../services/quoteHtml.js';
import { renderQuotePdf } from '../services/quotePdf.js';

const router = express.Router();

// GET /quote/:id — interactive client web quote.
router.get('/:id', async (req, res) => {
  try {
    const vm = await buildViewModel(req.params.id);
    if (!vm) return res.status(404).send('Quote not found');
    vm.pdfUrl = `/quote/${req.params.id}/pdf`;
    res.type('html').send(renderQuoteHtml(vm, { print: false, web: true }));
  } catch (e) { res.status(500).send('Error generating quote'); }
});

// GET /quote/:id/pdf — the PDF (so the client's Download button works, no login).
router.get('/:id/pdf', async (req, res) => {
  try {
    const vm = await buildViewModel(req.params.id);
    if (!vm) return res.status(404).json({ error: 'Quote not found' });
    const pdf = await renderQuotePdf(renderQuoteHtml(vm, { print: true }));
    res.type('application/pdf').set('Content-Disposition', `inline; filename="exjet-quote-${vm.quoteNumber || req.params.id}.pdf"`).send(pdf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
