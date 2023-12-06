# We

_We_ is a Holochain runtime that makes it trivially easy for groups to build collaboration spaces by composing custom "Applet" suites to meet their collaboration needs.

_We_ is composed of a group management DNA, together with a defined pattern on how to build _Applet_ DNAs that can be added to a _We_ group. Each such group as well as each _Applet_ used within a group is its own private peer-to-peer network.

For more about the motivation behind _We_, read [this blogpost](https://eric.harris-braun.com/blog/2022/07/26/id-390).

## Design

For details about the design, read the [design document](docs/Design.md).

## Creating We Applets

The details on how to create a _we applet_ can be found [here](docs/How-to-create-a-we-applet.md).

## Installation

Go to [the releases page](https://github.com/lightningrodlabs/we/releases) and download the latest release for your Operating System.

### Install

**Note:** The following steps require Rust and Go installed.

0. Enter nix shell to get the holochain dev environment (follow [holochain's setup instructions](https://developer.holochain.org/get-started/) if you don't have nix installed yet)

```bash
nix develop
```

1. Build the Node Rust-add-ons, install all dependencies and download default apps:

```bash
yarn setup
```

2. Fetch the holochain or lair binaries for your platform:

```bash
# Linux
mkdir resources/bins
yarn fetch-binaries:linux
chmod +x resources/bins/* # give permission to run the binaries

# macOS
mkdir resources/bins
yarn fetch-binaries:macos
chmod +x resources/bins/* # give permission to run the binaries

# Windows
mkdir resources/bins
yarn fetch-binaries:windows
```

OR

Build the sidecar binaries locally:

```bash
bash ./scripts/setup-binaries.sh
```

3. Build the We group happ

```
yarn build:happ
```

### Development

```bash
$ yarn dev
```

### Testing with applets

If you already have applets webhapps to test with, add them in the `testing-applets` folder and run `yarn dev`.

The `scripts/publish-applets.js` is going to be executed when running `yern dev`, which will publish the applets `.webhapp` files that it finds in the `testing-applets` folder.

Note that you need to enter the password and enable dev mode in the App Library within We before the publishing can begin.

To check whether this has finished, look in the terminal for the log: `Published applet: [name of your Applet]`

### Build

```bash
# For windows
$ yarn build:win

# For macOS
$ yarn build:mac

# For Linux
$ yarn build:linux
```

## License

[![License: CAL 1.0](https://img.shields.io/badge/License-CAL%201.0-blue.svg)](https://github.com/holochain/cryptographic-autonomy-license)

Copyright (C) 2021, Harris-Braun Enterprises, LLC

This program is free software: you can redistribute it and/or modify it under the terms of the license
provided in the LICENSE file (CAL-1.0). This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.
