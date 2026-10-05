# Sync Screen Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the "waiting for group profile" screen one icon per stage, a minimum time per stage, a held "synced" message, and a morph into the group home. A sync that completes suddenly then does not flash or repaint.

**Architecture:** The waiting screen (`looking-for-peers`) keeps its current data flow from `deriveSyncProgress`. It adds a display gate so each stage is on screen for at least 700 ms. When the group profile arrives, `group-home` renders the real group view underneath. The waiting screen stays as an overlay until its final sequence ends. The final sequence has three parts. The synced message shows with the details folded away. It holds for 2.5 s. Then the icon morphs into the group header icon over 600 ms while the overlay fades out.

**Tech Stack:** Lit 3, `@lit/localize`, vitest for pure-node unit tests (`yarn test:unit`), Playwright e2e smoke suite (optional).

**Spec:** `plans/mockups/sync-transitions.html` on branch `feat/group-sync-status` (commit `3423a440`). Open it in a browser. Select these settings in the left panel. Stage icons: "Radar → radar with blip → partly connected peers → connected peers". Minimum dwell: 700 ms. Final message: "Check + collapse". Hold: 2.5 s. Transition: "Morph icon into header". Transition duration: 600 ms. Press "Play scenario" with those settings to see the target behavior. The "Long then sudden" scenario is the case this work exists for. The SVG markup, CSS keyframes and timings below are copied from that file. When this document and the mockup disagree, the mockup wins.

## Global Constraints

- Holochain 0.7.0 line, branch `main-0.7`. Base the work on `feat/group-sync-status`.
- Strong typing everywhere (project rule 4). No `any`.
- Code comments explain intent, never prior behavior (project rule 6).
- Every new UI string goes through `msg()`. Run `npx lit-localize extract` and `npx lit-localize build` in `src/renderer`. Fill all eight `src/renderer/xliff/*.xlf` files (de, fr, es, tr, it, pt, ja, nl).
- UI timing and layout are measured, not reasoned (project rule 7). Log the measured rects to make sure that the morph geometry is correct.
- Respect `prefers-reduced-motion: reduce`: disable the looping animations and shorten transitions to 1 ms. The dwell and hold still apply.
- No Claude attribution in commits.

## Review Focus

1. If the group profile is already known when the group is opened, there is no waiting screen, no overlay and no transition. Test: `group-home` with a defined profile never renders `looking-for-peers`.
2. The profile arrives while the stage is still `no-peers` (nothing was ever shown as found): the gate still shows `no-peers` for 700 ms, then jumps straight to the synced message. Intermediate stages are not synthesized. Test in `stage-gate.test.ts`.
3. Metrics stop arriving after the profile is known (the poller unsubscribes on disconnect): the final sequence must run from its own timers, not from the next metrics snapshot. Test: the final timeline is a pure function of the synced timestamp.
4. The user leaves the group or switches group during the hold: timers are cleared in `disconnectedCallback`, no `requestUpdate` on a detached element, and the morph does not run. Test: `disconnectedCallback` clears every pending timer.
5. If the header icon is not rendered when the morph starts, the morph falls back to a plain fade of the same duration. It must not translate the icon to a `0,0` rect. Test in `morph.test.ts` with a missing target rect.

---

## Behavior summary (what the user sees)

Stages come from `SyncStage` in `src/renderer/src/groups/sync-progress.ts`: `no-peers`, `found`, `unreachable`, `connected`. A fifth display-only stage, `synced`, means the group profile arrived.

| Display stage | Heading (existing text unless noted) | Badge | Icon |
| --- | --- | --- | --- |
| `no-peers` | Looking for peers... | Searching (grey) | Radar, sweep rotating |
| `found` | Found N peer(s). Connecting... | Connecting (amber) | Radar with amber blip |
| `unreachable` | Found N peer(s), but cannot reach them yet | Cannot reach (red) | Radar with red blip, red rings |
| `connected` | Connected to N peer(s). Syncing... | Connected (green) | Partial mesh, dashed edges marching |
| `synced` (new) | Synced with N peer(s). Opening the group... (new) | Synced (green, pale green fill) (new) | Full mesh, edges draw in |

