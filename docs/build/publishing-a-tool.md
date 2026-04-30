# Publishing a Tool

To publish a Tool in Moss it needs to be referenced from two web2-hosted JSON files:

1. A **Tool list** &mdash; published by a developer collective, listing the Tools they maintain and their versions.
2. A **Curation list** &mdash; published by a curator, picking which Tools (from one or more Tool lists) to recommend to users.

A user adds a curation list URL to their Moss Tool Library, and Moss fetches the curation list, then fetches each referenced Tool list, and displays the curated Tools.

## The Tool List

A Tool list is a JSON document published at a stable URL. It describes a developer collective and the Tools they maintain. Its shape is defined by the `DeveloperCollectiveToolList` type in `@theweave/moss-types`:

```typescript
import { defineDevCollectiveToolList } from '@theweave/moss-types';

export default defineDevCollectiveToolList({
  developerCollective: {
    id: 'my-collective',          // MUST NOT change once published
    name: 'My Developer Collective',
    description: '...',
    contact: { website: '...', email: '...' },
    icon: 'data:image/png;base64,...',
  },
  tools: [
    {
      id: 'my-tool',              // MUST NOT change once published
      title: 'My Tool',
      subtitle: '...',
      description: '...',
      icon: 'data:image/png;base64,...',
      versions: [
        {
          version: '0.1.0',
          versionBranch: '0.1',
          releasedAt: 1700000000000,
          source: { type: 'https', url: 'https://.../my-tool-0.1.0.webhapp' },
          hashes: { webhappHash: '...', happHash: '...', uiHash: '...' },
          changelog: '...',
        },
      ],
    },
  ],
});
```

Once generated to JSON, host this file at a stable URL.

## The Curation List

A curation list points at one or more Tool lists and picks which Tools to surface. Its shape is defined by the `ToolCurations` type:

```typescript
import { defineCurationLists } from '@theweave/moss-types';

export default defineCurationLists({
  curator: {
    name: 'My Curator',
    description: '...',
    contact: { website: '...', email: '...' },
    icon: 'data:image/png;base64,...',
  },
  curationLists: {
    default: {
      name: 'Default',
      description: 'Recommended Tools',
      tags: [],
      tools: [
        {
          toolListUrl: 'https://my-collective.example.com/tool-list.json',
          toolId: 'my-tool',
          versionBranch: '0.1',
          tags: [],
        },
      ],
    },
  },
});
```

Generate this to JSON and host it at a stable URL.

### Reference example

The Lightningrod Labs curation list is open source and is a working example of both the Tool list and curation list patterns, including the build pipeline that generates the JSON files:

[https://github.com/lightningrodlabs/weave-tool-curation](https://github.com/lightningrodlabs/weave-tool-curation)

You can fork that repo as a starting point for your own curation list.

## Adding a Curation List to Moss

Once your curation list is hosted, anyone can add it to their Moss Tool Library:

1. In Moss, open the **Tool Library**.
2. Click **Manage Curation Lists**.
3. Paste the URL of the curation list JSON and click **Add List**.

The Tools in that curation list will then appear in the Tool Library and can be installed into groups.

## Get Your Tool on the LRL Curation List

Want your Tool to be discoverable by everyone using the default Moss curation list? Open a pull request against the Lightningrod Labs curation repo to add your Tool:

[https://github.com/lightningrodlabs/weave-tool-curation](https://github.com/lightningrodlabs/weave-tool-curation)

Your Tool list URL must already be hosted and stable. The PR adds an entry to the LRL curation list pointing at your Tool, and once merged it will appear in the Tool Library for any Moss user with the LRL list installed (which is the default).
