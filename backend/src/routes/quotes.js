import express from 'express';
import { supabase } from '../services/supabase.js';
import { getUnreadQuoteEmails, sendEmail, getAuthUrl, getTokensFromCode } from '../services/gmail.js';
import { processEmail } from '../services/quoteEngine.js';

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

export default router;