Rules:

1. A display stage stays on screen for at least 700 ms. If the derived stage changes earlier, the change is shown when the 700 ms end. If several changes arrive during the dwell, only the latest is shown next. The `synced` stage obeys the same gate.
2. Icon changes cross-fade: the outgoing icon goes to opacity 0 and the incoming one from opacity 0 and `scale(.7)` to opacity 1 and `scale(1)` over 400 ms. Opacity eases with `ease`, transform with `cubic-bezier(.2,.8,.2,1)`.
3. When `synced` is displayed (t0), the heading, badge and icon change as in the table. The hint is empty. The liveness line reads "All group data received". The Details panel and liveness line fold away over 380 ms with `ease-in`. That fold is `max-height` to 0, `translateY(-48px)`, and opacity to 0 with a 60 ms delay. The group id line below also fades out.
4. At t0 + 2500 ms the morph starts and runs 600 ms. At t0 + 3100 ms the overlay is removed.
5. Morph (FLIP): measure the icon wrapper rect (120×120) and the group header icon rect (64×64, the gradient circle in `group-home` `renderMain`). Set `transform: translate(dx, dy) scale(64/120)` on the wrapper with `transform-origin: top left` and `transition: transform 600ms cubic-bezier(.2,.8,.2,1)`. The wrapper fades out over the last 40 % (`opacity 240ms ease 360ms`). Heading, badge, Leave Group button and remaining text fade out over 300 ms. The group view underneath fades in from opacity 0 over 360 ms with a 240 ms delay. The header icon plays `pop` (`scale(.6)`, opacity 0 → `scale(1)`, opacity 1) over 360 ms with a 240 ms delay.

## File structure

- Create `src/renderer/src/groups/stage-gate.ts`: pure dwell gate. No DOM, no Lit.
- Create `src/renderer/src/groups/stage-gate.test.ts`.
- Create `src/renderer/src/groups/elements/sync-stage-icons.ts`: the four SVG icons as Lit templates plus their CSS (replaces the telescope on this screen only).
- Create `src/renderer/src/groups/elements/sync-morph.ts`: pure function computing the FLIP transform from two rects, plus its test `sync-morph.test.ts`.
- Modify `src/renderer/src/groups/elements/sync-status-visuals.ts`: add the `synced` badge word and colour.
- Modify `src/renderer/src/groups/elements/looking-for-peers.ts`: use the gate, the icons, the `synced` property, the final sequence, and dispatch `sync-screen-done`.
- Modify `src/renderer/src/groups/elements/group-home.ts`: overlay logic.
- Modify `src/renderer/xliff/*.xlf` and `src/renderer/src/locales/generated/*` through the lit-localize commands.

---

### Task 1: Stage gate (minimum dwell)

**Files:**
- Create: `src/renderer/src/groups/stage-gate.ts`
- Test: `src/renderer/src/groups/stage-gate.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type DisplayStage = SyncStage | 'synced';
  export interface GateState { shown: DisplayStage; shownAt: number; pending: DisplayStage | undefined }
  export const MIN_STAGE_DWELL_MS = 700;
  /** Returns the next state and, when a change must wait, the delay in ms until it may be shown. */
  export function gateStage(state: GateState, wanted: DisplayStage, now: number): { state: GateState; delayMs: number | undefined };
  ```
- Semantics: if `wanted === state.shown`, clear `pending`, no delay. If `now - state.shownAt >= 700`, show `wanted` now (`shownAt = now`, `pending = undefined`). Otherwise keep `shown`, set `pending = wanted`, return `delayMs = 700 - (now - shownAt)`. When the timer for `delayMs` fires, the caller calls `gateStage(state, state.pending, Date.now())`.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it } from 'vitest';
import { gateStage, MIN_STAGE_DWELL_MS, type GateState } from './stage-gate.js';

const start: GateState = { shown: 'no-peers', shownAt: 1000, pending: undefined };

