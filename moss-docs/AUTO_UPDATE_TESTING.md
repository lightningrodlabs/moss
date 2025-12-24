# Auto-Update Testing Guide

This guide explains how to test Moss's auto-update functionality locally without requiring network access or deployed releases.

## Prerequisites

1. Install dependencies (this adds `express` needed for the local update server):
```bash
yarn install
```

**Note**: You can only test auto-update on your current platform. Cross-platform building requires specific toolchains (e.g., you can't build macOS .dmg files on Linux). The instructions below are platform-specific.

## Overview

The testing setup consists of:
- **dev-app-update.yml** - Configuration file that points to localhost update server
- **scripts/update-server.mjs** - Local Express server that serves update files
- **scripts/generate-update-yml.mjs** - Generates update metadata files
- **test-updates/** directory - Where you place built packages for testing
- **DEV_UPDATE_CONFIG** environment variable - Points the app to dev-app-update.yml

## Quick Start

### Step 1: Build Current Version

**IMPORTANT**: First, ensure the code changes for DEV_UPDATE_CONFIG support are in place (they should be in src/main/index.ts around line 863-879).

Ensure your `package.json` version is set to the "current" version (e.g., `0.15.0`):

```bash
# Build for your platform (Linux example):
yarn build:linux

# Other platforms:
# yarn build:mac-arm64  # macOS ARM64
# yarn build:mac-x64    # macOS Intel
# yarn build:win        # Windows
```

The built files will be in the `dist/` directory. You can test from this directory without installing system-wide.

### Step 2: Build Update Version

1. Change the version in `package.json` to the "update" version (e.g., `0.15.1`)
2. Build again:

```bash
yarn build:linux  # (or your platform)
```

3. Create the test-updates directory:

```bash
mkdir -p test-updates
```

4. Copy the built package to test-updates:

The actual filenames include the app ID from electron-builder.yml. Check your `dist/` directory for the exact filename.

```bash
# Linux (check dist/ for exact arch - x86_64, arm64, etc.)
cp dist/org.lightningrodlabs.moss-0.15-0.15.1-x86_64.AppImage test-updates/

# macOS (if building on Mac)
# cp dist/org.lightningrodlabs.moss-0.15-0.15.1-arm64.dmg test-updates/
# cp dist/org.lightningrodlabs.moss-0.15-0.15.1-x64.dmg test-updates/

# Windows (if building on Windows)
# cp dist/org.lightningrodlabs.moss-0.15-0.15.1-setup.exe test-updates/
```

To find your exact filename:
```bash
ls -la dist/*.AppImage  # Linux
# ls -la dist/*.dmg     # macOS
# ls -la dist/*.exe     # Windows
```

### Step 3: Generate Update Metadata

Run the metadata generator for your platform (use the exact filename you copied):

```bash
# Linux example (adjust architecture as needed)
yarn gen-update-meta linux 0.15.1 test-updates/org.lightningrodlabs.moss-0.15-0.15.1-x86_64.AppImage

# macOS examples (if building on Mac)
# yarn gen-update-meta mac 0.15.1 test-updates/org.lightningrodlabs.moss-0.15-0.15.1-arm64.dmg
# yarn gen-update-meta mac 0.15.1 test-updates/org.lightningrodlabs.moss-0.15-0.15.1-x64.dmg

# Windows example (if building on Windows)
# yarn gen-update-meta win 0.15.1 test-updates/org.lightningrodlabs.moss-0.15-0.15.1-setup.exe
```

This will create the appropriate `latest-*.yml` file in the test-updates directory with SHA512 hashes and file metadata.

### Step 4: Start Update Server

In a separate terminal, start the local update server:

```bash
yarn update-server
```

You should see:
```
✓ Update server running at http://localhost:5555
✓ Serving from: .../test-updates
```

Keep this running while you test.

### Step 5: Test Update Flow

1. Set the environment variable to point to your dev-app-update.yml file and launch the installed version:

```bash
# Linux/macOS
DEV_UPDATE_CONFIG=/full/path/to/moss/dev-app-update.yml ./dist/org.lightningrodlabs.moss-0.15-0.15.0-x86_64.AppImage

# Or if you installed it system-wide
DEV_UPDATE_CONFIG=/full/path/to/moss/dev-app-update.yml moss
```

2. Check the console output - you should see:
```
Using dev update config from: /full/path/to/moss/dev-app-update.yml
Config: { provider: 'generic', url: 'http://localhost:5555/updates' }
```

3. The app will check for updates on startup
4. If configured correctly, you should see an update notification
5. Click to download the update
6. Monitor the download progress
7. When complete, click to install and restart
8. Verify the new version (0.15.1) launches

**Important**: You must rebuild the app (yarn build:linux) after the code changes that enable DEV_UPDATE_CONFIG support.

## Breaking Version Logic

**IMPORTANT**: Moss uses a special breaking version logic for 0.x versions:

For version 0.x.y:
- Breaking version = `0.x` (minor version changes are breaking)
- Updates only allowed within same minor version

Examples:
- ✅ 0.15.0 → 0.15.1 (allowed - same 0.15)
- ✅ 0.15.0 → 0.15.9 (allowed - same 0.15)
- ❌ 0.15.0 → 0.16.0 (blocked - different 0.16)
- ❌ 0.15.0 → 0.14.9 (blocked - downgrade)

For version 1.x.y and above:
- Breaking version = `x.y` (major.minor)
- Updates allowed within same major.minor

## Testing Scenarios

### Test 1: Basic Update Flow
```bash
# Current: 0.15.0
# Update:  0.15.1
# Expected: Update available and downloads
```

### Test 2: Breaking Version Block
```bash
# Current: 0.15.0
# Update:  0.16.0
# Expected: No update shown (breaking version)
```

### Test 3: Downgrade Block
```bash
# Current: 0.15.1
# Update:  0.15.0
# Expected: No update shown (older version)
```

## Debugging

Enable debug logging and use dev update config:

```bash
# Linux
DEV_UPDATE_CONFIG=/full/path/to/moss/dev-app-update.yml \
  ./dist/org.lightningrodlabs.moss-0.15-0.15.0-x86_64.AppImage

# macOS
DEV_UPDATE_CONFIG=/full/path/to/moss/dev-app-update.yml \
  /Applications/Moss.app/Contents/MacOS/Moss
```

Check the console for:
```
Using dev update config from: /full/path/to/moss/dev-app-update.yml
Config: { provider: 'generic', url: 'http://localhost:5555/updates' }
```

Check the update server logs to see if the app is making requests:
```
GET /updates/latest-linux.yml
GET /updates/org.lightningrodlabs.moss-0.15-0.15.1-x86_64.AppImage
```

## File Structure

After setup, your directory should look like (Linux example):

```
moss/
├── dev-app-update.yml                                         # Points to localhost:5555
├── scripts/
│   ├── update-server.mjs                                      # Local HTTP server
│   └── generate-update-yml.mjs                                # Metadata generator
├── dist/                                                       # Build output
│   ├── org.lightningrodlabs.moss-0.15-0.15.0-x86_64.AppImage # Current version
│   └── org.lightningrodlabs.moss-0.15-0.15.1-x86_64.AppImage # Update version
└── test-updates/
    ├── latest-linux.yml                                       # Generated metadata
    └── org.lightningrodlabs.moss-0.15-0.15.1-x86_64.AppImage # Copied update package
```

## Cleanup

When done testing:

1. Stop the update server (Ctrl+C)
2. Remove test files:
```bash
rm -rf test-updates/
```
3. Optionally remove `dev-app-update.yml` if not testing further

## Upgrading electron-updater

See `.claude/auto-update-analysis.plan` for detailed analysis of upgrading from `@matthme/electron-updater` to the official `electron-updater` package.

**Recommendation**: Upgrade to `electron-updater@6.6.2` for:
- 20+ bug fixes since 6.3.0
- Security updates (semver dependency)
- Better platform support (Windows/macOS/Linux fixes)
- Stable release vs alpha
