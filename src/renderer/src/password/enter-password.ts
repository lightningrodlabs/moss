// import { localized, msg } from '@lit/localize';
// import { html, LitElement } from 'lit';
// import { customElement, state } from 'lit/decorators.js';

// import '@holochain-open-dev/elements/dist/elements/display-error.js';
// import '@shoelace-style/shoelace/dist/components/card/card.js';
// import '@shoelace-style/shoelace/dist/components/switch/switch.js';
// import '@shoelace-style/shoelace/dist/components/button/button.js';
// import '@shoelace-style/shoelace/dist/components/input/input.js';
// import '@shoelace-style/shoelace/dist/components/alert/alert.js';
// import { notifyError, onSubmit } from '@holochain-open-dev/elements';

// import { weStyles } from '../shared-styles.js';
// import { enterPassword } from '../electron-api.js';

// @localized()
// @customElement('enter-password')
// export class EnterPassword extends LitElement {
//   @state()
//   _entering = false;

//   async enterPassword(password: string) {
//     this._entering = true;
//     try {
//       await enterPassword(password);
//       this.dispatchEvent(
//         new CustomEvent('password-entered', {
//           bubbles: true,
//           composed: true,
//         }),
//       );
//     } catch (e) {
//       if ((e as Error).toString().includes('InternalSodium')) {
//         notifyError(msg('Invalid password'));
//       } else {
//         notifyError((e as Error).toString());
//       }
//       console.error(JSON.stringify(e));
//     }
//     this._entering = false;
//   }

//   render() {
//     return html` <sl-card>
//       <span class="title" slot="header">${msg('Enter Password')}</span>
//       <form class="column" ${onSubmit((f) => this.enterPassword(f.password))}>
//         <sl-input
//           id="password-field"
//           type="password"
//           required
//           .placeholder=${msg('Password')}
//           name="password"
//           style="margin-bottom: 16px"
//         ></sl-input>

//         <sl-button type="submit" variant="primary" .loading=${this._entering}>
//           ${msg('Enter Password')}
//         </sl-button>
//       </form></sl-card
//     >`;
//   }

//   static styles = weStyles;
// }
