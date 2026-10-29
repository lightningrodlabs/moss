# Build a Tool for The Weave

A Weave Tool is a Holochain app with a small amount of Moss-specific code on top. Before you start on either path below, read [Versions and Upgrading](./versions) so that you build against the Holochain and `@theweave` versions that the current Moss needs.

## Option 1: Start from Scratch

Building a Tool for the Weave typically happens in **three steps**:

1. 🧁 Build a normal [Holochain](https://www.holochain.org/) app
2. 🧂 Add some sugar to make it run in Moss
3. 🧶 _(optional)_ Knit it together with other Tools by leveraging the interoperability of the Weave Interaction Pattern (WIP)

**Next:** [Tooling Overview](./tooling-overview) lists what you will install, then Step 1 starts with the [Holochain Development Environment](./holochain-development-environment).

## Option 2: Fork and Extend

Instead of building an app from scratch, you can clone an existing Tool and extend from it.

Here are links to a few existing Weave Tools that you may use as a starting point or inspiration, sorted by UI framework:

### **Svelte**

- [KanDo](https://github.com/holochain-apps/kando): Real-time Kanban boards
- [Converge](https://github.com/lightningrodlabs/converge): Decision-making tool

### Lit

- [Notebooks](https://github.com/lightningrodlabs/notebooks): Real-time note taking
- [Presence](https://github.com/matthme/presence): Video Calling

### React

- [Acorn](https://github.com/lightningrodlabs/acorn): Project Management

### How to fork and extend

1. Clone the repository and compare its `hdk` and `@theweave/api` versions with the [versions table](./versions#versions). A Tool that still targets an older Moss needs the upgrade steps on that page before anything else.
2. Enter the Holochain environment with `nix develop` and install the dependencies.
3. Find the npm script that runs the `weave` CLI. These Tools keep a `weave.dev.config.ts` at the repository root and a script such as `tool-dev` (`applet-dev` in repositories not yet renamed), `moss:happ` (Acorn) or `start:moss` (KanDo). Run it. You get Moss windows for two agents with the Tool installed, as described in [Configure CLI](./configure-cli).
4. Make the Tool yours. Change the name, subtitle, description and icon in `weave.dev.config.ts` and the package metadata, and rename the DNA and happ in their `dna.yaml` and `happ.yaml` manifests.
5. Change the zomes and the UI. The Moss-specific parts, the environment check and the CLI configuration, are already in place, so Step 1 and Step 2 of the first path are reference material for what you find in the code.

**Next:** [Publishing a Tool](./publishing-a-tool) explains how to list your Tool so that Moss users can install it.
