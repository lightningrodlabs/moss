# @lightningrodlabs/we-applet

This package contains the interfaces and contracts that a Holochain app UI needs to implement in order to become a We Applet.



The differences between a We Applet and a normal Holochain App are:

* A We Applet can make use of the profiles zome provided by We instead of using its own profiles module
* A We Applet can provide more than just the default "main" UI. It can additionally provide:
  * UI elements to display single DHT entries
  * UI widgets/blocks of any kind
  * UI elements ("main" view or "blocks") that render information across all instances of that same Applet type
* A We Applet can provide `AppletServices` for We or other Applets to use, including:
  * search: Searching in the Applet that returns Holochain Resource Locators (HRLs) pointing to DHT content
  * attachmentTypes: Entry types that can be attached by other Applets, alongside with a `create()` method that creates a new entry type to be attached ad hoc.
  * getEntryInfo(): A function that returns info for the entry associated to the HRL if it exists in the Applet and the method is implemented.
  * blockTypes: Types of UI widgets/blocks that this Applet can render if requested by We.



### Implementing a most basic applet UI

```typescript=
import { WeClient, isWeContext } from '@lightningrodlabs/we-applet';

if (!isWeContext) {
  // do non-We related rendering logic (launcher, kangaroo, electron, ...)
}

const weClient = await WeClient.connect();

if (
  !(weClient.renderInfo.type === "applet-view")
  && !(weClient.renderInfo.view.type === "main")
) throw new Error("This Applet only implements the applet main view.");

const appAgentClient = weClient.renderInfo.appletClient;
const profilesClient = weClient.renderInfo.profilesClient;

// Your normal rendering logic here...

```

### Implementing an (almost) full-fletched We Applet


```typescript=
import { WeClient, AppletServices, HrlWithContext, EntryInfo } from '@lightningrodlabs/we-applet';

// First define your AppletServices that We can call on your applet
// to do things like search your applet or get information
// about the available block views etc.
const appletServices: Appletservices = {
    // Types of attachment that this Applet offers for other Applets to attach
    attachmentTypes: async (appletClient: AppAgentClient, appletHash: AppletHash, weServices: WeServices) => {
        'post': {
            label: 'post',
            icon_src: 'data:image/png;base64,iVBORasdwsfvawe',
            create: (attachToHrl: Hrl) => {
            // logic to create a new entry of that type. The attachToHrl can be used for
            // backlinking, i.e. it is the HRL that the entry which is being
            // created with this function is being attached to.
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
    getEntryInfo: async (
        appletClient: AppAgentClient,
        roleName: RoleName,
        integrityZomeName: ZomeName,
        entryType: string,
        hrl: Hrl,
    ): Promise<EntryInfo | undefined> => {
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
      case "entry":
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




