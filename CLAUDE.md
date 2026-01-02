# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Moss is a Holochain-based runtime for composable peer-to-peer collaboration tools. It's an Electron application that manages Holochain conductor instances, group DNAs, and applets ("Tools"). Each group is a private peer-to-peer network where users can install and compose tools to meet their collaboration needs.

**Core Architecture**: Electron main process (Node.js + Rust utils) manages Holochain conductor subprocesses, while the renderer process provides a web UI that loads applet iframes. Applets communicate via `@theweave/api` and make Holochain zome calls through WebSocket connections.

## Requirements, Tradeoffs & Dev Instructions

0. When reporting on status, or asking questions don't add the emotional tags at the beginning and end of phrases, (you can tell you are doing this if there's an exclamation point at the end of the phrase/sentence).  Just code related information.
1. Each step of the process must be built using test-driven development practices such that CI can confirm no regressions before merging a PR
2. Perfect is the enemy of the good. This plan should not be implemented to the highest possible standard of efficiency or robustness, but rather in a way that allows for reaching the functionality goals in reasonable time, and iterating on quality goals over time.
3. Don't add claude co-authored/generated messages in commit descriptions
4. **Strong typing**: when possible allways use strong typing in typescript.
5. **Holochain reference sources**: We are using Holochain 0.6.  The source for this is local and lives at the same level as this repo. DO NOT USE .cargo files or web searches to research holochain, just look locally.

## Development Commands

### Setup

```bash
# Initial setup (requires nix shell with Holochain environment)
nix develop
yarn setup
```

This command installs dependencies, builds libraries, compiles Rust zomes, fetches Holochain/lair binaries, and links packages.

### Development Modes

```bash
# Build all TypeScript/JS code
yarn build

# Build example applet
yarn build:example-applet

# Run development mode with hot-reload (2 agents)
yarn applet-dev-example

# Run with 1 agent only
yarn applet-dev-example-1

# Run with 3 agents
yarn applet-dev-3

# Run with custom config
yarn applet-dev         # uses weave.dev.config.ts
```

Development mode starts:
- Two `@theweave/api` and `@theweave/elements` watchers for hot-reload
- Vite dev server for example applet UI on port 8888
- Multiple Electron instances (one per agent) with dev config

### Building

```bash
# Compile Rust zomes to WASM
yarn build:zomes

# Build group.happ from Rust zomes
yarn build:group-happ

# Build platform-specific distributables
yarn build:win
yarn build:mac-arm64
yarn build:mac-x64
yarn build:linux
```

### Testing

```bash
# Run all tests
yarn test

# Run specific test suites
yarn test:group
yarn test:assets
```

Tests use Vitest and @holochain/tryorama for Holochain DNA testing.

### Code Quality

```bash
# Format code
yarn format

# Lint with auto-fix
yarn lint

# Type checking
yarn typecheck           # both node and web
yarn typecheck:node
yarn typecheck:web
```

### Library Development

```bash
# Build individual libraries
yarn build:api           # @theweave/api
yarn build:elements      # @theweave/elements
yarn build:libs          # all libraries
yarn build:iframes       # applet-iframe and happ-iframe

# Link libraries for hot-reload
yarn link:libs
```

## Architecture

### Electron Application Structure

**Main Process** (`src/main/`):
- `filesystem.ts` - Manages profile directories, app storage, UI/happ assets
- `holochainManager.ts` - Controls Holochain conductor subprocess lifecycle
- `lairManager.ts` - Manages lair-keystore subprocess for cryptographic signing
- `index.ts` - IPC handlers for renderer communication (50+ functions)
- Uses `@lightningrodlabs/we-rust-utils` for native functionality

**Renderer Process** (`src/renderer/src/`):
- `moss-store.ts` - Central reactive store (groups, applets, tool library)
- `layout/` - View components (group containers, applet frames)
- `applets/applet-host.ts` - Applet iframe lifecycle management
- Built with LitElement and @holochain-open-dev/stores

**Iframes** (`iframes/`):
- `applet-iframe/` - Entry point injected into all applets, creates WeaveClient instance
- `happ-iframe/` - Minimal iframe for happ-only tools (no UI)

### Holochain Integration

**DNAs** (`dnas/`):
- `group/` - Core group management DNA with coordinator/integrity zomes
  - Manages applet registry, agent permissions, custom views
  - Each group has unique network seed (private p2p network)
- Tool DNAs - Provided by applets, installed per group-tool combination
- Each DNA cell is identified by `applet#<sha256(networkSeed)>#<hash>`

**Connections**:
- Admin WebSocket: Port 65432 (conductor management)
- App WebSocket: Port 65433 (zome calls)
- Conductor config stored per profile in `~/.config/Moss/profiles/[profile]/`

### Workspace Structure

The repository is a yarn monorepo with workspaces:

**`libs/`** - Core TypeScript libraries:
- `api/` - `@theweave/api` - Applet API (WeaveClient, types, messaging)
- `elements/` - `@theweave/elements` - Reusable web components
- `grapesjs/` - Visual editor integration

