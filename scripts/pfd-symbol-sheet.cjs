// Renders every PFD symbol from src/render/pfdSymbols.ts to docs/v2/pfd-symbols.png
// for visual review. Run: node scripts/pfd-symbol-sheet.cjs
const { buildSync } = require('esbuild');
const { chromium } = require('playwright');

const bundle = buildSync({ entryPoints: ['src/render/pfdSymbols.ts'], bundle: true, format: 'iife', globalName: 'PFD', write: false });

(async () => {
  const W = 1040;
  const H = 520;
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 2 });
  await page.setContent(`<body style="margin:0;background:#fff"><canvas id="c" width="${W * 2}" height="${H * 2}" style="width:${W}px;height:${H}px"></canvas></body>`);
  await page.addScriptTag({ content: bundle.outputFiles[0].text });
  await page.evaluate(([W, H]) => {
    const PFD = window.PFD;
    const ctx = document.getElementById('c').getContext('2d');
    ctx.scale(2, 2);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    const ink = { ink: '#111111', paper: '#ffffff' };
    const s = 110;
    const cells = [
      ['pump', '원심펌프', 'ISO 10628-2'],
      ['tank', '개방 탱크(수조)', 'ISO 10628-2'],
      ['hx', '쉘앤튜브 열교환기', 'ISO 10628-2'],
      ['strainer', '스트레이너', 'ISO 10628-2'],
      ['spray', '냉각탑 살수부', 'ISO 10628-2'],
      ['offPage', '경계 연결', 'ISO 10628-2'],
      ['gateValve', '게이트 밸브', 'ISO 10628-2 / ISA-5.1'],
      ['globeValve', '글로브 밸브', 'ISO 10628-2 / ISA-5.1'],
      ['ballValve', '볼 밸브', 'ISO 10628-2 / ISA-5.1'],
      ['butterflyValve', '버터플라이 밸브', 'ISO 10628-2 / ISA-5.1'],
      ['globeValve', '제어밸브 (FCV)', 'ISA-5.1 액추에이터', { control: true }],
      ['bubbleField', '계기 (현장)', 'ISA-5.1'],
      ['bubbleBoard', '계기 (제어실)', 'ISA-5.1'],
      ['stream', '스트림 번호', 'PFD 관례'],
      ['arrow', '흐름 방향', 'ISO 10628-2'],
    ];
    const cols = 8;
    cells.forEach(([sym, name, std, opts], i) => {
      const cx = 65 + (i % cols) * 130;
      const cy = 95 + Math.floor(i / cols) * 230;
      // process line through the symbol, as it sits on a PFD
      ctx.strokeStyle = '#111';
      ctx.lineWidth = 2.5;
      if (!sym.startsWith('bubble')) {
        ctx.beginPath();
        ctx.moveTo(cx - s / 2, cy);
        ctx.lineTo(cx + s / 2, cy);
        ctx.stroke();
      }
      ctx.save();
      ctx.translate(cx, cy);
      if (sym === 'bubbleField') PFD.drawInstrumentBubble(ctx, 'FI', '101', s * 0.22, ink, false);
      else if (sym === 'bubbleBoard') PFD.drawInstrumentBubble(ctx, 'FIC', '101', s * 0.22, ink, true);
      else if (sym === 'stream') PFD.drawStreamMarker(ctx, 3, s * 0.14, ink);
      else if (sym === 'arrow') PFD.drawFlowArrow(ctx, s, ink);
      else PFD.drawPfdSymbol(ctx, sym, s, ink, opts || {});
      ctx.restore();
      ctx.fillStyle = '#111';
      ctx.textAlign = 'center';
      ctx.font = '600 13px system-ui, sans-serif';
      ctx.fillText(name, cx, cy + 82);
      ctx.fillStyle = '#666';
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillText(std, cx, cy + 99);
    });
  }, [W, H]);
  await page.locator('#c').screenshot({ path: 'docs/v2/pfd-symbols.png' });
  await browser.close();
})();
