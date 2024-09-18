# Moss

_Moss_ is a reference implementation of a Frame for [The Weave](https://theweave.social), which can also be understood as a Holochain runtime that makes it trivially easy for groups to build collaboration spaces by composing custom "Tool" suites to meet their collaboration needs.

_Moss_ is composed of a group management DNA, together with a defined pattern on how to build _Tool_ DNAs that can be added to a _Moss_ group. Each such group as well as each _Tool_ used within a group is its own private peer-to-peer network.

_Moss_ used to be called _We_, and you can read about it's early instantiation in [this blogpost](https://eric.harris-braun.com/blog/2022/07/26/id-390).

## Installation

You can download the latest public release [here](https://theweave.social/moss/#download).

If you want to install an unstable dev release, you can pick one on [the releases page](https://github.com/lightningrodlabs/we/releases).

## Developers

### Creating a Moss Tool

The details on how to create a _Tool_ can be found [here](docs/how-to-create-a-tool.md).

### Developering on Moss itself

#### Environment Setup

0. Enter nix shell to get the holochain dev environment (follow [holochain's setup instructions](https://developer.holochain.org/get-started/) if you don't have nix installed yet).

```bash
nix develop
```

1. Run the following command to set up the dev environment:

```bash
yarn setup
```

This command will

- install all npm dependencies
- build the required local libraries
- build the Moss group DNA and the zomes in the crates folder
- fetch the required `holochain` and `lair-keystore` binaries from [here](https://github.com/matthme/holochain-binaries/releases)
- fetch the default apps (at the time of writing those are the app library and the feedback board)
- run the necessary commands to link the packages in `libs/api` and `libs/we-elements` with `yarn link` to have them be hot-reloaded in the example applet

#### Development

The following commands build the example applet and then run we in "applet-dev" mode based on the `we.dev.config.example.ts` file.

```bash
yarn build
yarn build:example-applet
yarn applet-dev-example
```

Moss will start up 2 agents each with the same group and 3 applets installed. One of the applets will be in hot-reloading mode, i.e. you can modify the code in the `example/ui/` directory and should see the changes immediately. You should also see changes applied to the `src/renderer/src` directory immediately reflected.

##### Rust add-ons

The Rust add-ons used in the main process are maintained in a [separate repository](https://github.com/lightningrodlabs/we-rust-utils)

#### Build

```bash
# For windows
yarn build:win

# For macOS
yarn build:mac

# For Linux
yarn build:linux
```

## License

[![License: CAL 1.0](https://img.shields.io/badge/License-CAL%201.0-blue.svg)](https://github.com/holochain/cryptographic-autonomy-license)

Copyright (C) 2021-2024, Harris-Braun Enterprises, LLC

This program is free software: you can redistribute it and/or modify it under the terms of the license
provided in the LICENSE file (CAL-1.0). This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
