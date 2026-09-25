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
wdocker join-group my-conductor "[group invite link or invite code]"
```

`join-group` takes either form of invite: a group invite link
(`weave-<version>://invite/...`, including the `https://theweave.social/wal?...`
forwarding form) or a bare invite code (`moss-<version>-...`). An invite code
contains no shell metacharacters, so it needs no quoting.

On failure `join-group` exits `1` and prints a single-line reason to stderr. An
invite that cannot be used is reported as `ERROR: invalid invite (<reason>):
<detail>`, where `<reason>` is one of `wrong-format`, `version-mismatch`,
`invalid-seed` or `invalid-progenitor` — branch on that tag rather than on the
prose. On success it exits `0`.

## Instructions

0. Install the `wdocker` CLI globally:

```
npm install -g @theweave/wdocker
```

⚠️ `wdocker` and the Moss group it joins must be on the same Moss line. The
`0.16.x` releases join Moss 0.16 (Holochain 0.7) groups; the `0.15.x` releases
join Moss 0.15 (Holochain 0.6) groups. An invite from the other line is refused
with a `version-mismatch` error rather than producing a group that can never
find its peers.

To run an unreleased version, build from a checkout of the moss repo instead:

```
yarn install
yarn build:libs
yarn workspace @theweave/wdocker build
node wdocker/dist/cli.js --help
```

Nothing puts a `wdocker` binary on your `PATH` in this mode, so substitute
`node wdocker/dist/cli.js` for `wdocker` in the steps below.

⚠️ Conductors created by a 0.15 wdocker live under a separate data root and do
not show up in `wdocker list` on 0.16. They are still on disk, just not
reachable from a 0.16 node.

1. Run a new conductor with a name of your choice:

```
wdocker run [name of your choice]
```

This will prompt you to enter a password which that you will have to enter for any commands that want to access this conductor later.

2. In a separate terminal, you can now join a Moss group with this running conductor. Either
   a group invite link or a bare invite code works.<br>
   ⚠️ **IMPORTANT**: An invite link must be entered in "quotes".

```
wdocker join-group [conductor name from above] "[group invite link or invite code]"
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
  join-group <conductor-name> <invite-in-quotes>          Join a Moss group with a conductor
  disable-group <conductor-name> <dna-hash-base64>        Disable a Moss group and all the tools installed in it.
  enable-group <conductor-name> <dna-hash-base64>         Enable a Moss group and all the tools installed in it.
  help [command]                                          display help for command
```

## Publishing

`@theweave/utils` must be published at `>= 0.7.0-dev.2` before
`@theweave/wdocker` is. wdocker imports `partialModifiersFromInviteString`,
which no earlier release of `@theweave/utils` exports; the yarn workspace link
hides that locally, and the installed CLI dies at module load.

Before announcing a release, smoke test the actual tarball against the real
registry:

```
yarn workspace @theweave/wdocker build
cd wdocker && npm pack
mkdir /tmp/wdocker-smoke && cd /tmp/wdocker-smoke && npm init -y
npm install /path/to/theweave-wdocker-<version>.tgz
node node_modules/@theweave/wdocker/dist/cli.js --help
```
