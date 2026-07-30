# FluidTwin 3D

Industrial 3D pipeline digital twin and vulnerability analysis simulator. A
browser-based engineering tool for validating plant hydraulics and finding
transient vulnerabilities (water hammer, cavitation, pipe overstress) before
they happen.

See [`docs/ARCHITECTURE_AND_ROADMAP.md`](docs/ARCHITECTURE_AND_ROADMAP.md) for
the full physics/architecture design and the 7-phase roadmap.

## Status

| Phase | Scope | State |
|---|---|---|
| **0** | Scaffolding (Vite + React + R3F + Zustand + Web Worker + Vitest) | ✅ done |
| **1** | Domain core + steady-state solver (GGA / Newton-Raphson) | ✅ done |
| **2** | Modular assembly + InstancedMesh Global View + pump BEP warning | ✅ done |
| **3** | Transient MOC water-hammer engine + streamed Water Hammer Lab | ✅ done |
| **4** | Vulnerability analysis (cavitation, B31.3, NPSH, erosion) + navigation | ✅ done |
| **5** | Surge-protection design loop, flow viz, fly-to, static-pipe highlight | ✅ done |
| **B** | Interactive 3D pipeline builder (place / connect / edit / delete) | ✅ done |
| **T** | Network-wide transient (MOC) on any built network, live | ✅ done |
| **6** | Engineering reports + example plants + exports | ✅ done |
| **7** | Section-based multi-view platform (plant overview ↔ per-section pages) + platform UI | ✅ done |

## What Phase 1 delivers

A physics core that is fully decoupled from React/Three.js and independently
verified against textbook benchmarks:

- **Part catalog with real spec data** — ASME B36.10M pipe dimensions (2/4/6/8",
  Sch 40/80), Crane TP-410 K-factors for four valve types (gate, globe, ball,
  butterfly) with their inherent Cv characteristic curves, fitting losses, and
  a fitted centrifugal pump model (H-Q curve, BEP, NPSHr, inertia).
- **Temperature-dependent water properties** (density, viscosity, vapor
  pressure, bulk modulus) from 0–150 °C.
- **Steady-state solver** — the Global Gradient Algorithm (Todini & Pilati),
  the method behind EPANET: nonlinear network solve with gravity, Churchill
  friction (all-regime), pump curves, and partial-open valves, solved by Newton
  iteration on a symmetric positive-definite head system.
- **A minimal 3D Global View** — the demo pump-skid network rendered in R3F with
  the head field colored blue→red, plus a control panel that runs the analysis
  in the Web Worker and inspects component results.

## What Phase 2 adds

- **Modular assembly** — a SubAssembly (pump skid) can be cloned with fresh IDs
  and a spatial offset, then wired into a larger end-to-end network.
- **Project save/load** — the network serializes to versioned JSON with
  validation on load.
- **Connector checks** — flags NPS size changes at a node with no reducer.
- **InstancedMesh Global View** — every pipe draws in a single call; a
  procedural 480-pipe grid demonstrates the performance target (verified to
  render and solve in-browser with no errors).
- **Pump condition analysis** — see the *Pump model* section: duty point
  against the 70–120% BEP window, suction (NPSH) margin, and churn damage.
- **Live parameter editing** — valve opening and pump speed sliders in the
  inspector; edits invalidate the stale result so a re-solve is one click away.

## What Phase 3 adds

The **Water Hammer Lab** — the canonical reservoir → pipe → valve transient,
solved live by the Method of Characteristics:

- **MOC solver** (`physics/transient.ts`) — the compressible unsteady flow
  equations solved along characteristics at Courant number 1, with reservoir,
  valve-closure, and friction boundary conditions. Verified against the
  Joukowsky surge `a·V0/g`, the `4L/a` wave period, and gradual-closure
  attenuation.
- **Korteweg wave speed** — celerity from the fluid bulk modulus and the pipe's
  elastic wall, so each size/schedule carries the wave differently.
- **Worker streaming** — the transient runs in the Web Worker and streams
  pressure frames (transferred buffers) to the render thread; the 3D scene and
  the pressure chart read them in their own loops, bypassing React (the Phase 3
  compute/render split; a `SharedArrayBuffer` upgrade is a drop-in for
  full-network fields).
