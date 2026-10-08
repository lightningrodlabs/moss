import { css, svg } from 'lit';

type Point = [number, number];

/** More dots than this would crowd the radar without reading as "more peers". */
export const MAX_RADAR_DOTS = 10;
export const RADAR_DOT_RADIUS = 1.4;

/**
 * Where each found peer appears, in the order peers are found. The places are
 * scattered so they look random, and fixed so a dot never moves between renders.
 */
export const RADAR_DOTS: Point[] = [
  [13.18, 9.12],
  [4.11, 14.62],
  [15.59, 17.31],
  [18.13, 11.61],
  [11.14, 19.44],
  [8.58, 8.46],
  [7.46, 16.74],
  [10.49, 5.03],
  [13.92, 4.5],
  [19.25, 15.55],
];

/** Clockwise angle from 12 o'clock as a fraction of a turn, which is where the sweep line starts. */
export function sweepFraction([x, y]: Point): number {
  const angle = Math.atan2(x - 12, 12 - y);
  return (angle < 0 ? angle + 2 * Math.PI : angle) / (2 * Math.PI);
}

export type RadarDotState = 'hidden' | 'found' | 'failed';

/**
 * The state of every dot place. Dots stand for a count of peers, not for
 * particular peers, so the failed ones take the first places.
 */
export function radarDotStates(peersFound: number, peersFailed: number): RadarDotState[] {
  const shown = Math.min(Math.max(peersFound, 0), MAX_RADAR_DOTS);
  const failed = Math.min(Math.max(peersFailed, 0), shown);
  return RADAR_DOTS.map((_, i) => (i >= shown ? 'hidden' : i < failed ? 'failed' : 'found'));
}

const TRAIL_DEGREES = 90;
const TRAIL_STEPS = 12;

/** Wedges behind the sweep line, each reaching a little further back than the last. */
const trail = Array.from({ length: TRAIL_STEPS }, (_, k) => {
  const back = (((k + 1) * TRAIL_DEGREES) / TRAIL_STEPS) * (Math.PI / 180);
  const x = (12 - 10 * Math.sin(back)).toFixed(2);
  const y = (12 - 10 * Math.cos(back)).toFixed(2);
  return svg`<path class="wedge" d="M12 12 L${x} ${y} A10 10 0 0 1 12 2 Z"/>`;
});

const rings = svg`<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6.5"/><circle cx="12" cy="12" r="3"/><path d="M2 12H22M12 2V22"/>`;
const sweep = svg`<g class="sweep">${trail}<line x1="12" y1="12" x2="12" y2="2"/></g>`;

/**
 * The contents of the radar: rings, the sweep, and one dot per place. Every
 * dot is always present so that its flash runs on the same clock as the sweep.
 */
export function radarIcon(peersFound: number, peersFailed: number) {
  const states = radarDotStates(peersFound, peersFailed);
  return svg`<g>${rings}${sweep}${RADAR_DOTS.map(
    (p, i) =>
      svg`<circle class="dot ${states[i]}" style="--a:${sweepFraction(p).toFixed(4)}" cx=${p[0]} cy=${p[1]} r=${RADAR_DOT_RADIUS}/>`,
  )}</g>`;
}

export const radarIconStyles = css`
  .radar {
    fill: none;
    stroke: #6b6b6b;
    stroke-width: 0.9;
  }
  /* The wedges all end at the line, so they overlap most right behind it and
     fade out with distance */
  .radar .wedge {
    fill: #2e7d32;
    fill-opacity: 0.05;
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
  .radar .dot {
    fill: #a86f00;
    stroke: none;
    opacity: 0.25;
    transform-box: fill-box;
    transform-origin: center;
    transition:
      fill 300ms ease,
      fill-opacity 300ms ease,
      transform 300ms cubic-bezier(0.2, 0.8, 0.2, 1);
  }
  .radar .dot.hidden {
    fill-opacity: 0;
    transform: scale(0);
  }
  .radar .dot.failed {
    fill: #c62828;
  }
  /* --a is the dot's angle as a fraction of a turn; the negative delay puts
     the flash at the moment the sweep line passes */
  .radar.on .dot {
    animation: blip 2s linear infinite;
    animation-delay: calc((var(--a) - 1) * 2s);
  }
  @keyframes sweep {
    to {
      transform: rotate(360deg);
    }
  }
  @keyframes blip {
    0% {
      opacity: 0.25;
    }
    2% {
      opacity: 1;
    }
    55%,
    100% {
      opacity: 0.25;
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .radar .dot {
      opacity: 1;
    }
  }
`;
