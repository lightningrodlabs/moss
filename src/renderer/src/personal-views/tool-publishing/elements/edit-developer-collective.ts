// import { html, LitElement, css } from 'lit';
// import { customElement, property, query, state } from 'lit/decorators.js';
// import { localized, msg } from '@lit/localize';
// import { notifyError, onSubmit } from '@holochain-open-dev/elements';

// import '@shoelace-style/shoelace/dist/components/card/card.js';
// import '@shoelace-style/shoelace/dist/components/icon/icon.js';
// import '@shoelace-style/shoelace/dist/components/button/button.js';
// import '@shoelace-style/shoelace/dist/components/input/input.js';
// import '@shoelace-style/shoelace/dist/components/textarea/textarea.js';

// import { weStyles } from '../../../shared-styles.js';
// import '../../../elements/dialogs/select-group-dialog.js';
// import { mossStoreContext } from '../../../context.js';
// import { MossStore } from '../../../moss-store.js';
// import { consume } from '@lit/context';
// import { resizeAndExportImg } from '../../../utils.js';
// import { DeveloperCollective, UpdateableEntity } from '@theweave/tool-library-client';

// @localized()
// @customElement('edit-developer-collective')
// export class EditDeveloperCollective extends LitElement {
//   @consume({ context: mossStoreContext })
//   mossStore!: MossStore;

//   @property()
//   developerCollectiveEntity!: UpdateableEntity<DeveloperCollective>;

//   @state()
//   _iconSrc: string | undefined;

//   @state()
//   _updatingCollective = false;

//   @query('#icon-file-picker')
//   private _iconFilePicker!: HTMLInputElement;

//   firstUpdated() {
//     this._iconSrc = this.developerCollectiveEntity.record.entry.icon;
//   }

//   onIconUploaded() {
//     if (this._iconFilePicker.files && this._iconFilePicker.files[0]) {
//       const reader = new FileReader();
//       reader.onload = (e) => {
//         const img = new Image();
//         img.crossOrigin = 'anonymous';
//         img.onload = () => {
//           this._iconSrc = resizeAndExportImg(img);
//           this._iconFilePicker.value = '';
//         };
//         img.src = e.target?.result as string;
//       };
//       reader.readAsDataURL(this._iconFilePicker.files[0]);
//     }
//   }

//   async updateDeveloperCollective(fields: {
//     collective_name: string;
//     collective_website?: string;
//     collective_contact?: string;
//     collective_description?: string;
//   }) {
//     if (!this._iconSrc) {
//       notifyError('No Icon provided.');
//       throw new Error('Icon is required.');
//     }
//     if (fields.collective_name.length > 50) {
//       notifyError('Name is too long (max 50 chars.).');
//       throw new Error('Name is too long (max 50 chars.).');
//     }
//     if (fields.collective_description && fields.collective_description.length > 1200) {
//       notifyError('Description is too long (max 1200 chars.).');
//       throw new Error('Description is too long (max 1200 chars.).');
//     }
//     if (fields.collective_website && fields.collective_website.length > 500) {
//       notifyError('Website is too long (max 500 chars.).');
//       throw new Error('Website is too long (max 500 chars.).');
//     }
//     if (fields.collective_contact && fields.collective_contact.length > 300) {
//       notifyError('Contact information is too long (max 300 chars.).');
//       throw new Error('Contact information is too long (max 300 chars.).');
//     }
//     this._updatingCollective = true;
//     const updatedDeveloperCollective: DeveloperCollective = {
//       name: fields.collective_name,
//       description: fields.collective_description,
//       website: fields.collective_website,
//       contact: fields.collective_contact,
//       icon: this._iconSrc,
//       meta_data: undefined,
//     };
//     const developerCollectiveRecord =
//       await this.mossStore.toolsLibraryStore.toolsLibraryClient.updateDeveloperCollective({
//         original_developer_collective_hash: this.developerCollectiveEntity.originalActionHash,
//         previous_developer_collective_hash: this.developerCollectiveEntity.record.actionHash,
//         updated_developer_collective: updatedDeveloperCollective,
//       });
//     this._updatingCollective = false;
//     this._iconSrc = undefined;
//     this.dispatchEvent(
//       new CustomEvent('developer-collective-updated', {
//         detail: developerCollectiveRecord,
//         bubbles: true,
//         composed: true,
//       }),
//     );
//     console.log('Developer collective updated: ', developerCollectiveRecord.entry);
//   }

