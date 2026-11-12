// Screenshots the same selection in PFD and map mode (PLAN-V2 P3-4).
// Loads the test cooling loop through the real "불러오기" file input.
// Run: node scripts/mode-screenshots.cjs  (starts and stops its own vite dev server)
const { buildSync } = require('esbuild');
const { chromium } = require('playwright');
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const entry = `
  import { coolingLoop } from './src/grid/testLoop';
  import { serializeGrid } from './src/grid/serialize';
  import { defaultViewport, cellSizePx } from './src/render/viewport';
  export function fixture() {
    const { grid, ids } = coolingLoop();
    const g = { ...grid, instruments: [
      { tag: 'FI-101', type: 'FI', targetId: ids.pump },
      { tag: 'PI-101', type: 'PI', targetId: ids.hx },
      { tag: 'LI-101', type: 'LI', targetId: ids.basin },
      { tag: 'FIC-101', type: 'FIC', targetId: ids.valve },
    ] };
    return { json: serializeGrid(g), grid: g, ids };
  }
  export { defaultViewport, cellSizePx };
`;
const out = buildSync({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'ts' }, bundle: true, platform: 'node', format: 'cjs', write: false });
const mod = { exports: {} };
new Function('module', 'exports', 'require', out.outputFiles[0].text)(mod, mod.exports, require);
const { fixture, defaultViewport, cellSizePx } = mod.exports;
const { json, grid, ids } = fixture();
const file = path.join(os.tmpdir(), 'cooling-loop.json');
fs.writeFileSync(file, json);

(async () => {
  const server = spawn('npx', ['vite', '--port', '5199', '--strictPort'], { stdio: 'ignore', detached: true });
  try {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 2 });
    for (let i = 0; ; i++) {
      try {
        await page.goto('http://localhost:5199/', { timeout: 2000 });
        break;
      } catch (e) {
        if (i > 30) throw e;
        await new Promise((r) => setTimeout(r, 500));
      }
    }
    await page.locator('input[type=file]').setInputFiles(file);
    await page.getByRole('tab', { name: '선택' }).click();
    // Same placement the store computes on load.
    const box = await page.locator('.grid-viewport canvas').first().boundingBox();
    const view = defaultViewport(box.width, box.height, grid.cols, grid.rows);
    const s = cellSizePx(view);
    const pump = grid.tiles.find((t) => t.id === ids.pump).cell;
    await page.mouse.click(box.x + view.panX + (pump.col + 0.5) * s, box.y + view.panY + (pump.row + 0.5) * s);
    await page.waitForTimeout(1500); // auto-solve in the worker
    await page.getByRole('tab', { name: 'PFD' }).click();
    await page.waitForTimeout(300);
    await page.screenshot({ path: 'docs/v2/mode-pfd.png' });
    await page.getByRole('tab', { name: '맵' }).click();
    await page.waitForTimeout(600);
    await page.screenshot({ path: 'docs/v2/mode-map.png' });
    await browser.close();
  } finally {
    process.kill(-server.pid);
  }
})();
