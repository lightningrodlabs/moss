import { css, html, LitElement, svg } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { localized, msg, str } from '@lit/localize';

/** Connection state the indicator draws between you and your peers. */
export type PeerLinkState = 'found' | 'unreachable' | 'connected';

/**
 * A small picture of you and your peers joined by a line. The line style
 * shows the connection state (dashed grey while connecting, red with a cross
 * when unreachable, solid green when connected), and arrows travel along it
 * toward you only while data is actually arriving. The state never relies on
 * colour alone: line style and the cross carry it too.
 */
@localized()
@customElement('peer-link-indicator')
export class PeerLinkIndicator extends LitElement {
  @property()
  state: PeerLinkState = 'found';

  @property({ type: Number })
  peers = 1;

  @property({ type: Boolean })
  flowing = false;

  private label(): string {
    switch (this.state) {
      case 'found':
        return msg('Connecting to peers');
      case 'unreachable':
        return msg('Cannot reach peers');
      case 'connected':
        return this.flowing ? msg('Connected, receiving data') : msg('Connected to peers');
    }
  }

  private node(cx: number) {
    return svg`
      <circle cx=${cx} cy="36" r="24" class="node"></circle>
      <circle cx=${cx} cy="29" r="7" class="glyph"></circle>
      <path d="M ${cx - 12} 49 a 12 10 0 0 1 24 0 z" class="glyph"></path>
    `;
  }

  render() {
    const peersLabel = this.peers === 1 ? msg('Peer') : msg(str`${this.peers} peers`);
    return html`
      <svg
        viewBox="0 0 260 90"
        width="260"
        height="90"
        role="img"
        aria-label=${this.label()}
        class=${this.state}
      >
        <line x1="66" y1="36" x2="194" y2="36" class="link"></line>
        ${this.state === 'unreachable'
          ? svg`
              <circle cx="130" cy="36" r="11" class="cross-bg"></circle>
              <path d="M 124 30 L 136 42 M 136 30 L 124 42" class="cross"></path>
            `
          : ''}
        ${this.state === 'connected' && this.flowing
          ? svg`
              <g class="arrows">
                ${[0, 1, 2].map(
                  (i) =>
                    svg`<path d="M 186 29 L 178 36 L 186 43" class="arrow" style="animation-delay: ${i * 0.4}s"></path>`,
                )}
              </g>
            `
          : ''}
        ${this.node(40)} ${this.node(220)}
        <text x="40" y="84" class="caption">${msg('You')}</text>
        <text x="220" y="84" class="caption">${peersLabel}</text>
      </svg>
    `;
  }

  static styles = css`
    :host {
      display: inline-block;
    }
    .node {
      fill: white;
      stroke: #333;
      stroke-width: 2;
    }
    .glyph {
      fill: #333;
    }
    .caption {
      font-size: 13px;
      text-anchor: middle;
      fill: #333;
    }
    .link {
      stroke-width: 3;
      stroke-linecap: round;
    }
    .found .link {
      stroke: #8a8a8a;
      stroke-dasharray: 6 8;
    }
    .unreachable .link {
      stroke: #d32f2f;
      stroke-dasharray: 6 8;
    }
    .connected .link {
      stroke: #44d944;
    }
    .cross-bg {
      fill: white;
      stroke: #d32f2f;
      stroke-width: 2;
    }
    .cross {
      stroke: #d32f2f;
      stroke-width: 3;
      stroke-linecap: round;
    }
    .arrow {
      fill: none;
      stroke: #1e7d1e;
      stroke-width: 3;
      stroke-linecap: round;
      stroke-linejoin: round;
      opacity: 0;
      animation: travel 1.2s linear infinite;
    }
    @keyframes travel {
      0% {
        transform: translateX(0);
        opacity: 0;
      }
      15% {
        opacity: 1;
      }
      85% {
        opacity: 1;
      }
      100% {
        transform: translateX(-104px);
        opacity: 0;
      }
    }
    @media (prefers-reduced-motion: reduce) {
      .arrow {
        animation: none;
        opacity: 1;
      }
      .arrow:nth-child(2) {
        transform: translateX(-40px);
      }
      .arrow:nth-child(3) {
        transform: translateX(-80px);
      }
    }
  `;
}

declare global {
  interface HTMLElementTagNameMap {
    'peer-link-indicator': PeerLinkIndicator;
  }
}
