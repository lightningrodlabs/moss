// import { html, LitElement, css } from 'lit';
// import { customElement, state } from 'lit/decorators.js';
// import { localized, msg } from '@lit/localize';

// import '@shoelace-style/shoelace/dist/components/card/card.js';
// import '@shoelace-style/shoelace/dist/components/icon/icon.js';
// import '@shoelace-style/shoelace/dist/components/button/button.js';
// import '@shoelace-style/shoelace/dist/components/input/input.js';
// import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

// import { weStyles } from '../../shared-styles.js';
// import '../../elements/dialogs/select-group-dialog.js';
// import { mossStoreContext } from '../../context.js';
// import { MossStore } from '../../moss-store.js';
// import { consume } from '@lit/context';
// import { StoreSubscriber } from '@holochain-open-dev/stores';
// import './elements/create-developer-collective.js';
// import './elements/developer-collective-view.js';
// import './developer-collective-context.js';
// import { ActionHash, encodeHashToBase64 } from '@holochain/client';
// import { mdiHome } from '@mdi/js';
// import { wrapPathInSvg } from '@holochain-open-dev/elements';
// import { EntryRecord } from '@holochain-open-dev/utils';
// import { DeveloperCollective } from '@theweave/tool-library-client';

// enum PageView {
//   Home,
//   DeveloperCollective,
//   CreateDeveloperCollective,
// }
// @localized()
// @customElement('publishing-view')
// export class PublishingView extends LitElement {
//   @consume({ context: mossStoreContext })
//   mossStore!: MossStore;

//   @state()
//   view: PageView = PageView.Home;

//   _myDeveloperColletives = new StoreSubscriber(
//     this,
//     () => this.mossStore.toolsLibraryStore.myDeveloperCollectives,
//     () => [],
//   );

//   _developerCollectivesWithPermission = new StoreSubscriber(
//     this,
//     () => this.mossStore.toolsLibraryStore.developerCollectivesWithPermission,
//     () => [],
//   );

//   @state()
//   _selectedDeveloperCollective: ActionHash | undefined;

//   async firstUpdated() {}

//   renderDeveloperCollective() {
//     return html`<developer-collective-view
//       class="flex-scrollable-container"
//       .developerCollectiveHash=${this._selectedDeveloperCollective}
//     ></developer-collective-view>`;
//   }

//   renderCreateDeveloperCollective() {
//     return html`
//       <create-developer-collective
//         @developer-collective-created=${async (e: { detail: EntryRecord<DeveloperCollective> }) => {
//           this.mossStore.toolsLibraryStore.myDeveloperCollectives.reload();
//           this.mossStore.toolsLibraryStore.developerCollectivesWithPermission.reload();
//           this._selectedDeveloperCollective = e.detail.actionHash;
//           this.view = PageView.DeveloperCollective;
//         }}
//       ></create-developer-collective>
//     `;
//   }

//   renderContent() {
//     switch (this.view) {
//       case PageView.CreateDeveloperCollective:
//         console.log('Rendering create publisher view');
//         return this.renderCreateDeveloperCollective();
//       case PageView.DeveloperCollective:
//         return this.renderDeveloperCollective();
//       case PageView.Home:
//         return html`
//           <div class="column center-content" style="text-align: center; flex: 1; font-size: 20px;">
//             <div style="max-width: 600px;">
//               To publish Tools you need to be part of a Developer Collective. Create your own
//               Developer Collective or ask an owner of a Developer Collective to add you as a
//               Contributor.<br /><br />
//               As a contributor you are allowed to publish, update and deprecate Tools under the name
//               of a Developer Collective.
//             </div>
//             <div style="margin-top: 40px; margin-bottom: 10px;">
//               ${msg('Your developer public key is: ')}
//             </div>
//             <div style="font-size: 18px; background: white; padding: 5px; border-radius: 3px;">
//               <pre style="margin: 0;">
// ${encodeHashToBase64(this.mossStore.toolsLibraryStore.toolsLibraryClient.client.myPubKey)}</pre
//               >
//             </div>
//           </div>
//         `;
//       default:
//         return html`<div class="column center-content" style="flex: 1;">Error</div>`;
//     }
//   }

