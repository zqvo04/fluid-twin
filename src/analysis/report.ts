/**
 * Engineering report generation. Aggregates the steady-state result and every
 * vulnerability analyzer into a single structured report with pass/fail
 * verdicts and the governing code clause for each finding, then renders it to
 * Markdown / CSV / HTML for export. Pure and unit-tested.
 */

import { G } from '../domain/units';
import { FluidState } from '../domain/fluid';
import { PipelineNetwork, nodeById, linkLength } from '../domain/network';
import { pipeGeometry, A106B } from '../domain/catalog/pipes';
import { SteadyResult } from '../physics/steadySolver';
import { analyzeHoopStress } from './stress';
import { analyzePumpHealth } from './pumpHealth';
import { analyzeNetworkVulnerability } from './networkVulnerability';

/** Governing guidance for each pump condition (see analysis/pumpHealth.ts). */
const PUMP_CLAUSE: Record<string, string> = {
  churn: 'Minimum continuous thermal flow (HI 9.6.3 / API 610)',
  'dry-run': 'NPSH available (HI 9.6.1)',
  cavitating: 'NPSH margin (HI 9.6.1)',
  overload: 'Hydraulic Institute (70–120% BEP)',
  'low-flow': 'Hydraulic Institute (70–120% BEP)',
};

export type Verdict = 'PASS' | 'ATTENTION REQUIRED';
export type Severity = 'ok' | 'warning' | 'violation';

export interface ReportFinding {
  severity: Severity;
  component: string;
  message: string;
  clause: string;
}

export interface PipeRow {
  id: string;
  size: string;
  length: number;
  flow_m3h: number;
  velocity: number;
  headLoss: number;
  gaugeBar: number;
  hoopUtilPct: number;
}

export interface Report {
  generatedAt: string;
  temperatureC: number;
  fluidRho: number;
  converged: boolean;
  iterations: number;
  system: {
    nodes: number;
    links: number;
    totalDemand_m3h: number;
    maxHead: number;
    minHead: number;
    maxVelocity: number;
  };
  pipes: PipeRow[];
  findings: ReportFinding[];
  verdict: Verdict;
}

function gaugeHeadAtPipe(net: PipelineNetwork, result: SteadyResult, from: string, to: string): number {
  const hf = (result.heads.get(from) ?? 0) - nodeById(net, from).position.y;
  const ht = (result.heads.get(to) ?? 0) - nodeById(net, to).position.y;
  return Math.max(hf, ht); // governing (higher) gauge pressure head on the run
}

