// Legacy manual browser probe. It is intentionally excluded from `npm test`.
// A reproducible browser suite with declared dependencies is planned in AP-13.
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto('http://127.0.0.1:8000/index.php', { waitUntil: 'networkidle' });
    await page.fill('input[name="pin"]', '123456');
    await page.fill('input[name="nickname"]', 'TestPlayer');
    await page.click('button[type="submit"]');

    await page.waitForURL(/lobby\.php/);
    await page.waitForSelector('#playerStatus');

    const statusText = await page.locator('#playerStatus').textContent();
    console.log('UI status:', statusText?.trim());

    await page.screenshot({ path: 'realtime-node/tests/ui-flow.png', fullPage: true });
    console.log('UI screenshot saved to realtime-node/tests/ui-flow.png');
  } catch (error) {
    console.error('UI test failed:', error.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();