//   render() {
//     return html`
//       <div class="column" style="margin: 16px; flex: 1; align-items: center;">
//         <div class="title" style="margin-bottom: 50px; margin-top: 30px;">
//           ${msg('Edit Developer Collective')}
//         </div>
//         <form
//           id="form"
//           ${onSubmit(async (fields) => {
//             await this.updateDeveloperCollective(fields);
//           })}
//         >
//           <div class="column" style="align-items: center;">
//             <input
//               type="file"
//               id="icon-file-picker"
//               style="display: none"
//               accept="image/*"
//               @change=${this.onIconUploaded}
//             />
//             ${this._iconSrc
//               ? html`<img
//                   tabindex="0"
//                   @click=${() => this._iconFilePicker.click()}
//                   @keypress=${(e: KeyboardEvent) => {
//                     if (e.key === 'Enter') {
//                       this._iconFilePicker.click();
//                     }
//                   }}
//                   src=${this._iconSrc}
//                   alt="Developer Collective Icon"
//                   class="icon-picker"
//                 />`
//               : html`<div
//                   tabindex="0"
//                   @click=${() => this._iconFilePicker.click()}
//                   @keypress=${(e: KeyboardEvent) => {
//                     if (e.key === 'Enter') {
//                       this._iconFilePicker.click();
//                     }
//                   }}
//                   class="column center-content icon-picker picker-btn"
//                   style="font-size: 34px;height: 200px; width: 200px; border-radius: 40px;"
//                 >
//                   + Add Icon
//                 </div>`}
//             <sl-input
//               name="collective_name"
//               required
//               .placeholder=${msg('Name*')}
//               @input=${(e) => {
//                 if (!e.target.value || e.target.value.length < 3) {
//                   e.target.setCustomValidity(
//                     'Name of developer collective must be at least 3 characters.',
//                   );
//                 } else {
//                   e.target.setCustomValidity('');
//                 }
//               }}
//               style="margin-bottom: 8px;"
//               value=${this.developerCollectiveEntity.record.entry.name}
//             ></sl-input>
//             <sl-input
//               name="collective_website"
//               .placeholder=${msg('Website')}
//               style="margin-bottom: 8px;"
//               value=${this.developerCollectiveEntity.record.entry.website}
//             ></sl-input>
//             <sl-input
//               name="collective_contact"
//               .placeholder=${msg('Contact')}
//               style="margin-bottom: 8px;"
//               value=${this.developerCollectiveEntity.record.entry.contact}
//             ></sl-input>
//             <sl-textarea
//               name="collective_description"
//               .placeholder=${msg('Description')}
//               style="margin-bottom: 8px;"
//               value=${this.developerCollectiveEntity.record.entry.description}
//             ></sl-textarea>
//             <div class="row">
//               <sl-button
//                 variant="danger"
//                 style="margin-top: 20px; margin-right: 10px;"
//                 @click=${() => this.dispatchEvent(new CustomEvent('cancel-edit'))}
//               >
//                 ${msg('Cancel')}
//               </sl-button>
//               <sl-button
//                 variant="primary"
//                 type="submit"
//                 .loading=${this._updatingCollective}
//                 style="margin-top: 20px;"
//               >
//                 ${msg('Update')}
//               </sl-button>
//             </div>
//           </div>
//         </form>
//       </div>
//     `;
//   }

//   static styles = [
//     weStyles,
//     css`
//       :host {
//         display: flex;
//         flex: 1;
//       }

//       sl-input {
//         width: 500px;
//       }

//       sl-textarea {
//         width: 500px;
//       }

//       .applet-card {
//         border-radius: 20px;
//         border: 1px solid black;
//         min-height: 90px;
//         width: 600px;
//         margin: 0;
//         padding: 10px;
//         --border-radius: 15px;
//         cursor: pointer;
//         border: none;
//         --border-color: transparent;
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
