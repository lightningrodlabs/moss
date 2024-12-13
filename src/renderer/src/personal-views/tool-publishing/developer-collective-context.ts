// import { css, html, LitElement, PropertyValues } from 'lit';
// import { consume, provide } from '@lit/context';
// import { customElement, property, state } from 'lit/decorators.js';
// import { ActionHash } from '@holochain/client';

// import { DeveloperCollectiveStore } from './developer-collective-store.js';
// import { mossStoreContext } from '../../context.js';
// import { MossStore } from '../../moss-store.js';
// import { developerCollectiveStoreContext } from './developer-collective-store-context.js';
// import { hashProperty } from '@holochain-open-dev/elements';

// @customElement('developer-collective-context')
// export class DeveloperCollectiveContext extends LitElement {
//   @consume({ context: mossStoreContext, subscribe: true })
//   @state()
//   mossStore!: MossStore;

//   @property(hashProperty('developer-collective-hash'))
//   developerCollectiveHash!: ActionHash;

//   @provide({ context: developerCollectiveStoreContext })
//   developerCollectiveStore!: DeveloperCollectiveStore;

//   updated(changedValues: PropertyValues) {
//     super.updated(changedValues);

//     if (changedValues.has('developerCollectiveHash')) {
//       this.developerCollectiveStore = new DeveloperCollectiveStore(
//         this.mossStore.toolsLibraryStore.toolsLibraryClient,
//         this.developerCollectiveHash,
//       );
//     }
//   }

//   render() {
//     return html`<slot></slot>`;
//   }

//   static styles = css`
//     :host {
//       display: contents;
//     }
//   `;
// }
