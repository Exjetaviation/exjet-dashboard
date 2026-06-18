// backend/src/services/quotePdf.js
// Renders quote HTML to a Letter PDF via headless Chromium. Uses @sparticuz/chromium
// (a container/serverless-friendly Chromium shipped as an npm package) so NO Chromium
// download/extract happens at build time — fixes Railway `npm ci` (no unzip/tar) and
// provides Chromium at runtime. Locally, set PUPPETEER_EXECUTABLE_PATH to a system
// Chrome to render without @sparticuz (e.g. macOS dev).
import puppeteer from 'puppeteer-core';
import chromium from '@sparticuz/chromium';

export async function renderQuotePdf(html, { waitForMapReady = true } = {}) {
  const localExe = process.env.PUPPETEER_EXECUTABLE_PATH;
  const browser = await puppeteer.launch({
    args: localExe ? ['--no-sandbox', '--disable-setuid-sandbox'] : chromium.args,
    executablePath: localExe || (await chromium.executablePath()),
    headless: true,
  });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    if (waitForMapReady) {
      await page.waitForFunction('window.__mapReady === true', { timeout: 15000 })
        .catch(() => console.warn('[quotePdf] map not ready before print (rendering without it)'));
    }
    return await page.pdf({ format: 'Letter', printBackground: true, margin: { top: '0', bottom: '0', left: '0', right: '0' } });
  } finally {
    await browser.close();
  }
}
