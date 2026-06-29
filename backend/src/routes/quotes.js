import express from 'express';
import { supabase } from '../services/supabase.js';
import { getUnreadQuoteEmails, sendEmail, getAuthUrl, getTokensFromCode } from '../services/gmail.js';
import { processEmail } from '../services/quoteEngine.js';
import { getDispatchList } from '../services/levelflight.js';
import { mapDispatchToQuote } from '../services/quoteMap.js';
import { buildViewModel } from '../services/quoteData.js';
import { renderQuoteHtml } from '../services/quoteHtml.js';
import { renderQuotePdf } from '../services/quotePdf.js';

const router = express.Router();

router.get('/auth-url', (req, res) => {
  res.json({ url: getAuthUrl() });
});

// Gmail OAuth redirect target. Mounted as a single PUBLIC exact-path route in
// index.js (Google cannot send a login token). It must NOT be part of the
// guarded quotes router's surface — see audit finding C2. Behavior unchanged.
export async function gmailOauthCallback(req, res) {
  try {
    const tokens = await getTokensFromCode(req.query.code);
    res.json({ tokens, message: 'Copy the refresh_token to your .env as GMAIL_REFRESH_TOKEN' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

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

// Fetch every page of dispatches (25/page), in parallel chunks, cached briefly.
// LevelFlight has ~1000 dispatches, so paginate fully but don't refetch per request.
let _listCache = { at: 0, data: null };
const LIST_TTL_MS = 5 * 60 * 1000;
async function getAllDispatches(force = false) {
  if (!force && _listCache.data && Date.now() - _listCache.at < LIST_TTL_MS) return _listCache.data;
  const all = [];
  const CHUNK = 8;
  let page = 1, done = false;
  while (!done && page <= 80) {
    const batch = Array.from({ length: CHUNK }, (_, i) => page + i);
    const results = await Promise.all(batch.map((p) => getDispatchList(p).catch(() => ({ dispatches: [] }))));
    for (const r of results) {
      const ds = r?.dispatches || [];
      all.push(...ds);
      if (ds.length < 25) done = true;
    }
    page += CHUNK;
  }
  _listCache = { at: Date.now(), data: all };
  return all;
}

// GET /api/quotes/list — all LevelFlight quotes as summary rows (all pages).
// ?refresh=1 bypasses the 5-min cache to re-pull fresh prices from LevelFlight.
router.get('/list', async (req, res) => {
  try {
    const dispatches = await getAllDispatches(req.query.refresh === '1');
    const rows = dispatches.map((d) => {
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
    res.type('application/pdf').set('Content-Disposition', `inline; filename="exjet-quote-${vm.quoteNumber || req.params.id}.pdf"`).send(pdf);
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/quotes/dispatch/:id/send-link  body { to, cc } — email the public quote
// link. `cc` sends a copy (comma-separate multiple).
router.post('/dispatch/:id/send-link', async (req, res) => {
  try {
    const to = (req.body?.to || '').trim();
    const cc = (req.body?.cc || '').trim();
    if (!to) return res.status(400).json({ error: 'Recipient email required' });
    const base = `${req.protocol}://${req.get('host')}`;
    const link = `${base}/quote/${req.params.id}`;
    await sendEmail({
      to,
      cc: cc || undefined,
      subject: 'Your Exjet Charter Quote',
      body: `Thank you for considering Exjet Aviation.\n\nView your charter quote here:\n${link}\n\nYou can review the itinerary, terms, and request to book directly from that page.`,
    });
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

export default router;
