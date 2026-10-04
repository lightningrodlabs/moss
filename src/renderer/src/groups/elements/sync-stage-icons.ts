import { css, html, svg } from 'lit';
import type { DisplayStage } from '../stage-gate.js';

export type StageIcon = 'radar' | 'radar-blip' | 'mesh-partial' | 'mesh-full';

/** The picture that stands for a display stage. */
export function stageIcon(stage: DisplayStage): StageIcon {
  switch (stage) {
    case 'no-peers':
      return 'radar';
    case 'found':
    case 'unreachable':
      return 'radar-blip';
    case 'connected':
      return 'mesh-partial';
    case 'synced':
      return 'mesh-full';
  }
}

type Point = [number, number];
type Edge = [number, number];

/** Five peers on a circle of radius 8 around (12, 12), starting at the top. */
const NODES: Point[] = [
  [12, 4],
  [19.61, 9.53],
  [16.7, 18.47],
  [7.3, 18.47],
  [4.39, 9.53],
];
const EDGES: Edge[] = [
  [0, 1],
  [0, 2],
  [0, 3],
  [0, 4],
  [1, 2],
  [1, 3],
  [1, 4],
  [2, 3],
  [2, 4],
  [3, 4],
];
/** Edges already carrying data while syncing (solid) and edges still being reached (dashed). */
const SOLID = new Set(['0-1']);
const DASHED = new Set(['0-2', '1-2', '0-4', '1-3']);

const radarBase = svg`<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="3"/><path d="M2 12H22M12 2V22"/>`;
const sweep = svg`<g class="sweep"><path class="wedge" d="M12 12 L12 2 A10 10 0 0 1 19.07 4.93 Z"/><line x1="12" y1="12" x2="12" y2="2"/></g>`;

const edgeLine = (i: number, [a, b]: Edge, cls: string) =>
  svg`<line class=${cls} style="--i:${i}" x1=${NODES[a][0]} y1=${NODES[a][1]} x2=${NODES[b][0]} y2=${NODES[b][1]}/>`;
const node = (i: number, cls: string) =>
  svg`<circle class=${cls} style="--i:${i}" cx=${NODES[i][0]} cy=${NODES[i][1]} r="2.2"/>`;
const partialEdgeClass = ([a, b]: Edge) => {
  const key = `${a}-${b}`;
  return SOLID.has(key) ? 'solid' : DASHED.has(key) ? 'dashed' : 'absent';
};

/** All four icons stacked in one 120×120 box; only the one for `active` is visible. */
export function syncStageIcons(active: DisplayStage, unreachable: boolean) {
  const icon = stageIcon(active);
  const on = (which: StageIcon) => (which === icon ? 'on' : '');
  return html`<div class="stage-icons">
    <svg class="stage-icon radar ${on('radar')}" viewBox="0 0 24 24" aria-hidden="true">
      <g>${radarBase}${sweep}</g>
    </svg>
    <svg
      class="stage-icon radar ${on('radar-blip')} ${unreachable ? 'unreachable' : ''}"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <g>${radarBase}${sweep}${svg`<circle class="blip" cx="16.5" cy="8" r="1.4"/>`}</g>
    </svg>
    <svg class="stage-icon mesh partial ${on('mesh-partial')}" viewBox="0 0 24 24" aria-hidden="true">
      <g>
        ${EDGES.map((e, i) => edgeLine(i, e, partialEdgeClass(e)))}
        ${NODES.map((_, i) => node(i, i < 2 ? 'full' : 'hollow'))}
      </g>
    </svg>
    <svg class="stage-icon mesh ${on('mesh-full')}" viewBox="0 0 24 24" aria-hidden="true">
      <g>${EDGES.map((e, i) => edgeLine(i, e, ''))} ${NODES.map((_, i) => node(i, ''))}</g>
    </svg>
  </div>`;
}

export const syncStageIconStyles = css`
  .stage-icons {
    width: 120px;
    height: 120px;
    position: relative;
    transform-origin: top left;
  }
  .stage-icon {
    position: absolute;
    inset: 0;
    width: 120px;
    height: 120px;
    opacity: 0;
    transform: scale(0.7);
    transition:
      opacity 400ms ease,
      transform 400ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .stage-icon.on {
    opacity: 1;
    transform: none;
  }

  .radar {
    fill: none;
    stroke: #6b6b6b;
    stroke-width: 0.9;
  }
  .radar .wedge {
    fill: #2e7d32;
    fill-opacity: 0.25;
    stroke: none;
  }
  .radar .sweep line {
    stroke: #2e7d32;
    stroke-width: 1.1;
    stroke-linecap: round;
  }
  .radar.on .sweep {
    animation: sweep 2s linear infinite;
    transform-origin: 12px 12px;
  }
  .radar .blip {
    fill: #a86f00;
    stroke: none;
    opacity: 0.25;
  }
  .radar.on .blip {
    animation: blip 2s linear infinite;
  }
  .radar.on.unreachable {
    stroke: #c62828;
  }
  .radar.on.unreachable .blip {
    fill: #c62828;
  }
  @keyframes sweep {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes blip {
    0%,
    12% {
      opacity: 0.25;
    }
    15% {
      opacity: 1;
    }
    70%,
    100% {
      opacity: 0.25;
    }
  }

  .mesh {
    fill: none;
  }
  .mesh line {
    stroke: #2e7d32;
    stroke-width: 0.9;
    stroke-linecap: round;
    stroke-dasharray: 20;
    stroke-dashoffset: 20;
  }
  .mesh circle {
    fill: #2e7d32;
    stroke: #fff;
    stroke-width: 0.8;
    transform: scale(0);
    transform-box: fill-box;
    transform-origin: center;
  }
  .mesh.on line {
    animation: draw 450ms ease-out forwards;
    animation-delay: calc(250ms + var(--i) * 45ms);
  }
  .mesh.on circle {
    animation: popin 300ms cubic-bezier(0.2, 0.8, 0.2, 1) forwards;
    animation-delay: calc(var(--i) * 60ms);
  }
  @keyframes draw {
    to {
      stroke-dashoffset: 0;
    }
  }
  @keyframes popin {
    to {
      transform: scale(1);
    }
  }

  .mesh.partial line.solid {
    stroke-dasharray: none;
    stroke-dashoffset: 0;
  }
  .mesh.partial line.dashed {
    stroke: #8a8a8a;
    stroke-dasharray: 1.2 1.2;
    stroke-dashoffset: 0;
  }
  .mesh.partial line.absent {
    display: none;
  }
  /* Filled with the screen background so a peer not yet reached reads as an empty ring */
  .mesh.partial circle.hollow {
    fill: var(--moss-fishy-green, #bac9af);
    stroke: #8a8a8a;
    stroke-width: 0.9;
  }
  .mesh.partial.on circle {
    animation: none;
    transform: scale(1);
  }
  .mesh.partial.on line.solid {
    animation: none;
  }
  .mesh.partial.on line.dashed {
    animation: march 1s linear infinite;
  }
  @keyframes march {
    to {
      stroke-dashoffset: -2.4;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .stage-icon,
    .stage-icon * {
      animation: none !important;
      transition-duration: 1ms !important;
    }
    .mesh line {
      stroke-dashoffset: 0;
    }
    .mesh circle {
      transform: scale(1);
    }
  }
`;
