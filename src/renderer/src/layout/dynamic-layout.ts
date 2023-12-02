import { decodeHashFromBase64, encodeHashToBase64 } from '@holochain/client';
import { localized } from '@lit/localize';
import '@scoped-elements/golden-layout';
import { GoldenLayout as GoldenLayoutEl } from '@scoped-elements/golden-layout';
import { ComponentItemConfig, GoldenLayout, LayoutConfig, RootItemConfig } from 'golden-layout';
import { css, html, LitElement } from 'lit';
import { customElement, property } from 'lit/decorators.js';
import { consume, provide } from '@lit-labs/context';
import { Hrl, HrlWithContext } from '@lightningrodlabs/we-applet';

import '../groups/elements/group-context.js';
import '../groups/elements/group-home.js';
import '../groups/elements/group-logo.js';
import '../groups/elements/group-title.js';
import '../groups/elements/applet-name.js';
import '../groups/elements/entry-title.js';
import '../applets/elements/applet-title.js';
import '../groups/elements/custom-view-title.js';
import '../applet-bundles/elements/applet-bundle-title.js';
import './views/cross-applet-main.js';
import './views/cross-applet-block.js';
import './views/welcome-view.js';
import './views/applet-block.js';
import './views/applet-main.js';
import './views/entry-view.js';
import '../custom-views/elements/custom-view.js';

import { openViewsContext } from './context.js';
import { AppOpenViews } from './types.js';
import { weStyles } from '../shared-styles.js';
import { WeStore } from '../we-store.js';
import { weStoreContext } from '../context.js';
import { setupAppletMessageHandler } from '../applets/applet-host.js';

@localized()
@customElement('dynamic-layout')
export class DynamicLayout extends LitElement {
  @property()
  rootItemConfig!: RootItemConfig;

  get layoutConfig(): LayoutConfig {
    return {
      root: this.rootItemConfig,
      header: {
        popout: false,
        maximise: false,
      },
    };
  }

  @consume({ context: weStoreContext, subscribe: true })
  weStore!: WeStore;

  @provide({ context: openViewsContext })
  @property()
  openViews: AppOpenViews = {
    openAppletMain: (appletHash) => {
      this.dispatchEvent(
        new CustomEvent('open-tab-request', {
          bubbles: true,
          detail: 'open-applet-main',
        }),
      );
      this.openTab({
        id: `applet-main-${encodeHashToBase64(appletHash)}`,
        type: 'component',
        componentType: 'applet-main',
        componentState: {
          appletHash: encodeHashToBase64(appletHash),
        },
      });
    },
    openAppletBlock: (appletHash, block, context) => {
      this.dispatchEvent(
        new CustomEvent('open-tab-request', {
          bubbles: true,
          detail: 'open-applet-block',
        }),
      );
      this.openTab({
        id: `applet-block-${encodeHashToBase64(appletHash)}-${block}`,
        type: 'component',
        componentType: 'applet-block',
        componentState: {
          appletHash: encodeHashToBase64(appletHash),
          block,
          context,
        },
      });
    },
    openCrossAppletMain: (appletBundleHash) => {
      this.dispatchEvent(
        new CustomEvent('open-tab-request', {
          bubbles: true,
          detail: 'open-cross-applet-main',
        }),
      );
      this.openTab({
        id: `cross-applet-main-${encodeHashToBase64(appletBundleHash)}`,
        type: 'component',
        componentType: 'cross-applet-main',
        componentState: {
          appletBundleHash: encodeHashToBase64(appletBundleHash),
        },
      });
    },
    openCrossAppletBlock: (appletBundleHash, block, context) => {
      this.dispatchEvent(
        new CustomEvent('open-tab-request', {
          bubbles: true,
          detail: 'open-cross-applet-block',
        }),
      );
      this.openTab({
        id: `cross-applet-block-${encodeHashToBase64(appletBundleHash)}-${block}`,
        type: 'component',
        componentType: 'cross-applet-block',
        componentState: {
          appletBundleHash: encodeHashToBase64(appletBundleHash),
          block,
          context,
        },
      });
    },
    openHrl: async (hrl: Hrl, context: any) => {
      this.dispatchEvent(
        new CustomEvent('open-tab-request', {
          bubbles: true,
          detail: 'open-hrl',
        }),
      );
      this.openTab({
        id: `hrl://${encodeHashToBase64(hrl[0])}/${encodeHashToBase64(hrl[1])}`,
        type: 'component',
        componentType: 'entry',
        componentState: {
          hrl: [encodeHashToBase64(hrl[0]), encodeHashToBase64(hrl[1])],
          context,
        },
      });
    },
    userSelectHrl: async () => {
      this.dispatchEvent(
        new CustomEvent('select-hrl-request', {
          bubbles: true,
          detail: 'select-hrl',
        }),
      );

      return new Promise((resolve) => {
        const listener = (e) => {
          switch (e.type) {
            case 'cancel-select-hrl':
              this.removeEventListener('cancel-select-hrl', listener);
              return resolve(undefined);
            case 'hrl-selected':
              const hrlWithContext: HrlWithContext = e.detail.hrlWithContext;
              this.removeEventListener('hrl-selected', listener);
              return resolve(hrlWithContext);
          }
        };
        this.addEventListener('hrl-selected', listener);
        this.addEventListener('cancel-select-hrl', listener);
      });
    },
    toggleClipboard: () => {
      this.dispatchEvent(
        new CustomEvent('toggle-clipboard', {
          bubbles: true,
          detail: 'toggle-clipboard',
        }),
      );
    },
  };

