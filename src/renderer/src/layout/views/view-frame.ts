import { css, html, LitElement, PropertyValues } from 'lit';
import { customElement, property, state } from 'lit/decorators.js';
import { encodeHashToBase64 } from '@holochain/client';
import { consume } from '@lit/context';
import { IframeKind, RenderView } from '@theweave/api';

import { mossStyles } from '../../shared-styles.js';
import { iframeOrigin, renderViewToQueryString } from '../../utils.js';
import { mossStoreContext } from '../../context.js';
import { MossStore } from '../../moss-store.js';
import { localized, msg } from '@lit/localize';

import '@shoelace-style/shoelace/dist/components/button/button.js';
import { encode } from '@msgpack/msgpack';
import { fromUint8Array } from 'js-base64';

// Performance markers for tool setup measurement (Method 2)
const PERF_MARKERS = {
  GROUP_SETUP_START: 'group-setup-start',
  FIRST_APPLET_READY: 'first-applet-ready',
  ALL_APPLETS_READY: 'all-applets-ready',
};

// Track which applets have been marked as ready
const readyApplets = new Set<string>();

@localized()
@customElement('view-frame')
export class ViewFrame extends LitElement {
  @consume({ context: mossStoreContext })
  @state()
  mossStore!: MossStore;

  @property()
  renderView!: RenderView;

  @property()
  iframeKind!: IframeKind;

  @property()
  reloading = false;

  @state()
  appletDevPort: number | undefined;

  @state()
  loading = true;

  @state()
  slowLoading = false;

  @state()
  slowReloadTimeout: number | undefined;

  async firstUpdated() {
    if (this.mossStore.isAppletDev) {
      this.appletDevPort = await this.mossStore.getAppletDevPort(this.iframeKind);
    }
    
    // Track when iframe starts loading (for main applet views)
    if (
      this.renderView.type === 'applet-view' &&
      this.renderView.view.type === 'main' &&
      this.iframeKind.type === 'applet'
    ) {
      const appletId = encodeHashToBase64(this.iframeKind.appletHash);
      if (!readyApplets.has(appletId)) {
        // This is a new applet iframe being created
        console.log(`[PERF DEBUG] Starting to load applet: ${appletId}`);
      }
    }
  }

  willUpdate(changedProperties: PropertyValues<this>) {
    if (changedProperties.has('reloading')) {
      if (this.reloading) {
        // If it takes longer than 5 seconds to unload, offer to hard reload
        this.slowReloadTimeout = window.setTimeout(() => {
          if (this.reloading) {
            this.slowLoading = true;
          }
        }, 4500);
        this.loading = true;
      } else {
        if (this.slowReloadTimeout) window.clearTimeout(this.slowReloadTimeout);
        this.loading = false;
        this.slowLoading = false;
      }
    }
  }

  hardRefresh() {
    this.slowLoading = false;
    this.dispatchEvent(new CustomEvent('hard-refresh', { bubbles: true, composed: true }));
  }

  renderLoading() {
    return html`
      <div
        class="column center-content"
        style="flex: 1; padding: 0; margin: 0; ${this.loading ? '' : 'display: none'}"
      >
        <img src="loading_animation.svg" />
        <div style="margin-left: 10px; font-size: 18px; color: #142510">
          ${this.reloading ? msg('reloading...') : msg('loading...')}
        </div>
        ${this.slowLoading
          ? html`
              <div class="column items-center" style="margin-top: 50px; max-width: 600px;">
                <div>This Tool takes unusually long to reload. Do you want to force reload?</div>
                <div style="margin-top: 10px; margin-bottom: 20px;">
                  (<b>Warning:</b> Force reloading may interrupt the Tool from saving unsaved
                  content)
                </div>
                <button
                  class="moss-button"
                  @click=${() => this.hardRefresh()}
                  style="margin-top: 20px; width: 150px;"
                >
                  Force Reload
                </button>
              </div>
            `
          : html``}
      </div>
    `;
  }

