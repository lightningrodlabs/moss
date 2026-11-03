# Configure CLI

Your app's code should now be ready to run as a Tool inside Moss. To test it, let's set up a configuration file for the Weave CLI and an npm script:

### 1. Add Config File

Create a file named `weave.dev.config.ts` and add it to the root of your project with the following content:

```typescript
import { defineConfig } from '@theweave/cli';

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
  toolCurations: [],
});
```

### 2. Add npm scripts

Now we can add npm scripts to run your Moss Tool in dev mode for 1 or 2 independent agents. In your root level `package.json` file add the following two scripts:

```json
    "applet-dev": "concurrently \"UI_PORT=8888 npm run start -w ui\" \"weave --agent-idx 1 --dev-config ./weave.dev.config.ts\" \"sleep 5 && weave --agent-idx 2 --dev-config ./weave.dev.config.ts --sync-time 20000\"",
    "applet-dev-1": "concurrently \"UI_PORT=8888 npm run start -w ui\" \"weave --agent-idx 1 --dev-config ./weave.dev.config.ts\"",
```

### 3. Run your Tool

You're all set! 🎉

You should now be able to run your Tool with the following command:

```bash
npm run applet-dev
```

which should spawn two sandboxed instances of Moss for separate agents, each having joined the same Moss group and with your Tool installe in their conductor.

### 4. CLI options

The `weave` CLI accepts a few additional flags that are useful during Tool development. Run `weave --help` for the full list. The most commonly used ones:

| Flag | Purpose |
|---|---|
| `-c, --dev-config <path>` | Path to your `weave.dev.config.ts` |
| `--agent-idx <n>` | Which agent (from the config) to run as |
| `--sync-time <ms>` | Time to wait for gossip after installing a new group |
| `-b, --bootstrap-url <url>` | Use a local bootstrap server instead of production |
| `-r, --relay-url <url>` | Use a local iroh relay instead of production |
| `--force-production-urls` | Explicit opt-in to using production bootstrap/relay in dev |
| `--dev-data-dir <path>` | Persist conductor data across runs (default is a temp dir that gets cleaned up) |
| `--profile <string>` | Run with a named profile (separate data store) |
| `--print-holochain-logs` | Stream holochain logs to the terminal |

For local development against your own bootstrap and iroh relay (e.g. via `kitsune2-bootstrap-srv`):

```bash
weave --agent-idx 1 \
      --dev-config ./weave.dev.config.ts \
      --bootstrap-url http://127.0.0.1:30000 \
      --relay-url http://127.0.0.1:30000
```

Note: the URL flags are not persisted across restarts, so they need to be passed every time.
