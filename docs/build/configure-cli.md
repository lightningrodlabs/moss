# Configure CLI

Your app's code should now be ready to run as a Tool inside Moss. To test it, let's set up a configuration file for the Weave CLI and an npm script:

### 1. Add Config File

Create a file named `we.dev.config.json` and add it to the root of your project with the following content:

```typescript
import { defineConfig } from '@lightningrodlabs/we-dev-cli';

export default defineConfig({
  groups: [
    {
      name: 'Tennis Club',
      networkSeed: '098rc1m-09384u-crm-29384u-cmkj',
      icon: {
        type: 'https',
        url: 'https://raw.githubusercontent.com/lightningrodlabs/moss/main/example/ui/tennis_club.png',
      },
      creatingAgent: {
        agentIdx: 1,
        agentProfile: {
          nickname: 'Gaston',
          avatar: {
            type: 'https',
            url: 'https://raw.githubusercontent.com/lightningrodlabs/moss/main/example/ui/gaston.jpeg',
          },
        },
      },
      joiningAgents: [
        {
          agentIdx: 2,
          agentProfile: {
            nickname: 'Marsupilami',
            avatar: {
              type: 'https',
              url: 'https://raw.githubusercontent.com/lightningrodlabs/moss/main/example/ui/marsupilami.jpeg',
            },
          },
        },
      ],
      applets: [
        {
          name: 'Forum',
          instanceName: 'Forum',
          registeringAgent: 1,
          joiningAgents: [2],
        },
      ],
    },
  ],
  applets: [
    {
      name: 'Forum',
      subtitle: 'A simple forum app',
      description: 'Reading and writing posts.',
      icon: {
        type: 'https',
        url: 'https://raw.githubusercontent.com/lightningrodlabs/moss/main/example/ui/icon.png',
      },
      source: {
        type: 'localhost',
        happPath: './workdir/forum.happ',
        uiPort: 8888,
      },
    },
  ],
});
```

### 2. Add npm scripts

Now we can add npm scripts to run your Moss Tool in dev mode for 1 or 2 independent agents. In your root level `package.json` file add the following two scripts:

```json
    "applet-dev": "concurrently \"UI_PORT=8888 npm run start -w ui\" \"we-dev-cli --agent-idx 1 --dev-config ./we.dev.config.ts\" \"sleep 5 && we-dev-cli --agent-idx 2 --dev-config ./we.dev.config.ts --sync-time 20000\"",
    "applet-dev-1": "concurrently \"UI_PORT=8888 npm run start -w ui\" \"we-dev-cli --agent-idx 1 --dev-config ./we.dev.config.ts\"",
```

### 3. Run your Tool

You're all set! 🎉

You should now be able to run your Tool with the following command:

```bash
npm run applet-dev
```

which should spawn two sandboxed instances of Moss for separate agents, each having joined the same Moss group and with your Tool installe in their conductor.
