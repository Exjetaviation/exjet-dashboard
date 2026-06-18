// backend/src/services/quotePdf.js
// Renders quote HTML to a Letter PDF via headless Chromium. Waits for the Leaflet
// map (window.__mapReady) so tiles are painted before printing.
import puppeteer from 'puppeteer';

export async function renderQuotePdf(html) {
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await page.waitForFunction('window.__mapReady === true', { timeout: 15000 }).catch(() => {});
    return await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
  } finally {
    await browser.close();
  }
}
