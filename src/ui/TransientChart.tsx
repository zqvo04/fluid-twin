import { useEffect, useRef } from 'react';
import { TransientHistoryPoint } from './store';

interface Props {
  history: TransientHistoryPoint[];
  width?: number;
  height?: number;
}

/** A minimal min/max-head-vs-time line chart. No chart library — a couple
 * of polylines on a canvas is all this needs. */
export function TransientChart({ history, width = 220, height = 64 }: Props) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    if (history.length < 2) return;

    const tMax = history[history.length - 1].time || 1;
    let hMin = Infinity;
    let hMax = -Infinity;
    for (const p of history) {
      if (p.minHead < hMin) hMin = p.minHead;
      if (p.maxHead > hMax) hMax = p.maxHead;
    }
    if (hMax - hMin < 1e-6) hMax = hMin + 1;

    const x = (t: number) => (t / tMax) * width;
    const y = (h: number) => height - ((h - hMin) / (hMax - hMin)) * height;

    const drawLine = (key: 'minHead' | 'maxHead', color: string) => {
      ctx.beginPath();
      history.forEach((p, i) => {
        const px = x(p.time);
        const py = y(p[key]);
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      });
      ctx.strokeStyle = color;
      ctx.lineWidth = 1.5;
      ctx.stroke();
    };

    drawLine('maxHead', '#e4527a');
    drawLine('minHead', '#4ea8de');
  }, [history, width, height]);

  return <canvas ref={ref} className="transient-chart" />;
}