- **Live visualization** — the pipe deflects and recolors as the pressure wave
  travels back and forth; a red ribbon traces the worst-case (peak-head)
  envelope; a pressure-vs-time chart at the valve shows the surge against the
  Joukowsky reference lines. Sub-atmospheric head raises a column-separation /
  cavitation warning (modeled fully in Phase 4).

## What Phase 4 adds

Vulnerability analysis that turns the transient field into engineering
verdicts, plus assembly-friendly navigation:

- **Column separation / cavitation (DVCM)** — when the head would fall below the
  vapor level, a Discrete Vapor Cavity Model pins it and tracks a cavity volume
  from the upstream/downstream flow mismatch; on refill the cavity collapses and
  the rejoining columns produce a pressure spike. Verified: cavity forms at a
  closed valve, collapses, and the rejoinder drives the head *above* the initial
  surge — the mechanism behind real column-separation damage. Rendered as vapor
  bubbles at the affected sections.
- **ASME B31.3 hoop stress** — sustained and occasional (1.33 S) utilization from
  the steady and peak-surge pressure envelope, with a burst-risk warning.
- **API RP 14E erosional velocity** checks on the steady network, surfaced in
  the warnings panel. (Pump suction / NPSH is covered by the pump model below.)
- **Navigation** — CameraControls (orbit + pan + dolly with damping), view
  presets (Fit / Iso / Top / Front / Side), and WASD/QE + arrow-key movement, so
  the model can be inspected and assembled, not just spun.

## What Phase 5 adds

- **Surge-protection design loop** — an air chamber (surge vessel) can be
  installed just upstream of the valve; the trapped gas cushions the surge via a
  polytropic gas law solved as an MOC boundary. This closes the find→fix→verify
  loop: a rapid closure that surges to ~52 bar drops to ~18 bar once the chamber
  is added (verified in-browser). The vessel is drawn in the scene.
- **Static-pipe stress highlighting** (feedback) — the pipe no longer deflects;
  it is geometrically fixed and colored by local pressure, with a pulsing red
  sleeve on any section that exceeds the B31.3 occasional allowable. The
  pressure wave is shown as a separate diagnostic graph floating above the pipe.
- **Flow visualization in the Global view** (feedback) — once solved, markers
  advect along each pipe in the flow direction at a speed set by the computed
  velocity.
- **Fly-to (Global→Detail)** — clicking a component or an alarm smoothly frames
  it; combined with the Phase 4 view presets this is the Detail-view navigation.

## Interactive builder

The simulator is a build-your-own-plant tool, not just a viewer. In **Build
mode** the user:

- draws a pipeline with the **Pipe Run** tool — each ground click drops a node
  and connects it to the last, snapping to nearby nodes so runs branch and close
  loops (Esc finishes); a ghost marker and rubber-band line make it feel like
  drawing,
- or drops **tanks/reservoirs and junctions** individually and **connects** any
  two nodes with a **pipe, valve, or pump** — valves cover the four industrial
  types (gate, globe, ball, butterfly) with their real Cv/K characteristics,