describe('gateStage', () => {
  it('shows a change immediately once the dwell has passed', () => {
    const r = gateStage(start, 'found', 1000 + MIN_STAGE_DWELL_MS);
    expect(r.state).toEqual({ shown: 'found', shownAt: 1700, pending: undefined });
    expect(r.delayMs).toBeUndefined();
  });
  it('holds a change that arrives inside the dwell and reports the remaining delay', () => {
    const r = gateStage(start, 'found', 1300);
    expect(r.state).toEqual({ shown: 'no-peers', shownAt: 1000, pending: 'found' });
    expect(r.delayMs).toBe(400);
  });
  it('keeps only the latest pending stage', () => {
    const a = gateStage(start, 'found', 1200).state;
    const b = gateStage(a, 'synced', 1300);
    expect(b.state.pending).toBe('synced');
    expect(b.delayMs).toBe(400);
  });
  it('drops a pending change when the derived stage returns to the shown one', () => {
    const a = gateStage(start, 'found', 1200).state;
    const b = gateStage(a, 'no-peers', 1250);
    expect(b.state).toEqual({ shown: 'no-peers', shownAt: 1000, pending: undefined });
    expect(b.delayMs).toBeUndefined();
  });
  it('jumps from no-peers straight to synced without synthesizing stages', () => {
    const r = gateStage(start, 'synced', 2000);
    expect(r.state.shown).toBe('synced');
  });
});
```

- [ ] **Step 2: Run** `yarn test:unit src/renderer/src/groups/stage-gate.test.ts`. Expected: FAIL, module not found.

- [ ] **Step 3: Implement**

```ts
import type { SyncStage } from './sync-progress.js';

export type DisplayStage = SyncStage | 'synced';

export interface GateState {
  shown: DisplayStage;
  shownAt: number;
  pending: DisplayStage | undefined;
}

/** A stage stays visible this long so a fast conductor cannot flash three headings in a row. */
export const MIN_STAGE_DWELL_MS = 700;

export function gateStage(
  state: GateState,
  wanted: DisplayStage,
  now: number,
): { state: GateState; delayMs: number | undefined } {
  if (wanted === state.shown) return { state: { ...state, pending: undefined }, delayMs: undefined };
  const elapsed = now - state.shownAt;
  if (elapsed >= MIN_STAGE_DWELL_MS) {
    return { state: { shown: wanted, shownAt: now, pending: undefined }, delayMs: undefined };
  }
  return { state: { ...state, pending: wanted }, delayMs: MIN_STAGE_DWELL_MS - elapsed };
}
```

- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(groups): minimum dwell gate for sync stages`

---

### Task 2: Stage icons

**Files:**
- Create: `src/renderer/src/groups/elements/sync-stage-icons.ts`
- Modify: `src/renderer/src/groups/elements/sync-status-visuals.ts` (badge word + colour for `synced`)

**Interfaces:**
- Produces:
  ```ts
  /** All four icons stacked in one 120×120 box; only `active` is visible. */
  export function syncStageIcons(active: DisplayStage, unreachable: boolean): TemplateResult;
  export const syncStageIconStyles: CSSResult;
  ```
- The mapping from display stage to icon: `no-peers` → radar, `found` and `unreachable` → radar with blip, `connected` → partial mesh, `synced` → full mesh.

- [ ] **Step 1: Write the module**

Geometry: five nodes on a circle of radius 8 around (12, 12), starting at −90° in 72° steps. Computed to two decimals:

```
p0 (12.00, 4.00)  p1 (19.61, 9.53)  p2 (16.70, 18.47)  p3 (7.30, 18.47)  p4 (4.39, 9.53)
```

Edges in index order (`--i` is the edge index for the stagger): (0,1) (0,2) (0,3) (0,4) (1,2) (1,3) (1,4) (2,3) (2,4) (3,4).

