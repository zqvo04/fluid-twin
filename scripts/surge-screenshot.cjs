// Screenshot of the surge-check panel (follow-up F3): a fast FCV-101 closure
// on the reference loop, after the run. Run: node scripts/surge-screenshot.cjs
const { chromium } = require('playwright');
const { spawn } = require('child_process');

(async () => {
  const server = spawn('npx', ['vite', '--port', '5196', '--strictPort'], { stdio: 'ignore', detached: true });
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    for (let i = 0; ; i++) {
      try {
        await page.goto('http://localhost:5196/', { timeout: 2000 });
        break;
      } catch (e) {
        if (i > 30) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await page.getByRole('button', { name: '예제 ▾' }).click();
    await page.getByRole('button', { name: /개방형 냉각수 루프/ }).click();
    await page.waitForTimeout(1200);
    const panel = page.locator('.transient-panel');
    await panel.scrollIntoViewIfNeeded();
    await panel.getByLabel('조작 시간 [s]').fill('0.05');
    await panel.getByRole('button', { name: '점검 시작' }).click();
    await panel.getByText('결과').waitFor({ timeout: 60000 });
    await panel.getByText('최대 상승').scrollIntoViewIfNeeded();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'docs/v2/surge-check.png' });
    await browser.close();
  } finally {
    process.kill(-server.pid);
  }
})();