  handleIframeLoad() {
    this.loading = false;
    
    // Track when applet iframe is ready (for main applet views)
    if (
      this.renderView.type === 'applet-view' &&
      this.renderView.view.type === 'main' &&
      this.iframeKind.type === 'applet'
    ) {
      const appletId = encodeHashToBase64(this.iframeKind.appletHash);
      if (!readyApplets.has(appletId)) {
        readyApplets.add(appletId);
        
        // Check if this is the first applet ready
        if (readyApplets.size === 1) {
          performance.mark(PERF_MARKERS.FIRST_APPLET_READY);
          
          // Check if GROUP_SETUP_START marker exists
          const setupStartMark = performance.getEntriesByName(PERF_MARKERS.GROUP_SETUP_START, 'mark');
          if (setupStartMark.length > 0) {
            try {
              performance.measure(
                'first-applet-ready',
                PERF_MARKERS.GROUP_SETUP_START,
                PERF_MARKERS.FIRST_APPLET_READY,
              );
              
              const measure = performance.getEntriesByName('first-applet-ready');
              if (measure.length > 0) {
                const lastMeasure = measure[measure.length - 1];
                console.log(`[PERF] First applet ready: ${lastMeasure.duration.toFixed(2)}ms`);
              }
            } catch (e) {
              console.warn('[PERF] Failed to measure first-applet-ready:', e);
              // Fallback: measure from navigation start
              const navStart = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
              if (navStart) {
                const timeSinceNavStart = performance.now() - navStart.fetchStart;
                console.log(`[PERF] First applet ready (from nav start): ${timeSinceNavStart.toFixed(2)}ms`);
              }
            }
          } else {
            // GROUP_SETUP_START marker doesn't exist, use navigation timing as fallback
            const navStart = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming;
            if (navStart) {
              const timeSinceNavStart = performance.now() - navStart.fetchStart;
              console.log(`[PERF] First applet ready (from nav start, no group-setup-start): ${timeSinceNavStart.toFixed(2)}ms`);
            } else {
              console.log(`[PERF] First applet ready: ${appletId}`);
            }
          }
        }
      }
    }
  }

  renderProductionFrame() {
    return html`<iframe
        frameborder="0"
        title="TODO"
        id=${this.renderView.type === 'applet-view' &&
        this.renderView.view.type === 'main' &&
        this.iframeKind.type === 'applet'
          ? encodeHashToBase64(this.iframeKind.appletHash)
          : this.renderView.type}
        src="${iframeOrigin(this.iframeKind)}?${renderViewToQueryString(this.renderView)}"
        style="flex: 1; display: ${this.loading ? 'none' : 'block'}; padding: 0; margin: 0;"
        allow="camera *; microphone *; clipboard-write *;"
        @load=${() => {
          this.handleIframeLoad();
        }}
      ></iframe>
      ${this.renderLoading()}`;
  }

  render() {
    switch (this.mossStore.isAppletDev) {
      case false:
        return this.renderProductionFrame();
      case true:
        if (!this.appletDevPort) {
          return this.renderProductionFrame();
        }
        const iframeSrc = `http://localhost:${this.appletDevPort}?${renderViewToQueryString(
          this.renderView,
        )}#${fromUint8Array(encode(this.iframeKind))}`;
        return html`<iframe
            frameborder="0"
            title="TODO"
            id=${this.renderView.type === 'applet-view' &&
            this.renderView.view.type === 'main' &&
            this.iframeKind.type === 'applet'
              ? encodeHashToBase64(this.iframeKind.appletHash)
              : this.renderView.type}
            src="${iframeSrc}"
            style="flex: 1; display: ${this.loading ? 'none' : 'block'}; padding: 0; margin: 0;"
            allow="camera *; microphone *; clipboard-write *;"
            @load=${() => {
              this.handleIframeLoad();
            }}
          ></iframe>
          ${this.renderLoading()}`;
    }
  }

  static styles = [
    css`
      :host {
        display: flex;
      }
    `,
    mossStyles,
  ];
}
