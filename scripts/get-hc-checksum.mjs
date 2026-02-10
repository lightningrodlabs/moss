#!/usr/bin/env node

/**
 * Fetch GitHub release data and generate a JSON file of wanted binaries SHA256 checksums
 *
 * Usage: node script.mjs <owner/repo> <tag>
 * Example: node script.mjs rust-lang/rustup 1.27.0
 */

import { execSync } from 'child_process';
import {readFileSync, writeFileSync} from 'fs';


/** get assets data as json */
async function fetchRelease(repo, tag) {
  console.log(`Fetching release ${tag} from ${repo}...`);
  try {
    const output = execSync(`gh release view ${tag} -R ${repo} --json tagName,assets`, {
      encoding: 'utf-8'
    });
    return JSON.parse(output);
  } catch (error) {
    throw new Error(`Failed to fetch release: ${error.message}`);
  }
}

/** */
function parseChecksumFile(content) {
  const checksums = new Map();
  const lines = content.split('\n').filter(line => line.trim());

  for (const line of lines) {
    // Support multiple checksum formats:
    // SHA256 (file) = hash
    // hash  file
    // hash *file
    // hash  ./file

    let match;

    // Format: SHA256 (filename) = hash
    match = line.match(/SHA256\s*\(([^)]+)\)\s*=\s*([a-fA-F0-9]{64})/);
    if (match) {
      checksums.set(match[1].trim(), match[2].toLowerCase());
      continue;
    }

    // Format: hash  filename or hash *filename
    match = line.match(/^([a-fA-F0-9]{64})\s+[\*]?\.?\/?(.+)$/);
    if (match) {
      checksums.set(match[2].trim(), match[1].toLowerCase());
      continue;
    }
  }

  return checksums;
}

const binaryNameList = [
  "hc",
  "holochain",
  "lair-keystore",
  "kitsune2-bootstrap-srv",
]

function extractTargetFromFilename(filename) {
  // Common patterns for target extraction
  const patterns = [
    /-(aarch64-apple-darwin)/,
    /-(aarch64-unknown-linux-gnu)/,
    /-(aarch64-unknown-linux-musl)/,
    /-(x86_64-apple-darwin)/,
    /-(x86_64-pc-windows-msvc)\.exe$/,
    /-(x86_64-pc-windows-msvc)/,
    /-(x86_64-unknown-linux-gnu)/,
    /-(x86_64-unknown-linux-musl)/,
    /-(arm-unknown-linux-gnueabihf)/,
    /-(armv7-unknown-linux-gnueabihf)/,
    /-(i686-pc-windows-msvc)\.exe$/,
    /-(i686-pc-windows-msvc)/,
    /-(i686-unknown-linux-gnu)/,
  ];

  for (const pattern of patterns) {
    const match = filename.match(pattern);
    if (match) {
      return match[1] + (filename.endsWith('.exe') ? '.exe' : '');
    }
  }

  // Fallback: return the full filename if no pattern matches
  return filename;
}


function extractBinaryName(filename, target) {
  // Remove the target and extension from filename to get the binary name
  let name = filename.replace(new RegExp(`-${target.replace('.exe', '')}.*$`), '');

  // Remove common version patterns
  name = name.replace(/-v?\d+\.\d+\.\d+(-\w+(\.\d+)?)?$/, '');

  return name || 'unknown';
}


/** */
async function main() {
  const [repoArg] = process.argv.slice(2);

  if (!repoArg) {
    console.error('Usage: node script.mjs <owner/repo>');
    console.error('Example: node script.mjs rust-lang/rustup');
    process.exit(1);
  }

  // Check if gh CLI is installed
  try {
    execSync('gh --version', { stdio: 'ignore' });
  } catch (error) {
    console.error('Error: GitHub CLI (gh) is not installed or not in PATH');
    console.error('Install from: https://cli.github.com/');
    process.exit(1);
  }

  // get holochain version from moss config
  const mossConfigJSON = readFileSync('moss.config.json');
  const mossConfig = JSON.parse(mossConfigJSON);
  const tag = 'holochain-' + mossConfig.holochain;

  const release = await fetchRelease(repoArg, tag);

  const version = release.tagName.replace(/^holochain-/, '');
  const assets = release.assets;

  const allChecksums = new Map();
  const binaryAssets = assets.filter(asset => {
    for (const name of binaryNameList) {
      //console.log(`Checking for ${name} in ${asset.name}: ${asset.name.startsWith(name)}`);
      const target = extractTargetFromFilename(asset.name);
      const binaryName = extractBinaryName(asset.name, target);
      if (binaryName === name) {
        allChecksums.set(asset.name, asset.digest.replace(/^sha256:/, ''));
        return true;
      }
    }
    return false;
  });
  console.log(`Found ${binaryAssets.length} matching binary asset(s)`);

  const binaries = { version };

  for (const asset of binaryAssets) {

    const target = extractTargetFromFilename(asset.name);
    const binaryName = extractBinaryName(asset.name, target);

    // if (!binaryNameList.includes(binaryName)) {
    //   continue;
    // }
    //
    // Look up SHA256 from parsed checksums
    const sha256 = allChecksums.get(asset.name);

    if (!sha256) {
      console.warn(`⚠ No checksum found for ${asset.name}`);
      continue;
    }

    if (!binaries[binaryName]) {
      binaries[binaryName] = {}
      //   version: version,
      //   sha256: {}
      // };
    }

    binaries[binaryName][target] = sha256;
  }
  const binCount = Object.keys(binaries).length - 1; // dont count version key


  const output = JSON.stringify(binaries, null, 2);
  //const repo = repoArg.split('/')[1];
  const outputFile = `holochain-checksums.json`;

  writeFileSync(outputFile, output);
  console.log(`\n✓ Generated ${outputFile}`);
  console.log(`\nFound ${binCount} distinct binaries for a total of ${binaryAssets.length} assets.\n`);
}


/** */
main().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
