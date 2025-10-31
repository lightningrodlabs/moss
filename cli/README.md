# @theweave/cli

CLI to run Moss Tools in development mode.

This version is compatible with `@theweave/api@0.4.0-alpha.3`.

```
Usage: @theweave/cli [options]

Running Moss Tools in development mode.

Options:
  -V, --version                  output the version number
  -p, --profile <string>         Runs We with a custom profile with its own dedicated data store.
  -n, --network-seed <string>    Installs AppStore with the provided network seed in case AppStore has not been installed yet.
  -c, --dev-config <path>        Runs We in applet developer mode based on the configuration file at the specified path.
  --dev-data-dir <path>          Override the directory in which conductor data is stored in dev mode (default is a folder in the
                                 temp directory). Data in this directory will be cleaned up automatically.
  --holochain-path <path>        Runs the Holochain Launcher with the holochain binary at the provided path. Use with caution since
                                 this may potentially corrupt your databases if the binary you use is not compatible with existing
                                 databases.
  --holochain-rust-log <string>  RUST_LOG value to pass to the holochain binary
  --holochain-wasm-log <string>  WASM_LOG value to pass to the holochain binary
  --lair-rust-log <string>       RUST_LOG value to pass to the lair keystore binary
  -b, --bootstrap-url <url>      URL of the bootstrap server to use (not persisted across restarts).
  -s, --signaling-url <url>      URL of the signaling server to use (not persisted across restarts).
  --ice-urls <string>            Comma separated string of ICE server URLs to use. Is ignored if an external holochain binary is
                                 being used (not persisted across restarts).
  --force-production-urls        Explicitly allow using the production URLs of bootstrap and/or singaling server during applet
                                 development. It is recommended to use hc-local-services to spin up a local bootstrap and signaling
                                 server instead during development.
  --print-holochain-logs         Print holochain logs directly to the terminal (they will be still written to the logfile as well)
  --disable-os-notifications     Disables all notifications to the Operating System
  --agent-idx <number>           To be provided when running with the --dev-config option. Specifies which agent (as defined in the
                                 config file) to run We for. The agent with agentIdx 1 always needs to be run first.
  --sync-time <number>           May be provided when running with the --dev-config option. Specifies the amount of time to wait for
                                 new tools to gossip after having installed a new group before checking for activating tools.
  -h, --help                     display help for command
```

## Instructions

### 1. Define a config file

The config file specifies the groups and Tools to install and run. The following is an example
of a config file that will let the `@theweave/cli` install one group with 3 Tools from different
sources.

`weave.dev.config.ts`:

```=typescript
import { defineConfig } from '@theweave/cli';

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
          name: 'Example Tool',
          instanceName: 'Example Tool',
          registeringAgent: 1,
          joiningAgents: [2],
        },
        {
          name: 'Example Tool Hot Reload',
          instanceName: 'Example Tool Hot Reload',
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
      name: 'Example Tool',
      subtitle: 'Just an Example',
      description: 'Just an example Tool to show the various affordances of Moss',
      icon: {
        type: 'filesystem',
        path: './example/ui/icon.png',
      },
      source: {
        type: 'filesystem',
        path: './example/workdir/example-tool.webhapp',
      },
    },
    {
      name: 'Example Tool Hot Reload',
      subtitle: 'Just an Example',
      description: 'Just an example Tool to show the various affordances of Moss',
      icon: {
        type: 'filesystem',
        path: './example/ui/icon.png',
      },
      source: {
        type: 'localhost',
        happPath: './example/workdir/example-tool.happ',
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
weave --agent-idx 1
```

Run agent 2:

```
weave --agent-idx 2
```
