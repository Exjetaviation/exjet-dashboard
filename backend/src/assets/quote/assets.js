// Loads brand assets as data URIs for the self-contained quote HTML (so Puppeteer
// and the iframe preview need no static asset serving). Per-tail photos keyed by tail.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const uri = (file, mime) => {
  try { return `data:${mime};base64,${readFileSync(join(here, file)).toString('base64')}`; }
  catch { return null; }
};

export const LOGO_DATA_URI = uri('logo.png', 'image/png');
export const WINGS_DATA_URI = uri('wings.png', 'image/png');

// Raw PNG buffer for the email signature logo. Served over HTTP (a hosted URL) —
// email clients strip data-URI images, so it can't be inlined like the doc logos.
export const EXJET_EMAIL_PNG = (() => { try { return readFileSync(join(here, 'exjet-email.png')); } catch { return null; } })();

// { tail: { interior, exterior, cabin } } — extend as photos are added.
export function aircraftPhotos(tail) {
  const t = String(tail || '').toUpperCase();
  if (t === 'N69FP') return {
    interior: uri('N69FP-interior.jpeg', 'image/jpeg'),
    exterior: uri('N69FP-exterior.jpeg', 'image/jpeg'),
    cabin: uri('N69FP-cabin.jpeg', 'image/jpeg'),
  };
  return { interior: null, exterior: null, cabin: null };
}
