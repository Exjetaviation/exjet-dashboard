// backend/src/services/itineraryEmail.js
//
// Pure builder for the passenger-itinerary email (subject + HTML body) from the
// itinerary view-model (buildItinerary). No I/O — unit-tested.

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const firstNameOf = (full) => (full || '').trim().split(/\s+/)[0] || 'Guest';
const fmtDate = (t) => {
  if (t == null) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
};

// The bullet-point summary shown in the email + returned for the preview UI.
export function itinerarySummary(vm) {
  const legs = vm?.legs || [];
  const date = fmtDate(legs[0]?.depTime);
  const aircraft = [vm?.aircraftType, vm?.tail ? `(${vm.tail})` : null].filter(Boolean).join(' ') || null;
  const pax = legs.reduce((m, l) => Math.max(m, l?.pax || 0), 0) || null;
  return { tripNumber: vm?.tripNumber || null, date, aircraft, pax };
}

// Returns { subject, html, summary, recipientName }.
export function buildItineraryEmail(vm, { recipientName, link, logoUrl } = {}) {
  const s = itinerarySummary(vm);
  const name = (recipientName || '').trim() || firstNameOf(vm?.client?.name);
  const subject = `Exjet Aviation – Passenger Itinerary${s.tripNumber ? ` | Trip #${s.tripNumber}` : ''}`;
  const row = (lbl, val) => (val ? `<li style="margin:4px 0">${lbl}: <strong>${esc(val)}</strong></li>` : '');
  const html = `<!DOCTYPE html><html><body style="margin:0;background:#f4f5f7;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a;line-height:1.5">
  <div style="max-width:600px;margin:0 auto;padding:28px 24px;background:#ffffff">
    <p>Dear ${esc(name)},</p>
    <p>Thank you for choosing Exjet Aviation. Please find attached your passenger itinerary${s.tripNumber ? ` for Trip #${esc(s.tripNumber)}` : ''}.</p>
    <p>Below is a summary of your flight details:</p>
    <ul style="list-style:disc;padding-left:20px;margin:8px 0 16px">
      ${row('Date', s.date)}
      ${row('Aircraft', s.aircraft)}
      ${row('Passengers', s.pax)}
    </ul>
    <p>You may also view and download your full itinerary at any time using the link below:</p>
    <p style="margin:18px 0">
      <a href="${esc(link || '#')}" style="display:inline-block;background:#4f8ef7;color:#ffffff;text-decoration:none;padding:11px 24px;border-radius:8px;font-weight:bold">View Itinerary</a>
    </p>
    <p>Should you have any questions or need to make changes, please don't hesitate to reach out. We look forward to providing you with an exceptional flight experience.</p>
    <p style="margin-top:22px">Warm regards,</p>
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:2px 0"><tr>
      ${logoUrl ? `<td style="vertical-align:middle;padding-right:16px"><img src="${esc(logoUrl)}" alt="Exjet Aviation" width="130" style="display:block;border:0"></td>` : ''}
      <td style="vertical-align:middle;font-size:13px;color:#1a1a1a;line-height:1.5">
        <strong>Jaime A Torres</strong><br>
        Exjet Aviation<br>
        4250 Execuair Street, Suite G | Orlando, FL 32827<br>
        +1 (407) 677-7792
      </td>
    </tr></table>
  </div></body></html>`;
  return { subject, html, summary: s, recipientName: name };
}
