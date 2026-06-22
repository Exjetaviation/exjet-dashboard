// Public, UNAUTHENTICATED client quote pages. The 24-char dispatch id is the access
// token (LevelFlight's model). Mounted OUTSIDE the /api auth guard.
import express from 'express';
import { buildViewModel } from '../services/quoteData.js';
import { renderQuoteHtml } from '../services/quoteHtml.js';
import { renderQuotePdf } from '../services/quotePdf.js';
import { supabase } from '../services/supabase.js';
import { sendEmail } from '../services/gmail.js';
import { buildNativeQuoteVM } from '../services/nativeQuoteData.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// uuid → native trip; 24-hex → LevelFlight dispatch.
const buildQuoteVM = (id) => (UUID_RE.test(id) ? buildNativeQuoteVM(id) : buildViewModel(id));

const router = express.Router();

// GET /quote/:id — interactive client web quote.
router.get('/:id', async (req, res) => {
  try {
    const vm = await buildQuoteVM(req.params.id);
    if (!vm) return res.status(404).type('html').send('<p>Quote not found.</p>');
    if (!vm.pdfUrl) vm.pdfUrl = `/quote/${req.params.id}/pdf`; // native VM sets this; LF VM doesn't
    res.type('html').send(renderQuoteHtml(vm, { print: false, web: true }));
  } catch (e) { res.status(500).send('Error generating quote'); }
});

// GET /quote/:id/pdf — the PDF (so the client's Download button works, no login).
router.get('/:id/pdf', async (req, res) => {
  try {
    const vm = await buildQuoteVM(req.params.id);
    if (!vm) return res.status(404).send('Quote not found');
    const pdf = await renderQuotePdf(renderQuoteHtml(vm, { print: true }));
    res.type('application/pdf').set('Content-Disposition', `inline; filename="exjet-quote-${vm.quoteNumber || req.params.id}.pdf"`).send(pdf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /quote/:id/accept — client clicks "Request to Book". Records acceptance +
// notifies ops; the dispatcher still books it in the app. Native (uuid) only.
router.get('/:id/accept', async (req, res) => {
  const id = req.params.id;
  if (!UUID_RE.test(id)) return res.status(400).type('html').send('<p>Invalid quote link.</p>');
  try {
    const { data: trip } = await supabase
      .from('scheduling_trips').select('id, quote_number, accepted_at').eq('id', id).single();
    if (!trip) return res.status(404).type('html').send('<p>Quote not found.</p>');
    if (!trip.accepted_at) {
      const note = (req.query.name || '').toString().slice(0, 200) || null;
      await supabase.from('scheduling_trips')
        .update({ accepted_at: new Date().toISOString(), accepted_note: note }).eq('id', id);
      sendEmail({
        to: 'info@flyexjet.vip',
        subject: `Quote ${trip.quote_number || ''} accepted by client`,
        html: `<p>Quote <b>${trip.quote_number || id}</b> was accepted via the client link${note ? ` by ${note}` : ''}.</p><p>Open it in the dashboard to Book.</p>`,
      }).catch((e) => console.warn('[accept email]', e?.message));
    }
    res.type('html').send(`<!doctype html><meta charset="utf-8"><body style="font-family:-apple-system,sans-serif;background:#0b1018;color:#e8edf4;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center"><div><h2>Thank you — your request to book is received.</h2><p style="color:#8a98ad">Exjet Aviation will confirm your trip shortly.</p></div></body>`);
  } catch (e) {
    console.error('GET /quote/:id/accept:', e.message);
    res.status(500).type('html').send('<p>Something went wrong. Please contact Exjet Aviation.</p>');
  }
});

export default router;
