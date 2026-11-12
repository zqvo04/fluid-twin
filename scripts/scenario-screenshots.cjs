// Screenshots of scenario playback (follow-up F4): the reference loop's
// pump A → B switch-over at t = 8 s (A and B in parallel), on the map and the PFD.
// Run: node scripts/scenario-screenshots.cjs  (starts and stops its own vite dev server)
const { buildSync } = require('esbuild');
const { chromium } = require('playwright');
const { spawn } = require('child_process');

const entry = `
  import { GRID_PRESETS } from './src/examples/gridPresets';
  import { defaultViewport, cellSizePx } from './src/render/viewport';
  export const grid = GRID_PRESETS.find((p) => p.name === '개방형 냉각수 루프').build();
  export { defaultViewport, cellSizePx };
`;
const out = buildSync({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false });
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
const { grid, defaultViewport, cellSizePx } = mod.exports;

(async () => {
  const server = spawn('npx', ['vite', '--port', '5197', '--strictPort'], { stdio: 'ignore', detached: true });
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
    for (let i = 0; ; i++) {
      try {
        await page.goto('http://localhost:5197/', { timeout: 2000 });
        break;
      } catch (e) {
        if (i > 30) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await page.getByRole('button', { name: '예제 ▾' }).click();
    await page.getByRole('button', { name: /개방형 냉각수 루프/ }).click();
    await page.getByRole('button', { name: '예: 펌프 A → B 전환' }).click();
    await page.getByRole('button', { name: '재생', exact: true }).click();
    await page.getByRole('button', { name: '재생', exact: true }).waitFor({ timeout: 30000 }); // back when done
    await page.getByRole('slider', { name: '재생 시각' }).fill('16'); // t = 8 s: ramp done, A and B in parallel
    await page.getByRole('tab', { name: '선택' }).click();
    const box = await page.locator('.grid-viewport canvas').first().boundingBox();
    const view = defaultViewport(box.width, box.height, grid.cols, grid.rows);
    const s = cellSizePx(view);
    const b = grid.tiles.find((t) => t.tag === 'P-101B').cell;
    await page.mouse.click(box.x + view.panX + (b.col + 0.5) * s, box.y + view.panY + (b.row + 0.5) * s);
    await page.waitForTimeout(800);
    await page.screenshot({ path: 'docs/v2/scenario-map.png' });
    await page.getByRole('tab', { name: 'PFD' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'docs/v2/scenario-pfd.png' });
    await browser.close();
  } finally {
    process.kill(-server.pid);
  }
})();
