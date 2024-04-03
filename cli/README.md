# we-dev-cli

CLI to run We Applets in development mode.

This version is compatible with `@lightningrodlabs/we-applet@0.16.1`.

```
Usage: @lightningrodlabs/we-dev-cli [options]

Running We applets in development mode.

Options:
  -V, --version                output the version number
  -p, --profile <string>       Runs We with a custom profile with its own dedicated data store.
  -n, --network-seed <string>  Installs AppStore with the provided network seed in case AppStore has not been installed yet.
  -c, --dev-config <path>      Runs We in applet developer mode based on the configuration file at the specified path.
  -b, --bootstrap-url <url>    URL of the bootstrap server to use. Must be provided if running in applet dev mode with the --dev-config
                               argument.
  -s, --signaling-url <url>    URL of the signaling server to use. Must be provided if running in applet dev mode with the --dev-config
                               argument.
  --force-production-urls      Explicitly allow using the production URLs of bootstrap and/or singaling server during applet development. It
                               is recommended to use hc-local-services to spin up a local bootstrap and signaling server instead during
                               development.
  --agent-idx <number>         To be provided when running with the --dev-config option. Specifies which agent (as defined in the config file)
                               to run We for.
  -h, --help                   display help for command
```

## Instructions

### 1. Define a config file

The config file specifies the groups and applets to install and run. The following is an example
of a config file that will let the `we-dev-cli` install one group with 3 applets from different
sources.

`we.dev.config.ts`:

```=typescript
import { defineConfig } from '@lightningrodlabs/we-dev-cli';

export default defineConfig({
  groups: [
    {
      name: 'Tennis Club',
      networkSeed: '098rc1m-09384u-crm-29384u-cmkj',
      icon: {
        type: 'filesystem',
        path: './example/ui/tennis_club.png',
      },
      creatingAgent: {
        agentIdx: 1,
        agentProfile: {
          nickname: 'Gaston',
          avatar: {
            type: 'filesystem',
            path: './example/ui/gaston.jpeg',
          },
        },
      },
      joiningAgents: [
        {
          agentIdx: 2,
          agentProfile: {
            nickname: 'Marsupilami',
            avatar: {
              type: 'filesystem',
              path: './example/ui/marsupilami.jpeg',
            },
          },
        },
      ],
      applets: [
        {
          name: 'Example Applet',
          instanceName: 'Example Applet',
          registeringAgent: 1,
          joiningAgents: [2],
        },
        {
          name: 'Example Applet Hot Reload',
          instanceName: 'Example Applet Hot Reload',
          registeringAgent: 1,
          joiningAgents: [2],
        },
        {
          name: 'notebooks',
          instanceName: 'notebooks',
          registeringAgent: 1,
          joiningAgents: [2],
        },
      ],
    },
  ],
  applets: [
    {
      name: 'Example Applet',
      subtitle: 'Just an Example',
      description: 'Just an example applet to show the various affordances of We',
      icon: {
        type: 'filesystem',
        path: './example/ui/icon.png',
      },
      source: {
        type: 'filesystem',
        path: './example/workdir/example-applet.webhapp',
      },
    },
    {
      name: 'Example Applet Hot Reload',
      subtitle: 'Just an Example',
      description: 'Just an example applet to show the various affordances of We',
      icon: {
        type: 'filesystem',
        path: './example/ui/icon.png',
      },
      source: {
        type: 'localhost',
        happPath: './example/workdir/example-applet.happ',
        uiPort: 8888,
      },
    },
    {
      name: 'notebooks',
      subtitle: 'Collaborative note taking',
      description: 'Real-time notetaking based on syn',
      icon: {
        type: 'https',
        url: 'https://lightningrodlabs.org/projects/notebooks.png',
      },
      source: {
        type: 'https',
        url: 'https://github.com/lightningrodlabs/notebooks/releases/download/v0.0.8/notebooks.webhapp',
      },
    },
  ],
});
```

### 2. Run Agents

To run an agent defined in the config file, you need to pass the `--agent-idx` option (if not specified it
will default to agentIdx=1).

Run agent 1:

```
we-dev-cli --agent-idx 1
```

Run agent 2:

```
we-dev-cli --agent-idx 2
```
