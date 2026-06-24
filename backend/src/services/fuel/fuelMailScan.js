import { gmailClientFor } from '../gmail.js';
import { parseWfs } from './parseWfs.js';
import { parseEverest, everestDateFromFilename } from './parseEverest.js';
import { vendorFor } from './routeVendor.js';
import { alreadyImported, logImport, replaceVendorPrices } from './fuelStore.js';

const PARSERS = { wfs: parseWfs, everest: parseEverest };
// Narrow query: only the two vendors' messages with attachments, recent window.
const QUERY = 'from:(fuelmanagement@everest-fuel.com OR fosnda@wfscorp.com) has:attachment newer_than:21d';

const headerVal = (headers, name) => (headers || []).find((h) => h.name?.toLowerCase() === name)?.value || '';

// Walk a message payload for CSV attachments → [{ filename, attachmentId }].
const csvAttachments = (payload) => {
  const out = [];
  const walk = (p) => {
    if (!p) return;
    const fn = p.filename || '';
    if (fn.toLowerCase().endsWith('.csv') && p.body?.attachmentId) out.push({ filename: fn, attachmentId: p.body.attachmentId });
    (p.parts || []).forEach(walk);
  };
  walk(payload);
  return out;
};

// Scan operations@ for new vendor fuel CSVs and store them. Read-only on the mailbox
// (dedup via fuel_price_imports — never marks mail read). Uses a dedicated OAuth app.
export async function scanFuelMail() {
  const ops = {
    clientId: process.env.GMAIL_OPS_CLIENT_ID,
    clientSecret: process.env.GMAIL_OPS_CLIENT_SECRET,
    redirectUri: process.env.GMAIL_OPS_REDIRECT_URI,
    refreshToken: process.env.GMAIL_OPS_REFRESH_TOKEN,
  };
  if (!ops.clientId || !ops.refreshToken) return { ok: false, error: 'GMAIL_OPS_* not configured' };
  const gmail = gmailClientFor(ops);
  const list = await gmail.users.messages.list({ userId: 'me', q: QUERY, maxResults: 25 });
  const messages = list.data.messages || [];
  const results = [];

  for (const { id } of messages) {
    if (await alreadyImported(id)) { results.push({ id, skipped: 'already imported' }); continue; }
    try {
      const detail = await gmail.users.messages.get({ userId: 'me', id, format: 'full' });
      const from = headerVal(detail.data.payload?.headers, 'from');
      const internalMs = Number(detail.data.internalDate) || Date.now();
      const emailDate = new Date(internalMs).toISOString().slice(0, 10);
      const atts = csvAttachments(detail.data.payload);
      if (!atts.length) { await logImport({ gmail_message_id: id, status: 'error', message: 'no csv attachment' }); results.push({ id, error: 'no csv' }); continue; }

      let totalRows = 0, vendor = null, fileName = null, effDate = null;
      for (const att of atts) {
        vendor = vendorFor({ from, filename: att.filename });
        if (!vendor) { continue; }
        const a = await gmail.users.messages.attachments.get({ userId: 'me', messageId: id, id: att.attachmentId });
        const csv = Buffer.from(a.data.data, 'base64').toString('utf8');
        effDate = vendor === 'everest' ? (everestDateFromFilename(att.filename) || emailDate) : emailDate;
        const rows = PARSERS[vendor](csv, { sourceFile: att.filename, effectiveDate: effDate });
        if (rows.length) { await replaceVendorPrices(vendor, id, rows); totalRows += rows.length; fileName = att.filename; }
      }
      if (!vendor || !totalRows) { await logImport({ gmail_message_id: id, status: 'error', message: 'no matching vendor / 0 rows' }); results.push({ id, error: 'no vendor/rows' }); continue; }
      await logImport({ gmail_message_id: id, vendor, file_name: fileName, rows_imported: totalRows, effective_date: effDate, status: 'ok' });
      results.push({ id, vendor, rows: totalRows });
    } catch (e) {
      await logImport({ gmail_message_id: id, status: 'error', message: e.message });
      results.push({ id, error: e.message });
    }
  }
  return { ok: true, scanned: messages.length, results };
}