  firstUpdated() {
    setupAppletMessageHandler(this.weStore, this.openViews);
  }

  openTab(itemConfig: ComponentItemConfig) {
    const item = this.goldenLayout.findFirstComponentItemById(itemConfig.id!);

    if (item) {
      item.focus();
    } else {
      this.goldenLayout.addItemAtLocation(itemConfig, [
        {
          typeId: 2,
        },
      ]);
    }
  }

  get goldenLayout(): GoldenLayout {
    const el = this.shadowRoot?.getElementById('golden-layout') as GoldenLayoutEl;
    return el.goldenLayout as any;
  }

  render() {
    return html` <golden-layout
      id="golden-layout"
      .layoutConfig=${this.layoutConfig}
      style="flex: 1; display: flex; min-width: 0;"
    >
      <golden-layout-register component-type="welcome">
        <template>
          <welcome-view style="z-index: 1"></welcome-view>
        </template>
      </golden-layout-register>
      <golden-layout-register
        component-type="group-home"
        .titleRenderer=${({ groupDnaHash }) => html`
          <group-context .groupDnaHash=${decodeHashFromBase64(groupDnaHash)}>
            <group-logo style="--size: 25px"></group-logo>
            <group-title style="margin-left: 4px; font-size: 16px;"></group-title>
          </group-context>
        `}
        .template=${({ groupDnaHash }, container) => html`
          <group-context .groupDnaHash=${decodeHashFromBase64(groupDnaHash)}>
            <group-home
              style="flex: 1"
              @group-left=${() => {
                container.close();
              }}
              @applet-selected=${(e: CustomEvent) => {
                this.openViews.openAppletMain(e.detail.appletHash);
              }}
              @custom-view-selected=${(e) => {
                this.openTab({
                  id: `custom-view-${groupDnaHash}-${encodeHashToBase64(e.detail.customViewHash)}`,
                  type: 'component',
                  componentType: 'custom-view',
                  componentState: {
                    groupDnaHash,
                    customViewHash: encodeHashToBase64(e.detail.customViewHash),
                  },
                });
              }}
              @custom-view-created=${(e) => {
                this.openTab({
                  id: `custom-view-${groupDnaHash}-${encodeHashToBase64(e.detail.customViewHash)}`,
                  type: 'component',
                  componentType: 'custom-view',
                  componentState: {
                    groupDnaHash,
                    customViewHash: encodeHashToBase64(e.detail.customViewHash),
                  },
                });
              }}
            ></group-home>
          </group-context>
        `}
      >
      </golden-layout-register>
      <golden-layout-register
        component-type="custom-view"
        .titleRenderer=${({ groupDnaHash, customViewHash }) => html`
          <group-context .groupDnaHash=${decodeHashFromBase64(groupDnaHash)}>
            <custom-view-title
              .customViewHash=${decodeHashFromBase64(customViewHash)}
            ></custom-view-title>
          </group-context>
        `}
        .template=${({ groupDnaHash, customViewHash }, _container) => html`
          <group-context .groupDnaHash=${decodeHashFromBase64(groupDnaHash)}>
            <custom-view
              style="flex: 1"
              .customViewHash=${decodeHashFromBase64(customViewHash)}
            ></custom-view>
          </group-context>
        `}
      >
      </golden-layout-register>
      <golden-layout-register
        component-type="entry"
        .titleRenderer=${({ hrl }) => html`
          <entry-title
            .hrl=${[decodeHashFromBase64(hrl[0]), decodeHashFromBase64(hrl[1])]}
          ></entry-title>
        `}
        .template=${({ hrl, context }) =>
          html` <entry-view
            .hrl=${[decodeHashFromBase64(hrl[0]), decodeHashFromBase64(hrl[1])]}
            .context=${context}
            style="flex: 1"
          ></entry-view>`}
      >
      </golden-layout-register>
      <golden-layout-register
        component-type="applet-main"
        .titleRenderer=${({ appletHash }) => html`
          <applet-title .appletHash=${decodeHashFromBase64(appletHash)}></applet-title>
        `}
        .template=${({ appletHash }) => html`
          <applet-main
            .appletHash=${decodeHashFromBase64(appletHash)}
            style="flex: 1"
          ></applet-main>
        `}
      >
      </golden-layout-register>
      <golden-layout-register
        component-type="applet-block"
        .titleRenderer=${({ appletHash, block }) => html`
          <applet-title .appletHash=${decodeHashFromBase64(appletHash)}></applet-title>
          <span>: ${block}</span>
        `}
        .template=${({ appletHash, block, context }) => html`
          <applet-block
            .appletHash=${decodeHashFromBase64(appletHash)}
            .block=${block}
            .context=${context}
            style="flex: 1"
          ></applet-block>
        `}
      >
      </golden-layout-register>
      <golden-layout-register
        component-type="cross-applet-main"
        .titleRenderer=${({ appletBundleHash }) =>
          html`<applet-bundle-title
            .appletBundleHash=${decodeHashFromBase64(appletBundleHash)}
          ></applet-bundle-title>`}
        .template=${({ appletBundleHash }) =>
          html` <cross-applet-main
            .appletBundleHash=${decodeHashFromBase64(appletBundleHash)}
            style="flex: 1"
          ></cross-applet-main>`}
      >
      </golden-layout-register>
      <golden-layout-register
        component-type="cross-applet-block"
        .titleRenderer=${({ appletBundleHash, block }) =>
          html`<applet-bundle-title
              .appletBundleHash=${encodeHashToBase64(appletBundleHash)}
            ></applet-bundle-title>
            <span>: ${block}</span> `}
        .template=${({ appletBundleHash, block, context }) =>
          html` <cross-applet-block
            .appletBundleHash=${decodeHashFromBase64(appletBundleHash)}
            .block=${block}
            .context=${context}
            style="flex: 1"
          ></cross-applet-block>`}
      >
      </golden-layout-register>
      <golden-layout-root style="flex: 1"> </golden-layout-root>
    </golden-layout>`;
  }

  static styles = [
    css`
      :host {
        display: flex;
      }
    `,
    weStyles,
  ];
}