//   renderMyDeveloperCollectives() {
//     switch (this._myDeveloperColletives.value.status) {
//       case 'pending':
//         return html`loading...`;
//       case 'error':
//         console.error(
//           'Failed to fetch my developer collectives: ',
//           this._myDeveloperColletives.value.error,
//         );
//         return html`Error.`;
//       case 'complete':
//         return html`
//           ${this._myDeveloperColletives.value.value
//             .sort((a, b) => a.record.entry.name.localeCompare(b.record.entry.name))
//             .map(
//               (entity) =>
//                 html`<div
//                   tabindex="0"
//                   class="sidebar-btn ${this._selectedDeveloperCollective?.toString() ===
//                   entity.originalActionHash.toString()
//                     ? 'selected'
//                     : ''}"
//                   @click=${() => {
//                     this._selectedDeveloperCollective = entity.originalActionHash;
//                     this.view = PageView.DeveloperCollective;
//                   }}
//                   @keypress=${(e: KeyboardEvent) => {
//                     if (e.key === 'Enter' || e.key === ' ') {
//                       this._selectedDeveloperCollective = entity.originalActionHash;
//                       this.view = PageView.DeveloperCollective;
//                     }
//                   }}
//                 >
//                   <span style="position: absolute; top: 2px; right: 6px; font-size: 12px;"
//                     >owner</span
//                   >
//                   <div class="row" style="align-items: center;">
//                     <img
//                       src=${entity.record.entry.icon}
//                       style="height: 30px; width: 30px; border-radius: 50%;"
//                     />
//                     <span style="margin-left: 5px;">${entity.record.entry.name}</span>
//                   </div>
//                 </div>`,
//             )}
//         `;
//     }
//   }

//   renderDeveloperCollectivesWithPermission() {
//     switch (this._developerCollectivesWithPermission.value.status) {
//       case 'pending':
//         return html`loading...`;
//       case 'error':
//         console.error(
//           'Failed to fetch my developer collectives: ',
//           this._developerCollectivesWithPermission.value.error,
//         );
//         return html`Error.`;
//       case 'complete':
//         return html`
//           ${this._developerCollectivesWithPermission.value.value
//             .sort((a, b) => a.record.entry.name.localeCompare(b.record.entry.name))
//             .map(
//               (entity) =>
//                 html`<div
//                   tabindex="0"
//                   class="sidebar-btn ${this._selectedDeveloperCollective?.toString() ===
//                   entity.originalActionHash.toString()
//                     ? 'selected'
//                     : ''}"
//                   @click=${() => {
//                     this._selectedDeveloperCollective = entity.originalActionHash;
//                     this.view = PageView.DeveloperCollective;
//                   }}
//                   @keypress=${(e: KeyboardEvent) => {
//                     if (e.key === 'Enter' || e.key === ' ') {
//                       this._selectedDeveloperCollective = entity.originalActionHash;
//                       this.view = PageView.DeveloperCollective;
//                     }
//                   }}
//                 >
//                   <span style="position: absolute; top: 2px; right: 6px; font-size: 12px;"
//                     >contributor</span
//                   >
//                   <div class="row" style="align-items: center;">
//                     <img
//                       src=${entity.record.entry.icon}
//                       style="height: 30px; width: 30px; border-radius: 50%;"
//                     />
//                     <span style="margin-left: 5px;">${entity.record.entry.name}</span>
//                   </div>
//                 </div>`,
//             )}
//         `;
//     }
//   }

//   renderSidebar() {
//     return html` <div class="column" style="color: black; left: 260px;">
//       <div
//         tabindex="0"
//         class="sidebar-btn ${this.view === PageView.Home ? 'selected' : ''}"
//         @click=${() => {
//           this.view = PageView.Home;
//           this._selectedDeveloperCollective = undefined;
//         }}
//         @keypress=${(e: KeyboardEvent) => {
//           if (e.key === 'Enter' || e.key === ' ') {
//             this.view = PageView.Home;
//             this._selectedDeveloperCollective = undefined;
//           }
//         }}
//       >
//         <div class="row" style="align-items: center;">
//           <sl-icon
//             style="font-size: 30px; margin-right: 10px;"
//             .src=${wrapPathInSvg(mdiHome)}
//           ></sl-icon>
//           <span>${msg('Home')}</span>
//         </div>
//       </div>
//       <div class="sidebar-title" style="margin-top: 15px;">Your Developer Collectives:</div>
//       ${this.renderMyDeveloperCollectives()} ${this.renderDeveloperCollectivesWithPermission()}
//       <div
//         tabindex="0"
//         class="sidebar-btn ${this.view === PageView.CreateDeveloperCollective ? 'selected' : ''}"
//         style="margin-top: 30px;"
//         @click=${() => {
//           this._selectedDeveloperCollective = undefined;
//           this.view = PageView.CreateDeveloperCollective;
//         }}
//         @keypress=${(e: KeyboardEvent) => {
//           if (e.key === 'Enter' || e.key === ' ') {
//             this._selectedDeveloperCollective = undefined;
//             this.view = PageView.CreateDeveloperCollective;
//           }
//         }}
//       >
//         ${msg('+ Create New Collective')}
//       </div>
//     </div>`;
//   }

