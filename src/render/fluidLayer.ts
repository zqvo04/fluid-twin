/**
 * Draws flow particles onto their own canvas every animation frame, kept
 * separate from tileLayer's on-demand redraw so dragging a slider doesn't
 * repaint the whole board 60 times a second — only the particle streaks do.
 *
 * Each particle draws as a streak along its own direction of travel, with
 * length and brightness set by its local speed. That turns the speed field
 * into something readable at a glance: fast fluid draws as bright lines, slow
 * fluid as faint dots, and a branch behind a shut valve fades out to an empty
 * pipe instead of sitting there as a heap of motionless dots.
 */

import { LinkFlow, Particle, particleView } from '../sim/particles';
import { LinkGeometry } from '../sim/linkGeometry';
import { PIPE_WIDTH_CELLS } from './sprites';
import { Viewport, cellSizePx } from './viewport';

const PARTICLE_COLOR = 'rgba(255, 255, 255, ALPHA)';
const PARTICLE_GLOW = 'rgba(150, 220, 240, ALPHA)';

/**
 * Velocity [m/s] at which a streak reaches full length and brightness. 3 m/s
 * is the usual design velocity for water in steel pipe, just under API RP
 * 14E's erosional limit — so a well-sized line draws bright, and a line
 * throttled down to a trickle draws faint. An absolute scale, so shutting a
 * valve visibly dims the whole line rather than everything simply
 * renormalising around the new maximum.
 */
const REFERENCE_VELOCITY = 3;
/** Streak length, in cells, for a particle moving at REFERENCE_VELOCITY. Kept
 *  well under a cell so streaks read as separate parcels of fluid rather than
 *  merging into one continuous smear. */
const STREAK_CELLS = 0.26;
/**
 * How much longer than that a local jet is allowed to draw. A valve gap runs
 * several times the reference speed, and letting its streaks stretch past
 * everything else is exactly the read we want — but not without a bound.
 */
const MAX_STREAK_SCALE = 1.6;
/** Fraction of the reference velocity below which a particle stops being
 *  drawn: a branch that has stopped flowing should look like empty pipe. */
const MIN_VISIBLE_FRACTION = 0.008;

/** Half the drawn pipe width, i.e. how far off the centreline the wall is. */
const BORE_RADIUS_CELLS = PIPE_WIDTH_CELLS / 2;
/** Keep streaks inside the drawn pipe rather than on its outline. */
const WALL_MARGIN = 0.78;
/** Segments a streak's trail is stepped down over, head to tail. */
const TAPER_STEPS = 4;

const withAlpha = (template: string, alpha: number) => template.replace('ALPHA', alpha.toFixed(3));

export function drawParticles(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  particles: Particle[],
  geometries: Map<string, LinkGeometry>,
  flows: Map<string, LinkFlow>,
): void {
  ctx.clearRect(0, 0, view.width, view.height);
  const s = cellSizePx(view);
  const width = Math.max(1.1, s * 0.042);

  ctx.save();
  ctx.lineCap = 'round';

  for (const p of particles) {
    const v = particleView(p, geometries, flows);
    if (!v) continue;

    // Speed against a fixed design velocity sets how much of a streak this is
    // and how present it looks.
    const rel = v.speed / REFERENCE_VELOCITY;
    if (rel < MIN_VISIBLE_FRACTION) continue;
    // Compressive curve: slow flow still registers, but stays clearly dimmer
    // than flow at design velocity.
    const alpha = v.fade * 0.9 * Math.pow(Math.min(1, rel), 0.7);
    if (alpha <= 0.02) continue;

    // Offset perpendicular to travel, so the stream has a cross-section.
    const nCol = -v.dRow;
    const nRow = v.dCol;
    const off = v.offset * BORE_RADIUS_CELLS * WALL_MARGIN;
    const cx = view.panX + (v.point.col + nCol * off) * s;
    const cy = view.panY + (v.point.row + nRow * off) * s;

    // Length follows the same normalized speed, converted to pixels.
    const streak = STREAK_CELLS * Math.min(rel, MAX_STREAK_SCALE) * s;
    if (streak <= width) {
      // Barely moving: a faint dot, not a streak.
      ctx.beginPath();
      ctx.arc(cx, cy, width * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = withAlpha(PARTICLE_COLOR, alpha);
      ctx.fill();
      continue;
    }

    // Taper the trail so streaks read as motion rather than as solid bars
    // that merge into each other where the flow is dense. Stepped segments
    // rather than a gradient: at up to a few hundred particles a frame,
    // allocating a gradient object per particle is pure garbage, and at this
    // size the steps are not resolvable anyway.
    for (let seg = 0; seg < TAPER_STEPS; seg++) {
      const near = (seg / TAPER_STEPS) * streak;
      const far = ((seg + 1) / TAPER_STEPS) * streak;
      // Segment 0 is at the head (brightest, full width); the tail thins and
      // dims toward nothing.
      const w = 1 - seg / TAPER_STEPS;
      ctx.beginPath();
      ctx.moveTo(cx - v.dCol * far, cy - v.dRow * far);
      ctx.lineTo(cx - v.dCol * near, cy - v.dRow * near);
      ctx.lineWidth = width * (0.35 + 0.65 * w);
      ctx.strokeStyle = withAlpha(seg === 0 ? PARTICLE_COLOR : PARTICLE_GLOW, alpha * w * w);
      ctx.stroke();
    }
  }
  ctx.restore();
}