export function generateReport(net: PipelineNetwork, result: SteadyResult, fluid: FluidState): Report {
  const findings: ReportFinding[] = [];

  // --- Per-pipe rows + hoop stress -------------------------------------
  const pipes: PipeRow[] = [];
  let maxVelocity = 0;
  for (const link of net.links) {
    if (link.kind !== 'pipe') continue;
    const r = result.links.get(link.id);
    if (!r) continue;
    const geo = pipeGeometry(link.nps, link.schedule);
    const gaugeHead = gaugeHeadAtPipe(net, result, link.from, link.to);
    const stress = analyzeHoopStress(gaugeHead, gaugeHead, geo, A106B, fluid.rho);
    const gaugeBar = (gaugeHead * fluid.rho * G) / 1e5;
    maxVelocity = Math.max(maxVelocity, Math.abs(r.velocity));
    pipes.push({
      id: link.id,
      size: `${link.nps} Sch ${link.schedule}`,
      length: linkLength(net, link),
      flow_m3h: r.flow * 3600,
      velocity: r.velocity,
      headLoss: r.headLoss,
      gaugeBar,
      hoopUtilPct: stress.sustainedUtil * 100,
    });
    if (stress.sustainedUtil > 1) {
      findings.push({
        severity: 'violation',
        component: link.id,
        message: `Hoop stress ${(stress.sustainedStress / 1e6).toFixed(0)} MPa exceeds allowable S ${(A106B.allowable / 1e6).toFixed(0)} MPa (util ${(stress.sustainedUtil * 100).toFixed(0)}%).`,
        clause: 'ASME B31.3 §302.3',
      });
    }
  }

  // --- Pumps: duty point, suction condition, churn ----------------------
  // Churn and dry running destroy a pump on a timescale of minutes, so they
  // are violations; off-BEP operation is wear, so it is a warning.
  const health = analyzePumpHealth(net, result, fluid);
  for (const h of health) {
    if (h.state === 'ok' || h.state === 'stopped') continue;
    const acute = h.state === 'churn' || h.state === 'dry-run' || h.state === 'cavitating';
    findings.push({
      severity: acute ? 'violation' : 'warning',
      component: h.linkId,
      message: h.message,
      clause: PUMP_CLAUSE[h.state],
    });
  }

  const vuln = analyzeNetworkVulnerability(net, result, fluid);
  for (const e of vuln.erosion) {
    findings.push({
      severity: 'warning',
      component: e.linkId,
      message: `Velocity ${e.velocity.toFixed(1)} m/s exceeds erosional limit ${e.limit.toFixed(1)} m/s.`,
      clause: 'API RP 14E',
    });
  }
  for (const v of vuln.valveCavitation) {
    if (v.cavitating) {
      findings.push({
        severity: 'warning',
        component: v.linkId,
        message: `Valve cavitating: σ ${v.sigma.toFixed(1)} < incipient ${v.sigmaIncipient} at ΔP ${v.headLoss.toFixed(1)} m.`,
        clause: 'ISA cavitation index',
      });
    }
  }

  const heads = [...result.heads.values()];
  const totalDemand = net.nodes.reduce((s, n) => s + Math.max(0, n.demand ?? 0), 0);

  if (findings.length === 0) {
    findings.push({ severity: 'ok', component: '—', message: 'No violations or warnings detected.', clause: '—' });
  }
  const verdict: Verdict = findings.some((f) => f.severity === 'violation') ? 'ATTENTION REQUIRED' : 'PASS';

  return {
    generatedAt: new Date().toISOString(),
    temperatureC: net.temperatureC,
    fluidRho: fluid.rho,
    converged: result.converged,
    iterations: result.iterations,
    system: {
      nodes: net.nodes.length,
      links: net.links.length,
      totalDemand_m3h: totalDemand * 3600,
      maxHead: heads.length ? Math.max(...heads) : 0,
      minHead: heads.length ? Math.min(...heads) : 0,
      maxVelocity,
    },
    pipes,
    findings,
    verdict,
  };
}

/** A UI-facing finding: a non-"ok" ReportFinding trimmed to what a solve
 * response needs to carry (severity + message + the link/component it
 * refers to), for panels that don't care about the full Report shape. */
export interface UiFinding {
  severity: 'error' | 'warning';
  message: string;
  ref?: string;
}

/** Drop "ok" (no news) findings and translate the rest for display: a
 * "violation" is solver-adjacent enough to flag as an error, a "warning"
 * stays a warning. The governing code clause is folded into the message
 * since UiFinding has no separate field for it. */
export function reportFindingsToUiFindings(findings: ReportFinding[]): UiFinding[] {
  return findings
    .filter((f) => f.severity !== 'ok')
    .map((f) => ({
      severity: f.severity === 'violation' ? 'error' : 'warning',
      message: `${f.message} (${f.clause})`,
      ref: f.component !== '—' ? f.component : undefined,
    }));
}

// --- Renderers -----------------------------------------------------------

export function reportToCsv(r: Report): string {
  const rows = [
    ['pipe', 'size', 'flow_m3h', 'velocity_m_s', 'head_loss_m', 'gauge_bar', 'hoop_util_pct'],
    ...r.pipes.map((p) => [
      p.id,
      p.size,
      p.flow_m3h.toFixed(1),
      p.velocity.toFixed(2),
      p.headLoss.toFixed(2),
      p.gaugeBar.toFixed(2),
      p.hoopUtilPct.toFixed(0),
    ]),
  ];
  return rows.map((cols) => cols.join(',')).join('\n');
}

