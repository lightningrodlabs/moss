import { css, html, svg } from 'lit';
import { msg } from '@lit/localize';
import type { DisplayStage } from '../stage-gate.js';

/**
 * A rounded label naming the connection stage. Colour, dot and word all
 * carry the stage, so it reads without relying on colour alone.
 */
export function syncStatusBadge(stage: DisplayStage) {
  const word = {
    'no-peers': msg('Searching'),
    found: msg('Connecting'),
    unreachable: msg('Cannot reach'),
    connected: msg('Connected'),
    synced: msg('Synced'),
  }[stage];
  return html`<span class="status-badge ${stage}"><span class="status-dot"></span>${word}</span>`;
}

/** A download arrow that moves only while data is arriving. */
export function dataFlowArrow(receiving: boolean) {
  return html`<svg
    class="flow-arrow ${receiving ? 'receiving' : ''}"
    viewBox="0 0 16 16"
    width="16"
    height="16"
    aria-hidden="true"
  >
    ${svg`<path d="M8 2 V11 M3.5 7 L8 11.5 L12.5 7 M3 14 H13"></path>`}
  </svg>`;
}

export const syncStatusStyles = css`
  .status-badge {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 3px 12px;
    border-radius: 999px;
    border: 1.5px solid currentColor;
    background: white;
    font-size: 13px;
    font-weight: 600;
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: currentColor;
  }
  .status-badge.no-peers {
    color: #6b6b6b;
  }
  .status-badge.found {
    color: #a86f00;
  }
  .status-badge.unreachable {
    color: #c62828;
  }
  .status-badge.connected {
    color: #2e7d32;
  }
  .status-badge.synced {
    color: #2e7d32;
    background: #e4f3e5;
  }
  .flow-arrow {
    fill: none;
    stroke: #8a8a8a;
    stroke-width: 2;
    stroke-linecap: round;
    stroke-linejoin: round;
  }
  .flow-arrow.receiving {
    stroke: #2e7d32;
    animation: flow 1s ease-in-out infinite;
  }
  @keyframes flow {
    0%,
    100% {
      transform: translateY(-2px);
    }
    50% {
      transform: translateY(2px);
    }
  }
  @media (prefers-reduced-motion: reduce) {
    .flow-arrow.receiving {
      animation: none;
    }
  }
`;
