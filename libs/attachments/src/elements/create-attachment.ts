import {
  hashProperty,
  notifyError,
  sharedStyles,
  wrapPathInSvg,
} from "@holochain-open-dev/elements";
import { consume } from "@lit-labs/context";
import { css, html, LitElement } from "lit";
import { customElement, property } from "lit/decorators.js";
import { mdiAttachmentPlus } from "@mdi/js";
import { msg, localized } from "@lit/localize";
import { lazyLoad, StoreSubscriber } from "@holochain-open-dev/stores";
import { AnyDhtHash, EntryHash } from "@holochain/client";

import "@holochain-open-dev/elements/dist/elements/display-error.js";
import "@shoelace-style/shoelace/dist/components/button/button.js";
import "@shoelace-style/shoelace/dist/components/skeleton/skeleton.js";
import "@shoelace-style/shoelace/dist/components/icon/icon.js";
import "@shoelace-style/shoelace/dist/components/dropdown/dropdown.js";
import "@shoelace-style/shoelace/dist/components/tooltip/tooltip.js";
import "@shoelace-style/shoelace/dist/components/alert/alert.js";
import "@shoelace-style/shoelace/dist/components/menu/menu.js";
import "@shoelace-style/shoelace/dist/components/menu-item/menu-item.js";
import "@shoelace-style/shoelace/dist/components/menu-label/menu-label.js";
import "@shoelace-style/shoelace/dist/components/divider/divider.js";

// TODO: remove alternative menu when sl-menu includes submenus
import "@material/web/menu/menu.js";
import "@material/web/menu/sub-menu-item.js";
import "@material/web/menu/menu-item.js";

import {
  weClientContext,
  WeClient,
  AttachmentType,
  getAppletsInfosAndGroupsProfiles,
} from "@lightningrodlabs/we-applet";
import { HoloHashMap } from "@holochain-open-dev/utils";

import { AttachmentsStore } from "../attachments-store";
import { attachmentsStoreContext } from "../context";

@localized()
@customElement("create-attachment")
export class CreateAttachment extends LitElement {
  @consume({ context: attachmentsStoreContext, subscribe: true })
  attachmentsStore!: AttachmentsStore;

  @consume({ context: weClientContext, subscribe: true })
  weClient!: WeClient;

  @property(hashProperty("hash"))
  hash!: AnyDhtHash;

  appletsInfosAndGroupsProfiles = new StoreSubscriber(
    this,
    () =>
      lazyLoad(async () =>
        getAppletsInfosAndGroupsProfiles(
          this.weClient,
          Array.from(this.weClient.attachmentTypes.keys())
        )
      ),
    () => []
  );

  async createAttachment(attachmentType: AttachmentType) {
    try {
      const dnaHash = await this.attachmentsStore.client.getDnaHash();
      const hrlWithContext = await attachmentType.create([dnaHash, this.hash]);

      await this.attachmentsStore.client.addAttachment(
        this.hash,
        hrlWithContext
      );
      this.weClient.openHrl(
        hrlWithContext.hrl,
        hrlWithContext.context
      );
    } catch (e) {
      notifyError(msg("Error creating the attachment"));
      console.error(e);
    }
  }

  renderMenuItems() {
    switch (this.appletsInfosAndGroupsProfiles.value.status) {
      case "pending":
        return Array(3).map(
          () =>
            html`<md-menu-item disabled
              ><sl-skeleton></sl-skeleton
            ></md-menu-item>`
        );

      case "complete":
        const { appletsInfos, groupsProfiles } =
          this.appletsInfosAndGroupsProfiles.value.value;

        const attachments = Array.from(
          this.weClient.attachmentTypes.entries()
        );
        if (attachments.length === 0)
          return html`<md-menu-item disabled
            >${msg("There are no attachment types yet.")}</md-menu-item
          >`;

        const groupAttachmentTypes: Record<
          string,
          HoloHashMap<EntryHash, AttachmentType>
        > = {};

        for (const [appletHash, attachmentTypes] of attachments) {
          for (const [name, attachmentType] of Object.entries(
            attachmentTypes
          )) {
            const stringifyedAttachmentType = JSON.stringify({
              label: attachmentType.label,
              icon_src: attachmentType.icon_src,
            });
            if (!groupAttachmentTypes[stringifyedAttachmentType]) {
              groupAttachmentTypes[stringifyedAttachmentType] =
                new HoloHashMap();
            }
            groupAttachmentTypes[stringifyedAttachmentType].set(
              appletHash,
              attachmentType
            );
          }
        }

        return Object.entries(groupAttachmentTypes).map(
          ([stringifiedAttachmentType, attachmentTypesByApplet]) => {
            const { label, icon_src } = JSON.parse(stringifiedAttachmentType);

            return html` <md-sub-menu-item .headline=${label}>
              <sl-icon
                slot="start"
                .src=${icon_src}
                style="margin-left: 16px"
              ></sl-icon>
              <md-menu slot="submenu">
                ${Array.from(attachmentTypesByApplet.entries()).map(
                  ([appletHash, attachmentType]) => html`
                    <md-menu-item
                      .headline=${appletsInfos.get(appletHash)?.appletName}
                      @click=${() => this.createAttachment(attachmentType)}
                    >
                      ${appletsInfos
                        .get(appletHash)
                        ?.groupsIds.map(
                          (groupId) => html`
                            <img
                              slot="start"
                              .src=${groupsProfiles.get(groupId)?.logo_src}
                              style="height: 32px; width: 32px; border-radius: 50%; margin-right: 4px; margin-left: 16px"
                            />
                          `
                        )}
                    </md-menu-item>
                  `
                )}
              </md-menu>
            </md-sub-menu-item>`;
          }
        );

      case "error":
        return html`<display-error
          .headline=${msg("Error fetching the attachment types")}
        ></display-error>`;
    }
  }

  render() {
    return html`
      <sl-tooltip content="Create New Attachment">
        <div
          class="row btn"
          tabindex="0"
          @click=${(e) => {
          const menu = this.shadowRoot?.getElementById("menu") as any;
          menu.anchor = e.target;
          setTimeout(() => {
            menu.show();
          }, 10);
          }}
          @keypress=${(e: KeyboardEvent) => {
            if (e.key === "Enter") {
              const menu = this.shadowRoot?.getElementById("menu") as any;
              menu.anchor = e.target;
              setTimeout(() => {
                menu.show();
              }, 10);
            }
          }}
        >
          <sl-icon .src=${wrapPathInSvg(mdiAttachmentPlus)}></sl-icon>
        </div>
      </sl-tooltip>

      <md-menu fixed id="menu" has-overflow>
        ${this.renderMenuItems()}
      </md-menu>
    `;
  }

  static styles = [sharedStyles,
    css`
      .btn {
        align-items: center;
        background: white;
        padding: 9px;
        border-radius: 50%;
        box-shadow: 1px 1px 3px #6b6b6b;
        cursor: pointer;
      }

      .btn:hover {
        background: #e4e4e4
      }
    `
  ];
}