//   render() {
//     switch (this._myDeveloperColletives.value.status) {
//       case 'pending':
//         return html`<div class="column center-content" style="flex: 1;">Loading...</div>`;
//       case 'error':
//         console.error(
//           'Failed to fetch my developer collectives: ',
//           this._myDeveloperColletives.value.error,
//         );
//         return html`<div class="column center-content" style="flex: 1;">
//           Error: Failed to fetch my developer collectives. See console for details.
//         </div>`;
//       case 'complete':
//         return html`
//           <div class="row container" style="display: flex; flex: 1;">
//             <div class="sidebar">${this.renderSidebar()}</div>
//             <div class="flex-scrollable-parent" style="flex: 1;">
//               <div class="flex-scrollable-container" style="display: flex; flex: 1;">
//                 <div class="flex-scrollable-y" style="display: flex; flex: 1;">
//                   <!-- <div class="column" style="flex: 1; position: relative; margin: 0;"> -->
//                   ${this.renderContent()}
//                 </div>
//               </div>
//             </div>
//           </div>
//         `;
//     }
//   }

//   static styles = [
//     weStyles,
//     css`
//       :host {
//         display: flex;
//         flex: 1;
//         background-color: #224b21;
//         overflow: auto;
//         color: var(--sl-color-secondary-950);
//         padding: 8px;
//         border-radius: 5px 0 0 0;
//       }

//       .container {
//         background: var(--sl-color-tertiary-0);
//       }

//       .sidebar {
//         width: 250px;
//         background: var(--sl-color-tertiary-500);
//         padding: 5px;
//         padding-top: 20px;
//       }

//       .sidebar-title {
//         color: black;
//         font-size: 18px;
//         font-weight: 500;
//         margin-bottom: 10px;
//       }

//       .sidebar-btn {
//         position: relative;
//         background: var(--sl-color-tertiary-50);
//         font-size: 18px;
//         border-radius: 8px;
//         padding: 12px;
//         margin-bottom: 6px;
//         font-weight: 500;
//         cursor: pointer;
//       }

//       .sidebar-btn:hover {
//         background: var(--sl-color-tertiary-800);
//         color: white;
//       }

//       .sidebar-btn:active {
//         background: var(--sl-color-tertiary-800);
//         color: white;
//       }

//       .selected {
//         background: var(--sl-color-tertiary-800);
//         color: white;
//       }

//       .title {
//         font-size: 30px;
//       }

//       .btn {
//         all: unset;
//         margin: 12px;
//         font-size: 25px;
//         height: 100px;
//         min-width: 300px;
//         background: var(--sl-color-primary-800);
//         color: white;
//         border-radius: 10px;
//         cursor: pointer;
//         box-shadow: 0 2px 5px var(--sl-color-primary-900);
//       }

//       .btn:hover {
//         background: var(--sl-color-primary-700);
//       }

//       .btn:active {
//         background: var(--sl-color-primary-600);
//       }

//       .icon-picker {
//         height: 200px;
//         width: 200px;
//         border-radius: 40px;
//         cursor: pointer;
//         margin-bottom: 20px;
//       }

//       .icon-picker:hover {
//         opacity: 0.7;
//       }

//       .picker-btn {
//         border: 2px solid #7e7e7e;
//         color: #7e7e7e;
//         background: #f9f9f9;
//       }
//       .picker-btn:hover {
//         color: black;
//         border: 2px solid black;
//       }
//     `,
//   ];
// }
