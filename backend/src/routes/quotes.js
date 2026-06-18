import express from 'express';
import { supabase } from '../services/supabase.js';
import { getUnreadQuoteEmails, sendEmail, getAuthUrl, getTokensFromCode } from '../services/gmail.js';
import { processEmail } from '../services/quoteEngine.js';
import { getDispatchList, getTripLog } from '../services/levelflight.js';
import { mapDispatchToQuote, mapLegDetail } from '../services/quoteMap.js';
import { renderQuoteHtml } from '../services/quoteHtml.js';
import { renderQuotePdf } from '../services/quotePdf.js';

const router = express.Router();

router.get('/auth-url', (req, res) => {
  res.json({ url: getAuthUrl() });
});

router.get('/auth-callback', async (req, res) => {
  try {
    const tokens = await getTokensFromCode(req.query.code);
    res.json({ tokens, message: 'Copy the refresh_token to your .env as GMAIL_REFRESH_TOKEN' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/scan', async (req, res) => {
  try {
    const emails = await getUnreadQuoteEmails();
    const results = [];

    const { data: existing } = await supabase
      .from('quotes')
      .select('email_id');
    const processedIds = new Set((existing || []).map(q => q.email_id));

    for (const email of emails) {
      if (processedIds.has(email.id)) {
        results.push({ email: email.subject, status: 'already_processed' });
        continue;
      }
      try {
        const quote = await processEmail(email);
        if (quote) {
          results.push({ email: email.subject, status: 'quote_created', id: quote.id });
        } else {
          results.push({ email: email.subject, status: 'not_a_quote' });
        }
      } catch (err) {
        results.push({ email: email.subject, status: 'error', error: err.message });
      }
    }

    const created   = results.filter(r => r.status === 'quote_created').length;
    const skipped   = results.filter(r => r.status === 'already_processed').length;
    const notQuotes = results.filter(r => r.status === 'not_a_quote').length;

    res.json({ scanned: emails.length, created, skipped, notQuotes, results });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('quotes')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('quotes')
      .update({ ...req.body, updated_at: new Date().toISOString() })
      .eq('id', req.params.id)
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/send', async (req, res) => {
  try {
    const { data: quote, error } = await supabase
      .from('quotes').select('*').eq('id', req.params.id).single();
    if (error || !quote) throw new Error('Quote not found');

    const toEmail = quote.email_from.match(/<(.+)>/)?.[1] || quote.email_from;

    await sendEmail({
      to: toEmail,
      subject: `Charter Quote — ${quote.parsed_origin} to ${quote.parsed_destination}`,
      body: quote.quote_draft,
    });

    await supabase.from('quotes').update({
      status: 'sent',
      sent_at: new Date().toISOString(),
    }).eq('id', req.params.id);

    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await supabase.from('quotes').delete().eq('id', req.params.id);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const ACCEPT_BASE = 'https://api.levelflight.com/client';

// The per-dispatch flightLog returns FULL legs (airports, times, distance, EFT, and
// inline _calc.from/to.location coords) — the complete data the document needs.
async function buildViewModel(dispatchId) {
  const tl = await getTripLog(dispatchId);
  const dispatch = tl?.dispatch;
  if (!dispatch) return null;
  const ac = tl?.aircraft || dispatch?.aircraft || {};
  const internal = dispatch?._internal || {};
  return {
    dispatchId,
    quoteNumber: dispatch?.quoteId != null ? String(dispatch.quoteId) : null,
    tail: ac?.tailNumber ?? null,
    aircraftType: ac?.type?.name ?? null,
    maxPax: ac?.paxSeats ?? null,
    total: internal?.price?.breakdown?.calculatedTotal ?? internal?.price?.total ?? null,
    amenities: ['Flight Attendant', 'WIFI'],
    preparedOn: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
    // NOTE: the LevelFlight client accept-link id is not exposed in the API; using the
    // dispatch id as a best guess — verify by clicking it on a real quote.
    acceptUrl: `${ACCEPT_BASE}/${dispatchId}/accept`,
    legs: (dispatch?.legs || []).map(mapLegDetail),
  };
}

// GET /api/quotes/list — all LevelFlight quotes as summary rows.
router.get('/list', async (req, res) => {
  try {
    const data = await getDispatchList(1);
    const rows = (data?.dispatches || []).map((d) => {
      const q = mapDispatchToQuote(d);
      const first = q.legs[0] || {}; const last = q.legs[q.legs.length - 1] || {};
      return { dispatchId: q.dispatchId, quoteNumber: q.quoteNumber, tail: q.tail, from: first.from, to: last.to,
        depTime: first.depTime, legs: q.legs.length, total: q.total };
    });
    res.json({ quotes: rows });
  } catch (e) { res.status(502).json({ error: e.message, quotes: [] }); }
});

// GET /api/quotes/dispatch/:id/preview — HTML for the dashboard iframe.
router.get('/dispatch/:id/preview', async (req, res) => {
  try {
    const vm = await buildViewModel(req.params.id);
    if (!vm) return res.status(404).send('Quote not found');
    res.type('html').send(renderQuoteHtml(vm, { print: req.query.print === '1' }));
  } catch (e) { res.status(500).send(`Error: ${e.message}`); }
});

// GET /api/quotes/dispatch/:id/pdf — the branded PDF.
router.get('/dispatch/:id/pdf', async (req, res) => {
  try {
    const vm = await buildViewModel(req.params.id);
    if (!vm) return res.status(404).json({ error: 'Quote not found' });
    const pdf = await renderQuotePdf(renderQuoteHtml(vm, { print: true }));
    res.type('application/pdf').set('Content-Disposition', `inline; filename="exjet-quote-${req.params.id}.pdf"`).send(pdf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
