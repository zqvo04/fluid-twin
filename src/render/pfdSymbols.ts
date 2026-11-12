/**
 * PFD symbol library — monochrome line art in the style of process flow
 * diagrams. Every symbol is drawn centred on (0, 0) in a unit cell of side
 * `s` px, along its axis +x (inlet → outlet), after the caller's
 * translate/rotate; `ink` is the line colour, `paper` the fill behind it.
 *
 * Sources: ISO 10628-2:2012 (graphical symbols for process flow diagrams)
 * for equipment, valves, lines and flow arrows; ANSI/ISA-5.1-2009 for
 * instrument bubbles and the control-valve actuator. Where the standards
 * allow several variants, the comment names the one drawn.
 */

export type PfdSymbol =
  | 'pump'
  | 'tank'
  | 'hx'
  | 'gateValve'
  | 'globeValve'
  | 'ballValve'
  | 'butterflyValve'
  | 'strainer'
  | 'spray'
  | 'offPage';

export interface Ink {
  ink: string;
  paper: string;
}

type Ctx = CanvasRenderingContext2D;

function stroke(ctx: Ctx, ink: Ink, w: number) {
  ctx.strokeStyle = ink.ink;
  ctx.lineWidth = w;
  ctx.stroke();
}

function fillPaper(ctx: Ctx, ink: Ink) {
  ctx.fillStyle = ink.paper;
  ctx.fill();
}

/** Two triangles tip to tip — the general valve body (ISO 10628-2 / ISA-5.1). */
function bowtie(ctx: Ctx, ink: Ink, s: number, w: number) {
  const a = s * 0.22;
  const h = s * 0.16;
  ctx.beginPath();
  ctx.moveTo(-a, -h);
  ctx.lineTo(a, h);
  ctx.lineTo(a, -h);
  ctx.lineTo(-a, h);
  ctx.closePath();
  fillPaper(ctx, ink);
  stroke(ctx, ink, w);
}

/**
 * Draw one equipment / valve symbol. `control` adds the ISA-5.1 diaphragm
 * actuator (dome on a stem) that turns a valve into a control valve.
 */
export function drawPfdSymbol(ctx: Ctx, sym: PfdSymbol, s: number, ink: Ink, opts: { control?: boolean } = {}): void {
  const w = Math.max(1.2, s * 0.03);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  switch (sym) {
    case 'pump': {
      // ISO 10628-2 centrifugal pump: circle, discharge triangle pointing downstream.
      const r = s * 0.28;
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, Math.PI * 2);
      fillPaper(ctx, ink);
      stroke(ctx, ink, w);
      ctx.beginPath();
      ctx.moveTo(-r * 0.7, -r * 0.7);
      ctx.lineTo(r, 0);
      ctx.lineTo(-r * 0.7, r * 0.7);
      stroke(ctx, ink, w);
      break;
    }
    case 'tank': {
      // ISO 10628-2 open (atmospheric) tank: open-top vessel, liquid level ▽.
      const a = s * 0.36;
      ctx.beginPath();
      ctx.rect(-a, -a, 2 * a, 2 * a);
      fillPaper(ctx, ink);
      // Outline without the top edge: the tank is open to atmosphere.
      ctx.beginPath();
      ctx.moveTo(-a, -a);
      ctx.lineTo(-a, a);
      ctx.lineTo(a, a);
      ctx.lineTo(a, -a);
      stroke(ctx, ink, w);
      ctx.beginPath();
      ctx.moveTo(-a * 0.75, -a * 0.2);
      ctx.lineTo(a * 0.75, -a * 0.2);
      ctx.moveTo(-a * 0.12, -a * 0.42);
      ctx.lineTo(a * 0.12, -a * 0.42);
      ctx.lineTo(0, -a * 0.24);
      ctx.closePath();
      stroke(ctx, ink, w * 0.8);
      break;
    }
    case 'hx': {
      // ISO 10628-2 shell-and-tube exchanger: shell outline with the tube
      // pass drawn through it (one-shell / two-tube-pass U variant).
      const a = s * 0.38;
      const h = s * 0.2;
      ctx.beginPath();
      ctx.moveTo(-a + h, -h);
      ctx.lineTo(a - h, -h);
      ctx.arc(a - h, 0, h, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(-a + h, h);
      ctx.arc(-a + h, 0, h, Math.PI / 2, (3 * Math.PI) / 2);
      ctx.closePath();
      fillPaper(ctx, ink);
      stroke(ctx, ink, w);
      ctx.beginPath();
      ctx.moveTo(-a * 0.75, -h * 0.45);
      ctx.lineTo(a * 0.55, -h * 0.45);
      ctx.arc(a * 0.55, 0, h * 0.45, -Math.PI / 2, Math.PI / 2);
      ctx.lineTo(-a * 0.75, h * 0.45);
      stroke(ctx, ink, w * 0.8);
      break;
    }
    case 'gateValve':
      bowtie(ctx, ink, s, w);
      break;
    case 'globeValve':
      // Globe: bowtie with a solid centre dot (common ISO/ISA rendering).
      bowtie(ctx, ink, s, w);
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.045, 0, Math.PI * 2);
      ctx.fillStyle = ink.ink;
      ctx.fill();
      break;
    case 'ballValve':
      // Ball: bowtie with an open circle at the centre.
      bowtie(ctx, ink, s, w);
      ctx.beginPath();
      ctx.arc(0, 0, s * 0.07, 0, Math.PI * 2);
      fillPaper(ctx, ink);
      stroke(ctx, ink, w);
      break;
    case 'butterflyValve':
      // Butterfly: bowtie with the disc drawn as a line across the bore.
      bowtie(ctx, ink, s, w);
      ctx.beginPath();
      ctx.moveTo(-s * 0.08, s * 0.2);
      ctx.lineTo(s * 0.08, -s * 0.2);
      stroke(ctx, ink, w);
      break;
    case 'strainer': {
      // ISO 10628-2 strainer/filter: housing with a diagonal screen (dashed).
      const a = s * 0.22;
      ctx.beginPath();
      ctx.rect(-a, -a, 2 * a, 2 * a);
      fillPaper(ctx, ink);
      stroke(ctx, ink, w);
      ctx.save();
      ctx.setLineDash([s * 0.05, s * 0.035]);
      ctx.beginPath();
      ctx.moveTo(-a, a);
      ctx.lineTo(a, -a);
      stroke(ctx, ink, w);
      ctx.restore();
      break;
    }
    case 'spray': {
      // Cooling-tower distribution: ISO 10628-2 spray nozzle (header with
      // nozzles), under the tower casing drawn as a trapezoid.
      const a = s * 0.38;
      ctx.beginPath();
      ctx.moveTo(-a * 0.7, -a);
      ctx.lineTo(a * 0.7, -a);
      ctx.lineTo(a, a);
      ctx.lineTo(-a, a);
      ctx.closePath();
      fillPaper(ctx, ink);
      stroke(ctx, ink, w);
      ctx.beginPath();
      ctx.moveTo(-a * 0.75, -a * 0.35);
      ctx.lineTo(a * 0.75, -a * 0.35);
      stroke(ctx, ink, w);
      for (const x of [-0.5, 0, 0.5]) {
        ctx.beginPath();
        ctx.moveTo(x * a, -a * 0.35);
        ctx.lineTo(x * a - a * 0.18, a * 0.15);
        ctx.moveTo(x * a, -a * 0.35);
        ctx.lineTo(x * a + a * 0.18, a * 0.15);
        stroke(ctx, ink, w * 0.7);
      }
      break;
    }
    case 'offPage': {
      // Off-page / battery-limit connector: arrow pentagon (ISO 10628-2 practice).
      const a = s * 0.3;
      const h = s * 0.16;
      ctx.beginPath();
      ctx.moveTo(-a, -h);
      ctx.lineTo(a * 0.5, -h);
      ctx.lineTo(a, 0);
      ctx.lineTo(a * 0.5, h);
      ctx.lineTo(-a, h);
      ctx.closePath();
      fillPaper(ctx, ink);
      stroke(ctx, ink, w);
      break;
    }
  }
  if (opts.control) {
    // ISA-5.1 diaphragm actuator: stem from the body up to a dome.
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, -s * 0.34);
    stroke(ctx, ink, w);
    ctx.beginPath();
    ctx.arc(0, -s * 0.34, s * 0.14, Math.PI, 0);
    ctx.closePath();
    fillPaper(ctx, ink);
    stroke(ctx, ink, w);
  }
  ctx.restore();
}

