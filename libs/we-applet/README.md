# @lightningrodlabs/we-applet

This package contains the interfaces and contracts that a Holochain app UI needs to implement in order to become a We Applet.

The differences between a We Applet and a normal Holochain App are:

- A We Applet can make use of the profiles zome provided by We instead of using its own profiles module
- A We Applet can provide more than just the default "main" UI. It can additionally provide:
  - UI elements to display single "attachables"
  - UI widgets/blocks of any kind
  - UI elements ("main" view or "blocks") that render information across all instances of that same Applet type
- A We Applet can provide `AppletServices` for We or other Applets to use, including:
  - search: Searching in the Applet that returns Holochain Resource Locators (HRLs) with context pointing to an attachable
  - creatables: Attachables that can be created on-the-fly by a user.
  - getAttachableInfo(): A function that returns info for the attachable associated to the HrlWithContext if it exists in the Applet and the method is implemented.
  - blockTypes: Types of UI widgets/blocks that this Applet can render if requested by We.

**Definition**: An "attachable" is anything that a) can be identified with an HRL plus arbitrary context and b) has an associated
"attachable-view", i.e. it can be displayed by the applet if requested.

### Implementing a most basic applet UI

```typescript=
import { WeClient, isWeContext } from '@lightningrodlabs/we-applet';

if (!isWeContext) {
  // do non-We related rendering logic (launcher, kangaroo, electron, ...)
}

const weClient = await WeClient.connect();

if (
  (weClient.renderInfo.type !== "applet-view")
  || (weClient.renderInfo.view.type !== "main")
) throw new Error("This Applet only implements the applet main view.");

const appAgentClient = weClient.renderInfo.appletClient;
const profilesClient = weClient.renderInfo.profilesClient;

// Your normal rendering logic here...

```

### Implementing an (almost) full-fletched We Applet

```typescript=
import { WeClient, AppletServices, HrlWithContext, AttachableInfo } from '@lightningrodlabs/we-applet';

// First define your AppletServices that We can call on your applet
// to do things like search your applet or get information
// about the available block views etc.
const appletServices: Appletservices = {
    // Types of attachment that this Applet offers for other Applets to attach
    creatables: {
        'post': {
            label: 'post',
            icon_src: 'data:image/png;base64,iVBORasdwsfvawe',
            creatableView: true,
            create: (appletClient: AppAgentClient, creatableContext: any) => {
            // logic to create a new attachable of that type.
            // The creatable context here will only be passed by We if creatableView is true
            // and there is a creatable view defined to collect context information
            appletClient.callZome(...)
            ...
            }
        },
        'comment': {
            ...
        }

    },
    // Types of UI widgets/blocks that this Applet supports
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
    getAttachableInfo: async (
        appletClient: AppAgentClient,
        roleName: RoleName,
        integrityZomeName: ZomeName,
        entryType: string,
        hrlWithContext: HrlWithContext,
    ): Promise<AttachableInfo | undefined> => {
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
    search: async (appletClient: AppAgentClient, appletHash: AppletHash, weServices: WeServices, searchFilter: string): Promise<Array<HrlWithContext>> => {
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
      case "attachable":
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
            // here comes your rendering logic to collect context information for that
            // specific creatable type. To send the collected information to We to have
            // the creatable be created (through calling the create() method in the creatable
            // that you defined in AppletServices), you need to call
            // weClient.renderInfo.view.resolve(${your collected contextv here});
            // or if there's an error:
            // weClient.renderInfo.view.reject("Failed to create attachable.");
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
