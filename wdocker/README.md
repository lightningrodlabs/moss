# wdocker

CLI to run Moss always-online nodes.

⚠️ wdocker is not supported on Windows

## Headless / non-interactive usage

wdocker also supports a few environment variables for automation, CI, and container-based setups:

- `WDOCKER_PASSWORD`: supplies the conductor password without prompting. If this variable is set, wdocker will use it for password prompts and initial password creation. The value must be non-empty; whitespace-only values are rejected.
- `WDOCKER_PROFILE_NAME`: overrides the profile name used when joining a group.
- `WDOCKER_NODE_DESCRIPTION`: overrides the node description used when joining a group.
- `WDOCKER_PURGE_CONFIRM`: controls purge confirmation in non-interactive mode. Set it to `true` to skip the confirmation prompt and proceed with purge. Any other value aborts the purge.

Example:

```bash
WDOCKER_PASSWORD='secret' \
WDOCKER_PROFILE_NAME='my-node' \
WDOCKER_NODE_DESCRIPTION='Runs in CI' \
wdocker join-group my-conductor "[group invite link]"
```

## Instructions

0. Install the `wdocker` CLI globally:

```
npm install -g @theweave/wdocker
```

⚠️ The versions currently on npm target the Holochain 0.6 line and cannot join
Moss 0.16 (Holochain 0.7) groups. Until a 0.16 release is published, build from
a checkout of the moss repo instead:

```
yarn install
yarn build:libs
yarn workspace @theweave/wdocker build
node wdocker/dist/cli.js --help
```

1. Run a new conductor with a name of your choice:

```
wdocker run [name of your choice]
```

This will prompt you to enter a password which that you will have to enter for any commands that want to access this conductor later.

2. In a separate terminal, you can now join a Moss group with this running conductor.<br>
   ⚠️ **IMPORTANT**: The invite link must be entered in "quotes".

```
wdocker join-group [conductor name from above] "[group invite link]"
```

3. That's it. The running conductor will now check for new unactivated tools in the group every 5 minutes and install them if needed. If you stop the conductor you can start it going forward with

```
wdocker start [conductor name]
```

Run `wdocker --help` to see all commands:

```
$ wdocker help
Usage: wdocker [options] [command]

Run always-online nodes for the Weave

Options:
  -V, --version                                           output the version number
  -h, --help                                              display help for command

Commands:
  run <conductor-name>                                    run a new conductor
  start <conductor-name>                                  start an existing conductor
  stop <conductor-name>                                   stop a running conductor
  restart <conductor-name>                                restart a conductor
  purge <conductor-name>                                  Completely remove a conductor and delete all associated data.
  info <conductor-name>                                   info about a running conductor
  list                                                    List all conductors
  list-apps <conductor-name>                              list all installed apps for a conductor
  list-groups <conductor-name>                            list all joined groups for a conductor
  group-info [options] <conductor-name> <group-dna-hash>  list all joined groups for a conductor
  join-group <conductor-name> <invite-link-in-quotes>     Join a Moss group with a conductor
  disable-group <conductor-name> <dna-hash-base64>        Disable a Moss group and all the tools installed in it.
  enable-group <conductor-name> <dna-hash-base64>         Enable a Moss group and all the tools installed in it.
  help [command]                                          display help for command
```