```ts
import { css, html, svg } from 'lit';
import type { DisplayStage } from '../stage-gate.js';

const NODES: [number, number][] = [[12, 4], [19.61, 9.53], [16.7, 18.47], [7.3, 18.47], [4.39, 9.53]];
const EDGES: [number, number][] = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]];
/** Edges already carrying data while syncing (solid) and edges still being reached (dashed). */
const SOLID = new Set(['0-1']);
const DASHED = new Set(['0-2', '1-2', '0-4', '1-3']);

const radarBase = svg`<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="3"/><path d="M2 12H22M12 2V22"/>`;
const sweep = svg`<g class="sweep"><path class="wedge" d="M12 12 L12 2 A10 10 0 0 1 19.07 4.93 Z"/><line x1="12" y1="12" x2="12" y2="2"/></g>`;

const edgeLine = (i: number, [a, b]: [number, number], cls: string) =>
  svg`<line class=${cls} style="--i:${i}" x1=${NODES[a][0]} y1=${NODES[a][1]} x2=${NODES[b][0]} y2=${NODES[b][1]}/>`;
const node = (i: number, cls: string) =>
  svg`<circle class=${cls} style="--i:${i}" cx=${NODES[i][0]} cy=${NODES[i][1]} r="2.2"/>`;

export function syncStageIcons(active: DisplayStage, unreachable: boolean) {
  const on = (stage: DisplayStage | DisplayStage[]) =>
    (Array.isArray(stage) ? stage : [stage]).includes(active) ? 'on' : '';
  return html`<div class="stage-icons">
    <svg class="stage-icon radar ${on('no-peers')}" viewBox="0 0 24 24" aria-hidden="true"><g>${radarBase}${sweep}</g></svg>
    <svg class="stage-icon radar ${on(['found', 'unreachable'])} ${unreachable ? 'unreachable' : ''}" viewBox="0 0 24 24" aria-hidden="true">
      <g>${radarBase}${sweep}<circle class="blip" cx="16.5" cy="8" r="1.4"/></g>
    </svg>
    <svg class="stage-icon mesh partial ${on('connected')}" viewBox="0 0 24 24" aria-hidden="true"><g>
      ${EDGES.map((e, i) => { const k = `${e[0]}-${e[1]}`; return edgeLine(i, e, SOLID.has(k) ? 'solid' : DASHED.has(k) ? 'dashed' : 'absent'); })}
      ${NODES.map((_, i) => node(i, i < 2 ? 'full' : 'hollow'))}
    </g></svg>
    <svg class="stage-icon mesh ${on('synced')}" viewBox="0 0 24 24" aria-hidden="true"><g>
      ${EDGES.map((e, i) => edgeLine(i, e, ''))}
      ${NODES.map((_, i) => node(i, ''))}
    </g></svg>
  </div>`;
}

export const syncStageIconStyles = css`
  .stage-icons { width: 120px; height: 120px; position: relative; transform-origin: top left; }
  .stage-icon { position: absolute; inset: 0; width: 120px; height: 120px; opacity: 0; transform: scale(.7);
    transition: opacity 400ms ease, transform 400ms cubic-bezier(.2,.8,.2,1); }
  .stage-icon.on { opacity: 1; transform: none; }

  .radar { fill: none; stroke: #6b6b6b; stroke-width: .9; }
  .radar .wedge { fill: #2e7d32; fill-opacity: .25; stroke: none; }
  .radar .sweep line { stroke: #2e7d32; stroke-width: 1.1; stroke-linecap: round; }
  .radar.on .sweep { animation: sweep 2s linear infinite; transform-origin: 12px 12px; }
  .radar .blip { fill: #a86f00; stroke: none; opacity: .25; }
  .radar.on .blip { animation: blip 2s linear infinite; }
  .radar.on.unreachable { stroke: #c62828; }
  .radar.on.unreachable .blip { fill: #c62828; }
  @keyframes sweep { to { transform: rotate(360deg); } }
  @keyframes blip { 0%, 12% { opacity: .25; } 15% { opacity: 1; } 70%, 100% { opacity: .25; } }

  .mesh { fill: none; }
  .mesh line { stroke: #2e7d32; stroke-width: .9; stroke-linecap: round; stroke-dasharray: 20; stroke-dashoffset: 20; }
  .mesh circle { fill: #2e7d32; stroke: #fff; stroke-width: .8; transform: scale(0); transform-box: fill-box; transform-origin: center; }
  .mesh.on line { animation: draw 450ms ease-out forwards; animation-delay: calc(250ms + var(--i) * 45ms); }
  .mesh.on circle { animation: popin 300ms cubic-bezier(.2,.8,.2,1) forwards; animation-delay: calc(var(--i) * 60ms); }
  @keyframes draw { to { stroke-dashoffset: 0; } }
  @keyframes popin { to { transform: scale(1); } }

  .mesh.partial line.solid { stroke-dasharray: none; stroke-dashoffset: 0; }
  .mesh.partial line.dashed { stroke: #8a8a8a; stroke-dasharray: 1.2 1.2; stroke-dashoffset: 0; }
  .mesh.partial line.absent { display: none; }
  .mesh.partial circle.hollow { fill: var(--moss-fishy-green, #bac9af); stroke: #8a8a8a; stroke-width: .9; }
  .mesh.partial.on circle { animation: none; transform: scale(1); }
  .mesh.partial.on line.solid { animation: none; }
  .mesh.partial.on line.dashed { animation: march 1s linear infinite; }
  @keyframes march { to { stroke-dashoffset: -2.4; } }

  @media (prefers-reduced-motion: reduce) {
    .stage-icon, .stage-icon * { animation: none !important; transition-duration: 1ms !important; }
    .mesh line { stroke-dashoffset: 0; } .mesh circle { transform: scale(1); }
  }
`;
```

The hollow node fill must match the screen background. `looking-for-peers` sits in `group-home`, whose background is `var(--moss-fishy-green)` (see `.group-home` in `group-container.ts`). Measure it in the running app before trusting this value.

- [ ] **Step 2: Add the `synced` badge** in `sync-status-visuals.ts`: extend the `word` map with `synced: msg('Synced')` (the function's parameter type becomes `DisplayStage`) and add `.status-badge.synced { color: #2e7d32; background: #e4f3e5; }`.

- [ ] **Step 3:** Run `yarn typecheck:web`. Expected: PASS.
- [ ] **Step 4: Commit** `feat(groups): stage icons and synced badge for the waiting screen`

---

### Task 3: Morph geometry

**Files:**
- Create: `src/renderer/src/groups/elements/sync-morph.ts`
- Test: `src/renderer/src/groups/elements/sync-morph.test.ts`

**Interfaces:**
```ts
export interface Rect { left: number; top: number; width: number; height: number }
/** CSS transform that moves `from` onto `to` with top-left origin, or undefined when the target is unusable. */
export function morphTransform(from: Rect, to: Rect | undefined): string | undefined;
```
Unusable: `to` undefined, or `to.width === 0`, or `to.height === 0`.

- [ ] **Step 1: Tests**

```ts
import { describe, expect, it } from 'vitest';
import { morphTransform } from './sync-morph.js';

describe('morphTransform', () => {
  it('translates and scales the icon onto the header icon', () => {
    expect(morphTransform({ left: 500, top: 300, width: 120, height: 120 }, { left: 260, top: 60, width: 64, height: 64 }))
      .toBe('translate(-240px, -240px) scale(0.5333)');
  });
  it('returns undefined when the target is missing or collapsed', () => {
    const from = { left: 0, top: 0, width: 120, height: 120 };
    expect(morphTransform(from, undefined)).toBeUndefined();
    expect(morphTransform(from, { left: 0, top: 0, width: 0, height: 0 })).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test.** Expected: FAIL.
- [ ] **Step 3: Implement**

```ts
export interface Rect { left: number; top: number; width: number; height: number }

export function morphTransform(from: Rect, to: Rect | undefined): string | undefined {
  if (!to || to.width === 0 || to.height === 0) return undefined;
  const scale = (to.width / from.width).toFixed(4);
  return `translate(${to.left - from.left}px, ${to.top - from.top}px) scale(${scale})`;
}
```

- [ ] **Step 4: Run the test.** Expected: PASS.
- [ ] **Step 5: Commit** `feat(groups): FLIP transform for the sync screen morph`

---

### Task 4: Waiting screen uses the gate, icons and final sequence

**Files:**
- Modify: `src/renderer/src/groups/elements/looking-for-peers.ts`

**Interfaces:**
- Consumes: `gateStage`, `GateState`, `MIN_STAGE_DWELL_MS`, `DisplayStage` (Task 1); `syncStageIcons`, `syncStageIconStyles` (Task 2); `morphTransform` (Task 3).
- Produces (public API of the element):
  ```ts
  /** Set by group-home once the group profile is known; starts the final sequence. */
  @property({ type: Boolean }) synced = false;
  /** Element whose bounding rect the icon morphs onto. */
  @property({ attribute: false }) morphTarget: HTMLElement | undefined;
  export const SYNCED_HOLD_MS = 2500;
  export const MORPH_MS = 600;
  ```
  When the morph ends, the element dispatches `sync-screen-done` (`bubbles: true, composed: true`).

- [ ] **Step 1: Replace the icon and heading logic.**
  - Add `@state() private _gate: GateState = { shown: 'no-peers', shownAt: Date.now(), pending: undefined };` and `private _gateTimer`.
  - Add a method `private wantStage(stage: DisplayStage)`. It calls `gateStage(this._gate, stage, Date.now())` and stores the state. If `delayMs` is returned, it clears any previous `_gateTimer` and sets a new one that calls `this.wantStage(this._gate.pending!)`. When the shown stage becomes `synced`, call `this.startFinalSequence()`.
  - In the metrics subscription callback, after `deriveSyncProgress`, call `this.wantStage(this.synced ? 'synced' : this._progress.stage)`.
  - In `updated(changed)`: if `changed.has('synced') && this.synced`, call `this.wantStage('synced')`.
  - `renderStatus` renders from `this._gate.shown` (not from `p.stage`): `${syncStageIcons(this._gate.shown, this._gate.shown === 'unreachable')}`, `headingText` gets a `synced` case returning `msg(str\`Synced with ${Math.max(p.peersConnected, 1)} peer(s). Opening the group...\`)`, `syncStatusBadge(this._gate.shown)`, hint empty for `synced`, liveness text `msg('All group data received')` for `synced` with the arrow not receiving.
  - Keep `renderLiveness` and `renderDetails` inside a `div.below`. When `shown === 'synced'`, add `class="final"` to the content column.

- [ ] **Step 2: Final sequence**

```ts
private startFinalSequence() {
  this._holdTimer = setTimeout(() => this.startMorph(), SYNCED_HOLD_MS);
}

private startMorph() {
  const wrap = this.shadowRoot?.querySelector<HTMLElement>('.stage-icons');
  const from = wrap?.getBoundingClientRect();
  const to = this.morphTarget?.getBoundingClientRect();
  const transform = wrap && from ? morphTransform(from, to) : undefined;
  if (wrap && transform) wrap.style.transform = transform;
  this._morphing = true; // adds class="out" on :host content
  this._doneTimer = setTimeout(() => {
    this.dispatchEvent(new CustomEvent('sync-screen-done', { bubbles: true, composed: true }));
  }, MORPH_MS);
}
```

`disconnectedCallback` clears `_gateTimer`, `_holdTimer`, `_doneTimer`.

- [ ] **Step 3: Styles** (add to the element's `css`):

```css
.content.final .below, .content.final .group-id { opacity: 0; transition: opacity 320ms ease-in 60ms; }
.content.final .sync-details { max-height: 0; opacity: 0; margin-top: 0; border-width: 0; transform: translateY(-48px); }
.sync-details { overflow: hidden; max-height: 400px;
  transition: max-height 380ms ease-in, opacity 320ms ease-in 60ms, margin 380ms ease-in, transform 380ms ease-in; }
.content.out h2, .content.out .status-badge, .content.out .hint, .leave.out { opacity: 0; transition: opacity 300ms ease; }
.content.out .stage-icons { transition: transform 600ms cubic-bezier(.2,.8,.2,1), opacity 240ms ease 360ms; opacity: 0; }
@media (prefers-reduced-motion: reduce) { .content.out .stage-icons { transition-duration: 1ms; } }
```

- [ ] **Step 4:** `yarn typecheck:web`, then run the app with `yarn applet-dev-example` and join a group whose creator is offline, then bring the creator online. Log `from`, `to` and `transform` in `startMorph` and make sure that the icon lands on the header circle. Remove the logs.
- [ ] **Step 5: Commit** `feat(groups): held synced message and icon morph on the waiting screen`

---

### Task 5: group-home overlay

**Files:**
- Modify: `src/renderer/src/groups/elements/group-home.ts` (`renderContent`, around line 1075)

**Interfaces:**
- Consumes: `looking-for-peers` `synced`, `morphTarget`, `sync-screen-done` (Task 4).

- [ ] **Step 1: State.** Add `@state() private _syncOverlay = false;` and `@query('#group-header-icon') private _headerIcon!: HTMLElement;`. Give the gradient circle in `renderMain` the id `group-header-icon` and `class="header-icon"`.

- [ ] **Step 2: Rendering.** In `renderContent`, case `complete`:

```ts
const groupProfile = this.groupProfile.value.value[0];
const modifiers = this.groupProfile.value.value[1];
if (!groupProfile) {
  this._syncOverlay = true; // profile unknown: the waiting screen is the only content
  return html`<looking-for-peers style="display: flex; flex: 1;"></looking-for-peers>`;
}
return html`
  <div class="main-view ${this._syncOverlay ? 'arriving' : ''}">
    <moss-profile-prompt>${this.renderContentInner(groupProfile, modifiers)}</moss-profile-prompt>
  </div>
  ${this._syncOverlay
    ? html`<looking-for-peers
        class="overlay"
        synced
        .morphTarget=${this._headerIcon}
        @sync-screen-done=${() => (this._syncOverlay = false)}
      ></looking-for-peers>`
    : ''}
`;
```

Setting state inside `render` is a Lit anti-pattern. Move the `_syncOverlay = true` assignment into `willUpdate` and watch `this.groupProfile.value` there. If the status is `complete` and the profile is undefined, set `_syncOverlay = true`. If the profile becomes defined and `_syncOverlay` is already true, leave it true so the overlay runs its sequence.

- [ ] **Step 3: Styles.**

```css
:host { position: relative; }
.main-view { display: flex; flex: 1; }
.main-view.arriving { opacity: 0; animation: arrive 360ms ease 240ms forwards; }
.main-view.arriving .header-icon { animation: pop 360ms cubic-bezier(.2,.8,.2,1) 240ms both; }
looking-for-peers.overlay { position: absolute; inset: 0; z-index: 2; background: var(--moss-fishy-green); }
@keyframes arrive { to { opacity: 1; } }
@keyframes pop { from { transform: scale(.6); opacity: 0; } to { transform: none; opacity: 1; } }
```

The `arrive` animation starts with the morph. It must not start when the profile arrives. The overlay is opaque during the hold, so the fade underneath is invisible until the overlay fades. Make the overlay background transparent as part of `.out` (`transition: background-color 600ms`) so the view underneath shows through during the morph. If the 600 ms version is hard to judge, record the screen with the duration set to 1000 ms.

- [ ] **Step 4:** Run `yarn typecheck:web` and the manual scenario from Task 4 Step 4 again. Also open a group whose profile is already known and make sure that no overlay renders (`document.querySelector('looking-for-peers.overlay')` is null).
- [ ] **Step 5: Commit** `feat(groups): keep the waiting screen as an overlay until its morph into the group header ends`

---

### Task 6: Localization

- [ ] `cd src/renderer && npx lit-localize extract`. New units: "Synced", "Synced with ${n} peer(s). Opening the group...", "All group data received".
- [ ] Fill `<target>` in `de.xlf`, `fr.xlf`, `es.xlf`, `tr.xlf`, `it.xlf`, `pt.xlf`, `ja.xlf`, `nl.xlf`.
- [ ] `npx lit-localize build`, then `yarn typecheck:web`.
- [ ] Commit `i18n: strings for the synced waiting screen`

---

### Task 7: Smoke test (optional, only if the e2e harness already covers joining a group)

If `tests/e2e/smoke` has a join flow with an offline creator, add a spec that reads the `looking-for-peers` `shadowRoot`. The spec samples every 100 ms and asserts two things. The `.stage-icon.on` class changes at most once per 700 ms. The `looking-for-peers.overlay` element is present for at least 3000 ms after `group-header-icon` first exists, and absent after that. If there is no such flow, skip this task and say so in the PR.
