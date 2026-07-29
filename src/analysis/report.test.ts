import { describe, it, expect } from 'vitest';
import { generateReport, reportFindingsToUiFindings, reportToCsv, reportToMarkdown } from './report';
import { solveSteadyState } from '../physics/steadySolver';
import { waterProperties } from '../domain/fluid';
import { pumpSkidNetwork } from '../examples/demoNetworks';
import { PipelineNetwork } from '../domain/network';

describe('engineering report', () => {
  it('summarizes a solved network with pipe rows and a verdict', () => {
    const net = pumpSkidNetwork();
    const res = solveSteadyState(net);
    const report = generateReport(net, res, waterProperties(net.temperatureC));

    expect(report.converged).toBe(true);
    expect(report.system.nodes).toBe(net.nodes.length);
    expect(report.pipes.length).toBe(net.links.filter((l) => l.kind === 'pipe').length);
    expect(['PASS', 'ATTENTION REQUIRED']).toContain(report.verdict);
    // Every finding carries a governing clause.
    for (const f of report.findings) expect(f.clause.length).toBeGreaterThan(0);
  });

  it('flags a hoop-stress violation on a thin, over-pressured line', () => {
    // 2" Sch 40 held at a very high head → hoop stress exceeds allowable.
    const net: PipelineNetwork = {
      temperatureC: 20,
      subAssemblies: [],
      nodes: [
        { id: 'HP', type: 'reservoir', position: { x: 0, y: 0, z: 0 }, fixedHead: 3500 },
        { id: 'LP', type: 'reservoir', position: { x: 100, y: 0, z: 0 }, fixedHead: 3480 },
      ],
      links: [{ id: 'P', kind: 'pipe', from: 'HP', to: 'LP', nps: '2"', schedule: '40', length: 100 }],
    };
    const res = solveSteadyState(net);
    const report = generateReport(net, res, waterProperties(20));
    expect(report.verdict).toBe('ATTENTION REQUIRED');
    expect(report.findings.some((f) => f.severity === 'violation' && f.clause.includes('B31.3'))).toBe(true);
  });

  it('renders CSV and Markdown', () => {
    const net = pumpSkidNetwork();
    const res = solveSteadyState(net);
    const report = generateReport(net, res, waterProperties(20));

    const csv = reportToCsv(report);
    expect(csv.split('\n')[0]).toContain('pipe,size,flow_m3h');
    expect(csv.split('\n').length).toBe(report.pipes.length + 1);

    const md = reportToMarkdown(report);
    expect(md).toContain('# Pipeline Engineering Report');
    expect(md).toContain('Verdict:');
  });

  it('reportFindingsToUiFindings drops "ok" findings and maps severities for display', () => {
    const ui = reportFindingsToUiFindings([
      { severity: 'ok', component: '—', message: 'Nothing wrong.', clause: '—' },
      { severity: 'warning', component: 'PIPE1', message: 'Velocity high.', clause: 'API RP 14E' },
      { severity: 'violation', component: 'PIPE2', message: 'Stress high.', clause: 'ASME B31.3 §302.3' },
    ]);
    expect(ui).toHaveLength(2);
    expect(ui[0]).toEqual({ severity: 'warning', ref: 'PIPE1', message: 'Velocity high. (API RP 14E)' });
    // A "violation" maps to "error" (the UI's more urgent severity) and keeps its ref.
    expect(ui[1]).toEqual({ severity: 'error', ref: 'PIPE2', message: 'Stress high. (ASME B31.3 §302.3)' });
  });

  it('a hoop-stress violation on a solved network surfaces as an "error" UI finding with a resolvable ref', () => {
    const net: PipelineNetwork = {
      temperatureC: 20,
      subAssemblies: [],
      nodes: [
        { id: 'HP', type: 'reservoir', position: { x: 0, y: 0, z: 0 }, fixedHead: 3500 },
        { id: 'LP', type: 'reservoir', position: { x: 100, y: 0, z: 0 }, fixedHead: 3480 },
      ],
      links: [{ id: 'P', kind: 'pipe', from: 'HP', to: 'LP', nps: '2"', schedule: '40', length: 100 }],
    };
    const res = solveSteadyState(net);
    const report = generateReport(net, res, waterProperties(20));
    const ui = reportFindingsToUiFindings(report.findings);
    expect(ui.some((f) => f.severity === 'error' && f.ref === 'P')).toBe(true);
  });
});
