import { describe, it, expect, beforeAll, vi } from 'vitest';
import { WorkerRequest, WorkerResponse, ScenarioFrameResponse, SurgeCheckResponse } from './protocol';
import { compile } from '../grid/compile';
import { coolingLoop } from '../grid/testLoop';
import { scenarioModel, networkEvents } from '../grid/scenario';
import { solveSteadyState } from '../physics/steadySolver';

// Drive the real worker module through a fake `self`. Every message goes
// through structuredClone both ways, exactly as postMessage would.
const posted: WorkerResponse[] = [];
let send: (req: WorkerRequest) => void;

beforeAll(async () => {
  const fake = {
    postMessage: (m: WorkerResponse) => posted.push(structuredClone(m)),
    onmessage: null as null | ((e: { data: WorkerRequest }) => void),
  };
  vi.stubGlobal('self', fake);
  await import('./simulation.worker');
  send = (req) => fake.onmessage!({ data: structuredClone(req) });
});

const { grid, ids } = coolingLoop();
const compiled = compile(grid);

describe('worker RUN_SCENARIO', () => {
  it('streams every frame to done, Maps intact, values = direct solve', async () => {
    posted.length = 0;
    send({
      type: 'RUN_SCENARIO',
      requestId: 7,
      model: scenarioModel(grid, compiled),
      events: networkEvents(compiled, [{ kind: 'valveStroke', t: 1, id: ids.valve, target: 0.5, timeS: 1 }]),
      durationS: 3,
      dt: 0.5,
      framesPerTick: 2,
    });
    await vi.waitFor(() => expect(posted.some((m) => m.type === 'SCENARIO_FRAME' && m.done)).toBe(true));
    const frames = posted as ScenarioFrameResponse[];
    expect(frames.map((m) => m.frame.t)).toEqual([0, 0.5, 1, 1.5, 2, 2.5, 3]);
    expect(frames.every((m) => m.requestId === 7)).toBe(true);
    expect(frames.filter((m) => m.done)).toHaveLength(1);
    const last = frames[frames.length - 1].frame;
    expect(last.result.heads).toBeInstanceOf(Map);
    const valveLink = compiled.tileLink.get(ids.valve)!;
    expect(last.openings[valveLink]).toBe(0.5);
    const direct = solveSteadyState({
      ...compiled.network,
      links: compiled.network.links.map((l) => (l.id === valveLink && l.kind === 'valve' ? { ...l, opening: 0.5 } : l)),
    });
    expect(last.result.links.get(valveLink)!.flow).toBeCloseTo(direct.links.get(valveLink)!.flow, 6);
  });

  it('STOP_TRANSIENT cancels a running scenario', async () => {
    posted.length = 0;
    send({ type: 'RUN_SCENARIO', requestId: 8, model: scenarioModel(grid, compiled), events: [], durationS: 100, framesPerTick: 1 });
    await vi.waitFor(() => expect(posted.length).toBeGreaterThan(0));
    send({ type: 'STOP_TRANSIENT', requestId: 8 });
    const n = posted.length;
    await new Promise((r) => setTimeout(r, 100));
    expect(posted.length).toBe(n);
    expect(posted.some((m) => m.type === 'SCENARIO_FRAME' && m.done)).toBe(false);
  });
});

describe('worker SURGE_CHECK', () => {
  it('returns the envelope and the recommendation', () => {
    posted.length = 0;
    const pump = compiled.tileLink.get(ids.pump)!;
    send({ type: 'SURGE_CHECK', requestId: 9, network: compiled.network, event: { kind: 'pumpStop', t: 0, id: pump }, durationS: 2 });
    const [res] = posted as SurgeCheckResponse[];
    expect(res.type).toBe('SURGE_CHECK_RESULT');
    expect(res.requestId).toBe(9);
    expect(res.recommended).toBe(true); // a trip is instantaneous
    expect(Object.keys(res.result.maxHead).sort()).toEqual(compiled.network.nodes.map((n) => n.id).sort());
    expect(res.result.trough.drop).toBeGreaterThan(0); // a trip drops the discharge head
  });
});

describe('worker START_NET_TRANSIENT (surge check, streamed)', () => {
  it('streams a fast valve closure: peak where the batch surgeCheck finds it', async () => {
    const { GRID_PRESETS } = await import('../examples/gridPresets');
    const { surgeCheck } = await import('../physics/networkTransient');
    const g = GRID_PRESETS.find((p) => p.name === '개방형 냉각수 루프')!.build();
    const c = compile(g);
    const fcv = g.tiles.find((t) => 'tag' in t && t.tag === 'FCV-101')!.id;
    const [event] = networkEvents(c, [{ kind: 'valveStroke', t: 0, id: fcv, target: 0, timeS: 0.2 }]);
    posted.length = 0;
    send({ type: 'START_NET_TRANSIENT', requestId: 11, network: c.network, event, stepsPerFrame: 400, seconds: 2 });
    await vi.waitFor(() => expect(posted.some((m) => m.type === 'NET_TRANSIENT_FRAME' && m.done)).toBe(true), { timeout: 5000 });
    const last = posted.filter((m) => m.type === 'NET_TRANSIENT_FRAME').pop()!;
    if (last.type !== 'NET_TRANSIENT_FRAME') throw new Error('unreachable');
    expect(c.network.nodes.map((n) => n.id)).toContain(last.peakNodeId);
    // 0.2 s is slow for this short loop (10·2L/a ≈ 0.12 s): a few metres, not Joukowsky.
    expect(last.peakSurge).toBeGreaterThan(1);
    expect(last.pumpSpeed).toBe(1); // a valve event reports no pump
    const batch = surgeCheck(c.network, event, 2);
    // Same sim (surgeSim), same steps: the live panel shows the batch check's numbers.
    expect(last.peakNodeId).toBe(batch.peak.nodeId);
    expect(last.peakSurge).toBeCloseTo(batch.peak.rise, 6);
  });

  it('a pump-start event reports the started pump speed', async () => {
    const { GRID_PRESETS } = await import('../examples/gridPresets');
    const g = GRID_PRESETS.find((p) => p.name === '개방형 냉각수 루프')!.build();
    const c = compile(g);
    const b = g.tiles.find((t) => 'tag' in t && t.tag === 'P-101B')!.id;
    const [event] = networkEvents(c, [{ kind: 'pumpStart', t: 0, id: b, rampS: 1 }]);
    posted.length = 0;
    send({ type: 'START_NET_TRANSIENT', requestId: 12, network: c.network, event, stepsPerFrame: 400, seconds: 2 });
    await vi.waitFor(() => expect(posted.some((m) => m.type === 'NET_TRANSIENT_FRAME' && m.done)).toBe(true), { timeout: 5000 });
    const last = posted.filter((m) => m.type === 'NET_TRANSIENT_FRAME').pop()!;
    if (last.type !== 'NET_TRANSIENT_FRAME') throw new Error('unreachable');
    expect(last.pumpSpeed).toBe(1); // ramp of 1 s done within 2 s
  });
});