/**
 * ISA-5.1 instrument bubble: a circle with the function letters above the
 * loop number. `board` (main control room, operator-accessible) adds the
 * horizontal centre line; without it the instrument is field-mounted.
 */
export function drawInstrumentBubble(ctx: Ctx, letters: string, loop: string, r: number, ink: Ink, board: boolean): void {
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, Math.PI * 2);
  fillPaper(ctx, ink);
  stroke(ctx, ink, Math.max(1, r * 0.08));
  if (board) {
    ctx.beginPath();
    ctx.moveTo(-r, 0);
    ctx.lineTo(r, 0);
    stroke(ctx, ink, Math.max(1, r * 0.06));
  }
  ctx.fillStyle = ink.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(r * 0.62)}px system-ui, sans-serif`;
  ctx.fillText(letters, 0, -r * 0.42);
  ctx.font = `${Math.round(r * 0.55)}px system-ui, sans-serif`;
  ctx.fillText(loop, 0, r * 0.45);
  ctx.restore();
}

/** Stream number in a diamond (common PFD practice; not fixed by ISO 10628-2). */
export function drawStreamMarker(ctx: Ctx, n: number, h: number, ink: Ink): void {
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(0, -h);
  ctx.lineTo(h, 0);
  ctx.lineTo(0, h);
  ctx.lineTo(-h, 0);
  ctx.closePath();
  fillPaper(ctx, ink);
  stroke(ctx, ink, Math.max(1, h * 0.1));
  ctx.fillStyle = ink.ink;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = `600 ${Math.round(h * 0.9)}px system-ui, sans-serif`;
  ctx.fillText(String(n), 0, 0);
  ctx.restore();
}

/** Filled flow-direction arrowhead on a line, pointing +x (ISO 10628-2). */
export function drawFlowArrow(ctx: Ctx, s: number, ink: Ink): void {
  const a = s * 0.11;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(a, 0);
  ctx.lineTo(-a, -a * 0.7);
  ctx.lineTo(-a, a * 0.7);
  ctx.closePath();
  ctx.fillStyle = ink.ink;
  ctx.fill();
  ctx.restore();
}
