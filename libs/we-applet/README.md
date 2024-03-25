# @lightningrodlabs/we-applet

This package contains the interfaces and contracts that a Holochain app UI needs to implement in order to run as a Tool in a Weave Frame like [Moss](theweave.social#tryit).

The differences between a Weave Tool and a normal Holochain App are:

- A Weave Tool can make use of the profiles zome provided by the Frame instead of using its own profiles module
- A Weave Tool can provide more than just the default "main" UI. It can additionally provide:
  - UI elements to display single "assets"
  - UI widgets/blocks of any kind
  - UI elements ("main" view or "blocks") that render information across all instances of that same Tool type
- A Weave Tool can provide `AppletServices` for the Frame or other Applets to use, including:
  - search: Searching in the Tool that returns Holochain Resource Locators (HRLs) with context pointing to an asset
  - creatables: Assets that can be created on-the-fly by a user.
  - getAssetInfo(): A function that returns info for the asset associated to the WAL if it exists in the Tool and the method is implemented.
  - blockTypes: Types of UI widgets/blocks that this Tool can render if requested by the Frame.

**Definition**: An "Asset" is anything that a) can be identified with an HRL plus arbitrary context and b) has an associated
"asset-view", i.e. it can be displayed by the applet if requested.

### Implementing a most basic applet UI

```typescript=
import { WeClient, isWeContext } from '@lightningrodlabs/we-applet';

if (!isWeContext) {
  // do non-the Frame related rendering logic (launcher, kangaroo, electron, ...)
}

const weClient = await WeClient.connect();

if (
  (weClient.renderInfo.type !== "applet-view")
  || (weClient.renderInfo.view.type !== "main")
) throw new Error("This Tool only implements the applet main view.");

const appAgentClient = weClient.renderInfo.appletClient;
const profilesClient = weClient.renderInfo.profilesClient;

// Your normal rendering logic here...

```

### Implementing an (almost) full-fletched Weave Tool

```typescript=
import { WeClient, AppletServices, WAL, AssetInfo } from '@lightningrodlabs/we-applet';

// First define your AppletServices that the Frame can call on your applet
// to do things like search your applet or get information
// about the available block views etc.
const appletServices: Appletservices = {
    // Types of attachment that this Tool offers for other Applets to attach
    creatables: {
        'post': {
            label: 'post',
            icon_src: 'data:image/png;base64,iVBORasdwsfvawe',
          }
        },
        'comment': {
            ...
        }

    },
    // Types of UI widgets/blocks that this Tool supports
    blockTypes: {
        'most_recent_posts': {
            label: 'most_recent_posts',
            icon_src: 'data:image/png;base64,KJNjknAKJkajsn',
            view: "applet-view",
        },
        'bookmarked_posts': {
            label: 'bookmarked_posts',
            icon_src: 'data:image/png;base64,LKlkJElkjJnlksja',
            view: "cross-applet-view",
        }
    },
    getAssetInfo: async (
        appletClient: AppAgentClient,
        roleName: RoleName,
        integrityZomeName: ZomeName,
        entryType: string,
        wal: WAL,
    ): Promise<AssetInfo | undefined> => {
        // your logic here...
        // for example
        const post = appletClient.callZome({
            'get_post',
            ...
        });
        return {
            title: post.title,
            icon_src: 'data:image/png;base64,iVBORasdwsfvawe'
        };
    },
    search: async (appletClient: AppAgentClient, appletHash: AppletHash, weServices: WeServices, searchFilter: string): Promise<Array<WAL>> => {
        // Your search logic here. For example
        let searchResults: Array<Record> = await appletClient.callZome({
            zome_name: 'search_posts',
            ...
        });
        const appInfo = await appletClient.appInfo();
        const dnaHash = (appInfo.cell_info.notebooks[0] as any)[
          CellType.Provisioned
        ].cell_id[0];

        return searchResults.map((record) => {
                hrl: [
                    dnaHash,
                    record.signed_action.hashed.hash
                ],
                context: {}
            }
        );
    },
}


// Now connect to the WeClient by passing your appletServices
const weClient = await WeClient.connect(appletServices);

// Then handle all the different types of views that you offer
switch (weClient.renderInfo.type) {
  case "applet-view":
    switch (weClient.renderInfo.view.type) {
      case "main":
        // here comes your rendering logic for the main view
      case "block":
        switch(weClient.renderInfo.view.block) {
          case "most_recent_posts":
            // your rendering logic to display this block type
          case "bookmarked_posts":
            // Your rendering logic to display this block type
          default:
             throw new Error("Unknown applet-view block type");
        }
      case "asset":
        switch (weClient.renderInfo.view.roleName) {
          case "forum":
            switch (weClient.renderInfo.view.integrityZomeName) {
              case "posts_integrity":
                switch (weClient.renderInfo.view.entryType) {
                  case "post":
                        // here comes your rendering logic for that specific entry type
                  default:
                    throw new Error("Unknown entry type");
                }
              default:
                throw new Error("Unknown integrity zome");
            }
          default:
            throw new Error("Unknown role name");
        }

      case "creatable":
        switch (weClient.renderInfo.view.creatableName) {
          case "post":
            // here comes your rendering logic to create this creatable type.
            // Once created, you need to call
            // weClient.renderInfo.view.resolve(${WAL of your created creatable here});
            // or if there's an error:
            // weClient.renderInfo.view.reject("Failed to create asset.");
            // or if the user cancelled the creation:
            // weClient.renderInfo.view.cancel();
        }

      default:
        throw new Error("Unknown applet-view type");
    }

  case "cross-applet-view":
    switch (this.weClient.renderInfo.view.type) {
      case "main":
        // here comes your rendering logic for the cross-applet main view
      case "block":
        //
      default:
        throw new Error("Unknown cross-applet-view render type.")

    `;
    }

  default:
    throw new Error("Unknown render view type");

}


```
