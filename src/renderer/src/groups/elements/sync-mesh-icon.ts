import { css, svg } from 'lit';

type Point = [number, number];
export type MeshEdge = [number, number];

/** Five places on a circle of radius 8 around (12, 12); the top one is this device. */
const NODES: Point[] = [
  [12, 4],
  [19.61, 9.53],
  [16.7, 18.47],
  [7.3, 18.47],
  [4.39, 9.53],
];
export const MAX_MESH_PEERS = NODES.length - 1;

/** Every pair of places. */
export const MESH_EDGES: MeshEdge[] = NODES.flatMap((_, a) =>
  NODES.slice(a + 1).map((_, k): MeshEdge => [a, a + 1 + k]),
);

/** How many peer places are filled. The mesh only appears once a peer is in contact. */
export function meshPeersShown(peersConnected: number): number {
  return Math.min(Math.max(peersConnected, 1), MAX_MESH_PEERS);
}

export type MeshNodeState = 'full' | 'hollow';

/** Place 0 is this device; peers fill the places after it in the order they connect. */
export function meshNodeState(index: number, peersShown: number): MeshNodeState {
  return index <= peersShown ? 'full' : 'hollow';
}

export type MeshEdgeState = 'live' | 'reaching' | 'absent';

/**
 * An edge between two connected nodes carries data. An edge from this device
 * to a peer not yet connected is still being reached.
 */
export function meshEdgeState([a, b]: MeshEdge, peersShown: number): MeshEdgeState {
  if (meshNodeState(a, peersShown) === 'full' && meshNodeState(b, peersShown) === 'full') {
    return 'live';
  }
  return a === 0 ? 'reaching' : 'absent';
}

const edgeLine = (i: number, [a, b]: MeshEdge, cls: string) =>
  svg`<line class=${cls} style="--i:${i}" x1=${NODES[a][0]} y1=${NODES[a][1]} x2=${NODES[b][0]} y2=${NODES[b][1]}/>`;
const node = (i: number, cls: string) =>
  svg`<circle class=${cls} style="--i:${i}" cx=${NODES[i][0]} cy=${NODES[i][1]} r="2.2"/>`;

/**
 * The mesh while syncing. Every edge is always present so that an edge which
 * turns on later marches in step with the others.
 */
export function meshPartialIcon(peersConnected: number) {
  const shown = meshPeersShown(peersConnected);
  return svg`<g>
    ${MESH_EDGES.map((e, i) => edgeLine(i, e, meshEdgeState(e, shown)))}
    ${NODES.map((_, i) => node(i, meshNodeState(i, shown)))}
  </g>`;
}

/** The mesh once synced: every place filled and every edge solid. */
export function meshFullIcon() {
  return svg`<g>${MESH_EDGES.map((e, i) => edgeLine(i, e, ''))} ${NODES.map((_, i) => node(i, ''))}</g>`;
}

export const meshIconStyles = css`
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

  .mesh.partial line {
    stroke: #8a8a8a;
    stroke-dasharray: 1.2 1.2;
    stroke-dashoffset: 0;
    transition:
      stroke 400ms ease,
      opacity 400ms ease;
  }
  .mesh.partial line.live {
    stroke: #2e7d32;
  }
  .mesh.partial line.absent {
    opacity: 0;
  }
  .mesh.partial.on line {
    animation: march 1s linear infinite;
  }
  .mesh.partial circle {
    transition:
      fill 400ms ease,
      stroke 400ms ease;
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
  .mesh.partial.on circle.full {
    animation: connect 400ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  @keyframes march {
    to {
      stroke-dashoffset: -2.4;
    }
  }
  @keyframes connect {
    40% {
      transform: scale(1.5);
    }
  }
`;
