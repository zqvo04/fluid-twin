/**
 * Draws flow particles onto their own canvas every animation frame, kept
 * separate from tileLayer's on-demand redraw so dragging a slider doesn't
 * repaint the whole board 60 times a second — only the particle dots do.
 */

import { Particle, particlePosition } from '../sim/particles';
import { LinkGeometry } from '../sim/linkGeometry';
import { Viewport, cellSizePx } from './viewport';

const PARTICLE_COLOR = 'rgba(255, 255, 255, 0.9)';
const PARTICLE_GLOW = 'rgba(120, 210, 235, 0.55)';

export function drawParticles(
  ctx: CanvasRenderingContext2D,
  view: Viewport,
  particles: Particle[],
  geometries: Map<string, LinkGeometry>,
): void {
  ctx.clearRect(0, 0, view.width, view.height);
  const s = cellSizePx(view);
  const r = Math.max(1.5, s * 0.06);

  ctx.save();
  for (const p of particles) {
    const pos = particlePosition(p, geometries);
    if (!pos) continue;
    const x = view.panX + pos.col * s;
    const y = view.panY + pos.row * s;

    ctx.beginPath();
    ctx.arc(x, y, r * 1.8, 0, Math.PI * 2);
    ctx.fillStyle = PARTICLE_GLOW;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = PARTICLE_COLOR;
    ctx.fill();
  }
  ctx.restore();
}
