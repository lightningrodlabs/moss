import { LitElement, css, html } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { mossStyles } from './shared-styles';
import '@shoelace-style/shoelace/dist/components/icon/icon.js';

@customElement('select-media-source')
export class SelectMediaSource extends LitElement {
  @state()
  _allSources: { name: string; id: string; thumbnail: string; aspectRatio: number }[] = [];

  async firstUpdated() {
    this._allSources = await (window as any).electronAPI.getMediaSources();
    console.log('Got media sources: ', this._allSources);
  }

  async sourceSelected(id: string) {
    console.log('Selected source: ', id);
    await (window as any).electronAPI.sourceSelected(id);
  }

  render() {
    return html`
      <div class="column" style="align-items: center;">
        <h1>Entire Screen</h1>
        <div class="row" style="flex-wrap: wrap; justify-content: center; margin-bottom: 20px;">
          ${this._allSources
            .filter((source) => source.id.startsWith('screen'))
            .map((source) => {
              return html`
                <div class="column" style="align-items: center;">
                  <div style="font-weight: bold; font-size: 20px; margin-bottom: 5px;">
                    ${source.name}
                  </div>
                  <img
                    class="thumbnail"
                    tabindex="0"
                    @click=${async () => this.sourceSelected(source.id)}
                    @keypress=${async (e: KeyboardEvent) => {
                      if (e.key === 'Enter') {
                        this.sourceSelected(source.id);
                      }
                    }}
                    src=${source.thumbnail}
                    style="aspec-ratio: ${source.aspectRatio}; height: 200px; margin: 0 10px;"
                  />
                </div>
              `;
            })}
        </div>
        <h1>Window</h1>
        <div class="row" style="flex-wrap: wrap; justify-content: center;">
          ${this._allSources
            .filter(
              (source) =>
                source.id.startsWith('window') && source.name !== 'Select Screen or Window',
            )
            .map((source) => {
              return html`
                <div class="column" style="align-items: center; height: 300px;">
                  <img
                    class="thumbnail"
                    tabindex="0"
                    @click=${async () => this.sourceSelected(source.id)}
                    @keypress=${async (e: KeyboardEvent) => {
                      if (e.key === 'Enter') {
                        this.sourceSelected(source.id);
                      }
                    }}
                    src=${source.thumbnail}
                    style="aspec-ratio: ${source.aspectRatio}; height: 200px; margin: 0 10px;"
                  />
                  <div
                    style="font-weight: bold; font-size: 20px; margin-bottom: 5px; max-width: 360px;"
                  >
                    ${source.name}
                  </div>
                </div>
              `;
            })}
        </div>
      </div>
    `;
  }

  static get styles() {
    return [
      mossStyles,
      css`
        .thumbnail {
          border-radius: 5px;
          border: 2px solid black;
          cursor: pointer;
        }

        .thumbnail:hover {
          outline: 6px solid #1cb4ef;
        }

        .thumbnail:focus {
          outline: 6px solid #1cb4ef;
        }
      `,
    ];
  }
}