- **edits** every property (node type, elevation, demand, fixed head; component
  kind, size 2–8", Sch 40/80, valve type) through an inspector,
- **deletes** components (cascading to incident links), or starts from a blank
  canvas,

with hover highlighting and pointer cursors throughout. The user then runs
steady + vulnerability analysis on whatever they built. All editing is pure,
immutable, and unit-tested (`domain/edit.ts`).

**Flow visualization** — pipes are drawn as chunky tubes and bright glowing
slugs travel through them in the flow direction at a speed proportional to the
computed velocity, colored by magnitude. A **live flow dashboard** overlays the
Global view with system metrics (demand, peak velocity, max head) and a per-pipe
list of animated "flowing" bars whose stripe speed tracks the velocity.

**Game-like building** — a Minecraft-style block cursor: a glowing grid cell
follows the mouse, a ghost of the component-to-place hovers in it, and during a
Pipe Run a ghost pipe previews the next segment. Nodes highlight on hover.
**Cities-Skylines tap-in**: in Pipe Run, click an existing pipe to split it at
that point (insert a junction) and branch off it, or click a node to
start/continue a run from it.

**Free 3D building (elevation & gravity)** — the build work-plane is a visible
grid you raise/lower with R/F (Shift ×5) or the ±5/±1 buttons; placing at
different heights draws real risers, and the plane snaps to existing node
heights. A selected node's elevation is nudged from the inspector. Every node
carries a 3D label showing its elevation and, once solved, its gauge pressure —
so the static head from gravity is visible where it acts. (The GGA/MOC solvers
already take each node's elevation as static head, so a taller riser really does
change the pressures.)

**Component pressure readout** — every valve and pump shows a live 3D label with
its pressure drop (ΔP, bar) and, for valves, the opening; the valve marker glows
amber→red with the magnitude of its head loss, so a throttled valve visibly does
work. A throttled valve whose cavitation index σ falls below its incipient value
is flagged (ISA), since in steady flow the volumetric rate is conserved across
the valve — the physics the valve expresses is the *pressure* drop, not a speed
change.

## Pump model

A centrifugal pump does not push a slug of liquid down the discharge. The
impeller flings liquid outward, leaving a low-pressure region at its eye, and
ambient pressure on the supply surface pushes liquid up the suction line into
it. Everything below follows from that.

**Direction.** A pump's two ports are not interchangeable: port 0 is the
suction, port 1 the discharge (W then E on an unrotated tile), and the compiler
maps them to the `PumpLink`'s `from`/`to` in that order. The tile draws a
converging funnel on the suction side and a chevron on the discharge, so
orientation is readable without opening the inspector. A discharge check valve
is fitted by default; reverse flow through it is a blocked line, and a pump
without one is charged a quadratic obstruction resistance rather than its
mirrored head curve, which has no meaning outside a four-quadrant model.

**Suction limit (`domain/catalog/pumps.ts`).** How hard a pump can pull is set
by absolute pressure, not by the motor:

```
NPSHa = (p_atm − p_v)/(ρg) + (H_suction − z_suction)
NPSHr(Q) = NPSHr_bep · (Q/Q_bep)²
```

Deliverable head is scaled by a factor that is 1 above NPSHr and falls linearly
to 0 at half of it — NPSHr is the 3%-head-drop point by definition, not the
point where a pump quits. So a pump asked to lift more than the atmosphere can
push under-delivers, and once fully starved it is vapor-bound: no head, and no
throughflow either. The suction-lift preset shows the whole progression.

NPSHr rising with Q² is a strong negative feedback (more flow ⇒ hungrier
impeller), so its derivative goes into the solver's Jacobian rather than an
outer fixed point, which oscillates. Only the weaker dependence on the solved
suction head stays a relaxed fixed point, and the solver requires that relaxed
state to settle before calling a solve converged. The Newton step is damped
adaptively, since a full step can limit-cycle on a pump curve.

**Churn, dry running and off-BEP (`analysis/pumpHealth.ts`).** Shaft power does
not vanish when the discharge shuts: a radial impeller still absorbs about half
its BEP power at zero flow, and with nothing leaving the casing all of it heats
the liquid trapped inside. The analyzer reports the casing temperature-rise
rate, the time to an allowable 15 K rise, and the thermal minimum flow that
would carry the heat away, alongside dry running, cavitation, low-flow
recirculation and runout. Each pump gets a 0–1 stress index, drawn as a
green→red ring on the tile and a meter in the inspector, and the acute
conditions become report violations.

## Network-wide transient (time domain)

Any built network can be analyzed in the time domain, not just the single-line
lab. `physics/networkTransient.ts` runs the Method of Characteristics on the
whole graph: every pipe carries the wave (MOC reaches at a common,
Courant-adjusted Δt), and each time step solves all node heads simultaneously by
Newton — junctions, tees, valves and pumps are handled uniformly. The initial
condition is the steady solution, so closing a valve launches the surge and the
pipes recolor with the travelling pressure wave; the panel reports the live peak
surge and minimum head.

Verified: reproduces the `a·V0/g` Joukowsky surge on a branched line, holds the
steady state when nothing changes, and conserves mass at a tee. Massless
internal nodes get a small compliance and heads are clamped at the vapor level
(a column-separation limiter) for stability.

**Pump trip (power failure).** A running pump is a stiff head-gain link; on trip
the motor torque vanishes and the rotor spins down under fluid torque —
`I·dω/dt = −ρgQH/(ηω)` — with the pump head following the affinity-scaled curve
at the falling speed and a discharge check valve (no reverse flow). So a heavier
rotor sustains flow longer and softens the surge, and the check-valve slam on
flow reversal drives the classic power-failure surge; live pump speed is
reported. Verified: the rotor spins to rest, more inertia delays the flow decay,
and an un-tripped pump holds steady flow. (This captures inertia, gravity, and
speed-dependent head; full empirical Suter 4-quadrant turbine-zone data is a
further refinement.)

## Engineering report & example plants (Phase 6)

`analysis/report.ts` aggregates the steady result and every vulnerability
analyzer (B31.3 hoop stress, pump BEP, NPSH, API RP 14E erosion, ISA valve
cavitation) into a single report with a **PASS / ATTENTION REQUIRED** verdict
and the governing code clause on each finding. It renders to a printable **HTML**
document, a **CSV** results table, and Markdown, all downloadable from the panel.

Four **example plants** ship for one-click loading: the pump skid, a gravity
main (a water-hammer showcase), a cooling-water loop, and the 480-pipe stress
grid — each validated to converge.

## Section-based multi-view platform (Phase 7)

A real plant is managed as areas (units), so FluidTwin now partitions the
network into **sections**. The model stays a single graph — every node carries
an optional `sectionId` and a link's section is derived from its upstream node,
so a **tie-in between areas is just a link whose ends live in different
sections** (nothing extra to store or keep in sync). `domain/sections.ts` is
pure and unit-tested.

- **Two pages, one scene.** A hash router (`#/plant`, `#/section/:id`) drives a
  **plant overview** — a KPI dashboard with one card per section (demand, peak
  velocity, head range, element counts) that drills into the section — and a
  **section workspace** that frames just that area (inactive areas ghost out,
  tie-ins are marked, the camera auto-fits). Editing in either page is the same
  data, so changes reflect instantly across both.
- **Section-scoped solve.** A section can be solved on its own: its subnetwork
  is extracted and the cut boundary nodes are pinned as fixed-head reservoirs
  seeded from the last full-plant solution — fast iteration on one area without
  re-solving thousands of pipes. The result is badged *"section-only, boundaries
  fixed"* so it is never mistaken for the coupled plant.
- **Assigning areas.** Create/rename/recolor/delete sections and drop selected
  nodes into them from the workspace; new elements built on a section page are
  born into that section. Untagged elements collect in an *Unassigned* bucket.

The example plants ship pre-partitioned (e.g. the cooling loop = Pump House +
Distribution Ring), and v1 project files still load — every element simply lands
in Unassigned.

## Platform UI

The chrome is a token-driven design system (`src/tokens.css`, OKLCH throughout):
a top app bar with a `Plant ▸ Area` breadcrumb and scene switch, a glass
workspace panel, and dashboards styled as an engineering instrument — grotesk UI
type paired with a monospace numeric face, a single cobalt accent, and semantic
status hues. The app is cross-origin-isolated (COEP), so fonts are system stacks
by design and everything stays self-contained.

## Deployment

Ships as a static SPA (all computation runs in the browser worker), so it hosts
free on either target:

- **Cloudflare Pages** (production target): build `npm run build`, output
  `dist`; `public/_headers` sets COOP/COEP.
- **Vercel** (used for live dev previews): `vercel.json` sets the same headers.

COOP/COEP make the page cross-origin isolated so `SharedArrayBuffer` is
available; the app is fully self-contained to stay COEP-safe.

## Verification

The steady solver is cross-checked against an **independent** scalar reference
(direct Darcy-Weisbach + bisection, a separate code path from the matrix
assembly):

- Churchill friction vs Moody-chart points (laminar 64/Re, smooth, rough).
- Single pipe between two reservoirs — head loss = reservoir difference; flow
  matches the reference to 5 decimals.
- **Three-reservoir problem** — mass balance and energy satisfied at the
  junction; junction head matches an independent scalar solve.
- **Pump/system duty point** — matches an independent scalar intersection solve.
- Valve throttling monotonically reduces flow.

```bash
npm install
npm test        # 22 tests: friction, catalog, steady-solver benchmarks
npm run dev     # launch the 3D app
npm run build   # typecheck + production bundle (worker split into its own chunk)
```

## Project layout

```
src/
  domain/      pure engineering model (units, fluid, catalog, network graph)
  physics/     solver core: linalg, Churchill friction, resistance, GGA solver
  worker/      simulation worker + message protocol
  scene/       react-three-fiber Global View + colormap
  ui/          Zustand store, worker hook, control panel
  examples/    demo networks (pump skid → elevated tank)
```

The `domain` and `physics` layers import nothing from React or Three.js, so the
entire engine runs and is tested under Node.
