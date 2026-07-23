import fs from 'fs';
import crypto from 'crypto';
import yaml from 'js-yaml';
import path from 'path';

function generateUpdateMetadata(platform, version, filePath) {
  const stats = fs.statSync(filePath);
  const fileBuffer = fs.readFileSync(filePath);
  const sha512 = crypto.createHash('sha512').update(fileBuffer).digest('base64');
  const fileName = path.basename(filePath);

  const metadata = {
    version: version,
    files: [
      {
        url: fileName,
        sha512: sha512,
        size: stats.size,
      },
    ],
    path: fileName,
    sha512: sha512,
    releaseDate: new Date().toISOString(),
    releaseNotes: `Test update to version ${version}

This is a local test update for auto-update validation.

Changes:
- Testing auto-update functionality
- Verifying download and install process`,
  };

  // Determine metadata filename by platform
  const metadataFiles = {
    mac: 'latest-mac.yml',
    win: 'latest.yml',
    linux: 'latest-linux.yml',
  };

  const metadataFileName = metadataFiles[platform];
  if (!metadataFileName) {
    throw new Error(`Unknown platform: ${platform}. Use: mac, win, or linux`);
  }

  const metadataPath = path.join(path.dirname(filePath), metadataFileName);
  fs.writeFileSync(metadataPath, yaml.dump(metadata));

  console.log(`✓ Generated ${metadataFileName}`);
  console.log(`  Version: ${version}`);
  console.log(`  File: ${fileName}`);
  console.log(`  Size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  SHA512: ${sha512.substring(0, 32)}...`);
  console.log(`  Path: ${metadataPath}`);
}

// CLI usage
const [platform, version, filePath] = process.argv.slice(2);

if (!platform || !version || !filePath) {
  console.error('Usage: node generate-update-yml.mjs <platform> <version> <file-path>');
  console.error('Example: node generate-update-yml.mjs linux 0.15.1 dist/org.lightningrodlabs.moss-0.15-0.15.1-x86_64.AppImage');
  process.exit(1);
}

generateUpdateMetadata(platform, version, filePath);
