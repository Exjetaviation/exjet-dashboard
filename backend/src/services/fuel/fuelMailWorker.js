import { scanFuelMail } from './fuelMailScan.js';

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
let started = false;

// Opt-in via FUEL_MAIL_SCAN=on. Runs the fuel mail scan on boot + weekly.
export function startFuelMailWorker() {
  if (started || process.env.FUEL_MAIL_SCAN !== 'on') return;
  started = true;
  const run = () => scanFuelMail().then((r) => console.log('[fuelMail]', JSON.stringify(r).slice(0, 300))).catch((e) => console.warn('[fuelMail]', e.message));
  run();
  setInterval(run, WEEK_MS);
}
