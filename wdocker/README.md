# hdocker

CLI to run Moss always-online nodes.

⚠️ wdocker is not supported on Windows

## Instructions

0. Install the `wdocker` CLI globally:

```
npm install -g @theweave/wdocker
```

1. Run a new conductor with a name of your choice:

```
wdocker run [name of your choice]
```

This will prompt you to enter a password which that you will have to enter for any commands that want to access this conductor later.

2. In a separate terminal, you can now join a Moss group with this running conductor.
   ⚠️ **IMPORTANT**: The invite link must be entered in "quotes".

```
wdocker join-group [conductor name from above] "[group invite link]"
```

3. That's it. The running conductor will now check for new unjoined tools in the group every 5 minutes and install them if needed. If you stop the conductor you can start it going forward with

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
  purge <conductor-name>                                  Completely remove a conductor and delete all associated data.
  info <conductor-name>                                   info about a running conductor
  list                                                    List all conductors
  list-apps <conductor-name>                              list all installed apps for a conductor
  list-groups <conductor-name>                            list all joined groups for a conductor
  group-info [options] <conductor-name> <group-dna-hash>  list all joined groups for a conductor
  join-group <conductor-name> <invite-link-in-quotes>     Join a Moss group with a conductor
  help [command]                                          display help for command
```
