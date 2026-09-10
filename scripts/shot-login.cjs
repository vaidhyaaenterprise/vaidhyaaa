const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } });
  await page.goto('http://localhost:3001/login', { waitUntil: 'networkidle', timeout: 90000 });
  await page.waitForSelector('text=Welcome back', { timeout: 60000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: 'login-page.png', fullPage: false });
  // mobile view
  await page.setViewportSize({ width: 420, height: 900 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: 'login-page-mobile.png', fullPage: false });
  await browser.close();
  console.log('done');
})().catch((e) => { console.error(e); process.exit(1); });
