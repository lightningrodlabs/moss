#!/usr/bin/env node

import { createReadStream, readFileSync } from 'fs';
import { createHash } from 'crypto';
import { access, constants } from 'fs/promises';

/**
 * Hash a binary file using SHA-512 and return base64 encoded result
 * @param {string} filePath - Path to the file to hash
 * @returns {Promise<string>} Base64 encoded SHA-512 hash
 */
async function hashFile(filePath) {
  // Check if file exists and is readable
  try {
    await access(filePath, constants.R_OK);
  } catch (error) {
    throw new Error(`Cannot read file: ${filePath}`);
  }

  const fileBytes = readFileSync(filePath);
  console.log('Size: ', fileBytes.length);
  const hasher = createHash('sha512');
  hasher.update(fileBytes);
  const sha512 = hasher.digest('base64');
  return sha512;
}

// Main execution
const filePath = process.argv[2];

if (!filePath) {
  console.error('Usage: node sha512.mjs <file-path>');
  process.exit(1);
}

try {
  const hash = await hashFile(filePath);
  console.log(hash);
} catch (error) {
  console.error('Error:', error.message);
  process.exit(1);
}
