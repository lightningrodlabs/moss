import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { weStyles } from './shared-styles';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

@customElement('select-media-source')
export class SelectMediaSource extends LitElement {
  @state()
  _allSources: Electron.DesktopCapturerSource[] = [];

  async firstUpdated() {
    this._allSources = await (window as any).electronAPI.selectmediasource();
    console.log('Got media sources: ', this._allSources);
  }

  render() {
    return html` <div>Hello</div> `;
  }

  static get styles() {
    return [weStyles, css``];
  }
}
