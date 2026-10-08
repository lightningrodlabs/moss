import { css, html } from 'lit';
import type { DisplayStage } from '../stage-gate.js';
import type { SyncProgress } from '../sync-progress.js';
import { radarIcon, radarIconStyles } from './sync-radar-icon.js';
import { meshFullIcon, meshIconStyles, meshPartialIcon } from './sync-mesh-icon.js';

export type StageIcon = 'radar' | 'mesh-partial' | 'mesh-full';

/** The picture that stands for a display stage. */
export function stageIcon(stage: DisplayStage): StageIcon {
  switch (stage) {
    case 'no-peers':
    case 'found':
    case 'unreachable':
      return 'radar';
    case 'connected':
      return 'mesh-partial';
    case 'synced':
      return 'mesh-full';
  }
}

export type StagePeerCounts = Pick<SyncProgress, 'peersFound' | 'peersFailed' | 'peersConnected'>;

/**
 * All icons stacked in one 120×120 box; only the one for `active` is visible.
 * The radar shows a dot per peer found and the partial mesh a node per peer connected.
 */
export function syncStageIcons(active: DisplayStage, peers: StagePeerCounts) {
  const icon = stageIcon(active);
  const on = (which: StageIcon) => (which === icon ? 'on' : '');
  return html`<div class="stage-icons">
    <svg class="stage-icon radar ${on('radar')}" viewBox="0 0 24 24" aria-hidden="true">
      ${radarIcon(peers.peersFound, peers.peersFailed)}
    </svg>
    <svg
      class="stage-icon mesh partial ${on('mesh-partial')}"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      ${meshPartialIcon(peers.peersConnected)}
    </svg>
    <svg class="stage-icon mesh ${on('mesh-full')}" viewBox="0 0 24 24" aria-hidden="true">
      ${meshFullIcon()}
    </svg>
  </div>`;
}

const stageIconBoxStyles = css`
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
`;

const reducedMotionStyles = css`
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

export const syncStageIconStyles = [
  stageIconBoxStyles,
  radarIconStyles,
  meshIconStyles,
  reducedMotionStyles,
];
