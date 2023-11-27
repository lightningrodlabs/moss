import { LitElement, css, html } from "lit";
import { customElement, property, state } from "lit/decorators.js";

import { localized } from "@lit/localize";
import { sharedStyles, wrapPathInSvg } from "@holochain-open-dev/elements";

import "./elements/all-posts.js";
import "./elements/create-post.js";
import "./elements/post-detail.js";
import "./elements/posts-context.js";

import { WeClient, type RenderInfo, AppletServices, weClientContext, weLinkFromAppletHash } from "@lightningrodlabs/we-applet";

import "@lightningrodlabs/we-applet/dist/elements/we-client-context.js";
import "@lightningrodlabs/attachments/dist/elements/attachments-context.js";

import "./applet-main.js";
import "./cross-applet-main.js";
import { AttachmentsStore } from "@lightningrodlabs/attachments";
import { CellType } from "@holochain/client";
import { consume } from "@lit-labs/context";
import { PostsStore } from "./posts-store.js";

@localized()
// @customElement("example-applet")
export class ExampleApplet extends LitElement {

  @consume({ context: weClientContext })
  weClient!: WeClient;

  @property()
  postsStore!: PostsStore;

  @property()
  attachmentsStore!: AttachmentsStore;

  firstUpdated() {
    if (this.weClient.renderInfo.type === "applet-view") {
      const groupProfiles = this.weClient.renderInfo.groupProfiles;
      console.log("Got group profiles: ", groupProfiles);
      const appletHash = this.weClient.renderInfo.appletHash;
      console.log("we link for applet: ", weLinkFromAppletHash(appletHash));
    }
  }

  render() {
    if (!this.weClient.renderInfo) return html`loading...`;
    switch (this.weClient.renderInfo.type) {
      case "applet-view":
        switch (this.weClient.renderInfo.view.type) {
          case "main":
            const client = this.weClient.renderInfo.appletClient;
            return html`
              <posts-context .store=${this.postsStore}>
                <attachments-context .store=${this.attachmentsStore}>
                  <applet-main
                    .client=${this.weClient.renderInfo.appletClient}
                    .weClient=${this.weClient}
                    @post-selected=${async (e: CustomEvent) => {
                      const appInfo = await client.appInfo();
                      const dnaHash = (appInfo.cell_info.forum[0] as any)[
                        CellType.Provisioned
                      ].cell_id[0];
                      this.weClient!.openHrl([dnaHash, e.detail.postHash], {
                        detail: "post",
                      });
                    }}
                  ></applet-main>
                </attachments-context>
              </posts-context>
            `
          case "block":
            throw new Error("Block view is not implemented.");
          case "entry":
            switch (this.weClient.renderInfo.view.roleName) {
              case "forum":
                switch (this.weClient.renderInfo.view.integrityZomeName) {
                  case "posts_integrity":
                    switch (this.weClient.renderInfo.view.entryType) {
                      case "post":
                        return html`
                          <posts-context .store=${this.postsStore}>
                            <attachments-context .store=${this.attachmentsStore}>
                              <post-detail .postHash=${this.weClient.renderInfo.view.hrl[1]}></post-detail>
                            </attachments-context>
                          </posts-context>
                        `
                      default:
                        throw new Error(`Unknown entry type ${this.weClient.renderInfo.view.entryType}.`);
                    }
                  default:
                    throw new Error(`Unknown zome '${this.weClient.renderInfo.view.integrityZomeName}'.`);
                }
              default:
                throw new Error(`Unknown role name '${this.weClient.renderInfo.view.roleName}'.`);
            }
          default:
            throw new Error(`Unknown applet-view type.`);
        }
      case "cross-applet-view":
        return html`
          <cross-applet-main .applets=${this.weClient.renderInfo.applets}></cross-applet-main>
        `;
      default:
        throw new Error("Unknown render view type");
    }
  }

  static styles = [
    css`
      :host {
        display: flex;
        flex: 1;
      }
    `,
    sharedStyles,
  ];
}