/** Self-contained, printable HTML document for the report. */
export function reportToHtml(r: Report): string {
  const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] ?? c));
  const badge = r.verdict === 'PASS' ? '#1f9d55' : '#d93a2b';
  const pipeRows = r.pipes
    .map(
      (p) =>
        `<tr><td>${esc(p.id)}</td><td>${esc(p.size)}</td><td>${p.flow_m3h.toFixed(1)}</td><td>${p.velocity.toFixed(2)}</td><td>${p.headLoss.toFixed(2)}</td><td>${p.gaugeBar.toFixed(2)}</td><td>${p.hoopUtilPct.toFixed(0)}%</td></tr>`,
    )
    .join('');
  const findingRows = r.findings
    .map((f) => {
      const color = f.severity === 'violation' ? '#d93a2b' : f.severity === 'warning' ? '#c07a00' : '#1f9d55';
      return `<li><b style="color:${color}">${f.severity.toUpperCase()}</b> — <b>${esc(f.component)}</b> ${esc(f.message)} <i style="color:#888">(${esc(f.clause)})</i></li>`;
    })
    .join('');
  return `<!doctype html><html><head><meta charset="utf-8"><title>Pipeline Engineering Report</title>
<style>body{font-family:system-ui,sans-serif;max-width:820px;margin:32px auto;color:#1a1a1a;padding:0 16px}
h1{margin-bottom:4px}table{border-collapse:collapse;width:100%;margin:12px 0;font-size:14px}
th,td{border:1px solid #ddd;padding:6px 8px;text-align:right}th{background:#f4f6f8;text-align:right}
td:first-child,td:nth-child(2),th:first-child,th:nth-child(2){text-align:left}
.badge{display:inline-block;padding:4px 12px;border-radius:6px;color:#fff;font-weight:700;background:${badge}}
.muted{color:#666}ul{line-height:1.6}</style></head><body>
<h1>Pipeline Engineering Report</h1>
<p class="muted">Generated ${esc(r.generatedAt)} · water @ ${r.temperatureC} °C · solver ${r.converged ? 'converged' : 'NOT converged'} (${r.iterations} it)</p>
<p>Verdict: <span class="badge">${r.verdict}</span></p>
<h2>System</h2>
<p>Nodes ${r.system.nodes} · Links ${r.system.links} · Demand ${r.system.totalDemand_m3h.toFixed(0)} m³/h ·
Head ${r.system.minHead.toFixed(1)}–${r.system.maxHead.toFixed(1)} m · Peak velocity ${r.system.maxVelocity.toFixed(2)} m/s</p>
<h2>Pipes</h2>
<table><thead><tr><th>Pipe</th><th>Size</th><th>Flow (m³/h)</th><th>Vel (m/s)</th><th>ΔH (m)</th><th>P (bar)</th><th>Hoop</th></tr></thead>
<tbody>${pipeRows}</tbody></table>
<h2>Findings</h2><ul>${findingRows}</ul>
<p class="muted">FluidTwin 3D · ASME B31.3 · API RP 14E · ISA · Hydraulic Institute</p>
</body></html>`;
}

export function reportToMarkdown(r: Report): string {
  const lines: string[] = [];
  lines.push(`# Pipeline Engineering Report`);
  lines.push('');
  lines.push(`- Generated: ${r.generatedAt}`);
  lines.push(`- Fluid: water @ ${r.temperatureC} °C (ρ ${r.fluidRho.toFixed(0)} kg/m³)`);
  lines.push(`- Solver: ${r.converged ? 'converged' : 'NOT converged'} in ${r.iterations} iterations`);
  lines.push(`- **Verdict: ${r.verdict}**`);
  lines.push('');
  lines.push(`## System`);
  lines.push(`- Nodes ${r.system.nodes} · Links ${r.system.links}`);
  lines.push(`- Total demand: ${r.system.totalDemand_m3h.toFixed(0)} m³/h`);
  lines.push(`- Head range: ${r.system.minHead.toFixed(1)} … ${r.system.maxHead.toFixed(1)} m`);
  lines.push(`- Peak velocity: ${r.system.maxVelocity.toFixed(2)} m/s`);
  lines.push('');
  lines.push(`## Pipes`);
  lines.push(`| Pipe | Size | Flow (m³/h) | Vel (m/s) | ΔH (m) | P (bar) | Hoop % |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const p of r.pipes) {
    lines.push(
      `| ${p.id} | ${p.size} | ${p.flow_m3h.toFixed(1)} | ${p.velocity.toFixed(2)} | ${p.headLoss.toFixed(2)} | ${p.gaugeBar.toFixed(2)} | ${p.hoopUtilPct.toFixed(0)} |`,
    );
  }
  lines.push('');
  lines.push(`## Findings`);
  for (const f of r.findings) {
    const tag = f.severity === 'violation' ? '❌' : f.severity === 'warning' ? '⚠️' : '✅';
    lines.push(`- ${tag} **${f.component}** — ${f.message} _(${f.clause})_`);
  }
  return lines.join('\n');
}