**`shared/`** - Holochain client libraries:
- `group-client/` - `@theweave/group-client` - Group DNA client
- `tool-library-client/` - Tool discovery/installation
- `types/` - `@theweave/moss-types` - Shared TypeScript types
- `utils/` - `@theweave/utils` - Utility functions

**`crates/`** - Rust utilities (not zomes):
- `moss_helpers/` - Helper functions
- `hrl_locator/` - HRL (Holochain Resource Locator) utilities

**`example/`** - Development test applet:
- `dnas/` - Example forum DNA with posts
- `ui/` - Example applet UI using @theweave/api

### Development Configuration System

Development environments use `weave.*.config.ts` files:

```typescript
defineConfig({
  toolCurations: [
    { url: 'https://...', useLists: ['default'] }
  ],
  groups: [
    {
      name: "Group Name",
      networkSeed: "unique-seed",
      icon: { type: 'filesystem' | 'https', path: '...' },
      creatingAgent: { agentIdx: 1, agentProfile: {...} },
      joiningAgents: [{ agentIdx: 2, agentProfile: {...} }],
      applets: [
        {
          name: "Applet Name",
          instanceName: "Instance",
          registeringAgent: 1,
          joiningAgents: [2]
        }
      ]
    }
  ],
  applets: [
    {
      name: "Applet Name",
      subtitle: "...",
      description: "...",
      icon: ResourceLocation,
      source: {
        type: 'filesystem' | 'localhost' | 'https',
        path: '...' | happPath + uiPort | url
      }
    }
  ]
})
```

**Types of sources**:
- `filesystem` - Load from `.webhapp` file
- `localhost` - Hot-reload mode (separate .happ file + dev server port)
- `https` - Remote URL

### File System Layout

Profile data is stored in `~/.config/Moss/profiles/[profile-name]/`:

```
conductor-config.yaml          # Holochain conductor configuration
databases/                     # Conductor SQLite databases
lair/                         # Keystore data
applets-metadata/             # App asset info
tools-icons/                  # Cached tool icons
uis/                          # UI assets (by sha256)
happs/                        # .happ files (by sha256)
logs/                         # Application logs
```

## Build System

**electron-vite** configuration (`electron.vite.config.ts`):
- Main process: Bundles with external deps excluded (except specific packages)
- Preload: Multiple entry points (admin, splashscreen, walwindow, selectmediasource)
- Renderer: Multiple HTML entry points with Shoelace assets copied

**Rust compilation**:
```bash
RUSTFLAGS="--cfg getrandom_backend=\"custom\"" \
  cargo build --release --target wasm32-unknown-unknown --workspace
```

Zomes are compiled to WASM32 target and packaged into `.happ` files using the `hc` CLI.

## Key Files to Understand

### Entry Points
- `src/main/index.ts` - Main process entry, IPC handlers
- `src/renderer/src/index.ts` - Renderer entry
- `iframes/applet-iframe/src/index.ts` - Applet iframe entry, WeaveClient initialization

### Core State Management
- `src/renderer/src/moss-store.ts` - Central application state
- `libs/api/src/api.ts` - WeaveClient API (what applets use)

### Lifecycle and Views
- `src/renderer/src/layout/views/view-frame.ts` - Applet lifecycle state machine
- `src/renderer/src/applets/applet-host.ts` - Applet iframe hosting

### Holochain Integration
- `src/main/holochainManager.ts` - Conductor management
- `shared/group-client/src/group-client.ts` - Group DNA client

### Configuration
- `cli/defineConfig.ts` - Dev config schema
- `moss.config.json` - Runtime configuration (ports, bootstrap URLs)

## Creating Tools/Applets

Documentation for building Moss tools: https://dev.theweave.social/build/overview.html

**Key requirements**:
- `weave.config.json` - Applet metadata file
- Implement `@theweave/api` interface
- Use `WeaveClient` for Moss integration
- Package as `.webhapp` (UI + .happ bundle)

## Holochain Version Management

The project fetches specific Holochain and lair-keystore binaries from https://github.com/matthme/holochain-binaries/releases. Binary versions are specified in fetch scripts (`scripts/fetch-binaries.mjs`).

## Common Patterns

### IPC Communication
Main process exposes handlers via `window.electronAPI` in preload scripts. Renderer calls handlers like:
```typescript
window.electronAPI.installAppletBundle(...)
window.electronAPI.signZomeCall(...)
```

### Reactive Stores
Uses `@holochain-open-dev/stores` pattern:
```typescript
const store = new LazyStore(async () => {
  // async initialization
  return data;
});

subscribe(store, value => {
  // react to changes
});
```

### Applet Communication
Applets use message passing via `WeaveClient`:
```typescript
const client = await WeaveClient.connect();
client.on('message', (message) => {
  // handle parent messages
});
client.send({ type: '...', data: {...} });
```

## Release Process

See `moss-docs/RELEASE.md` for release and Holochain update procedures.
