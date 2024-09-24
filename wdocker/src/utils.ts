import semver from 'semver';
import crypto from 'crypto';
import fs from 'fs';
import { exec } from 'child_process';
import {
  CallZomeRequest,
  CallZomeRequestSigned,
  getNonceExpiration,
  randomNonce,
} from '@holochain/client';
import { WeRustHandler, ZomeCallNapi, ZomeCallUnsignedNapi } from '@lightningrodlabs/we-rust-utils';
import { encode } from '@msgpack/msgpack';

export function breakingVersion(version: string): string {
  if (!semver.valid(version)) {
    throw new Error('App has an invalid version number.');
  }
  const prerelease = semver.prerelease(version);
  if (prerelease) {
    return `${semver.major(version)}.${semver.minor(version)}.${semver.patch(version)}-${prerelease[0]}`;
  }
  switch (semver.major(version)) {
    case 0:
      switch (semver.minor(version)) {
        case 0:
          return `0.0.${semver.patch(version)}`;
        default:
          return `0.${semver.minor(version)}.x`;
      }
    default:
      return `${semver.major(version)}.x.x`;
  }
}

export function encrypt(content: string, key: string) {
  // IV is being generated for each encryption
  const iv = crypto.randomBytes(12);

  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encryptedData = cipher.update(content, 'utf-8', 'hex') + cipher.final('hex');

  // Auth tag must be generated after cipher.final()
  const tag = cipher.getAuthTag();

  return encryptedData + '##' + tag.toString('hex') + '##' + iv.toString('hex');
}

export function decrypt(ciphertext: string, key: string) {
  const cipherSplit = ciphertext.split('##');
  const text = cipherSplit[0];
  const tag = Buffer.from(cipherSplit[1], 'hex');
  const iv = Buffer.from(cipherSplit[2], 'hex');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);

  decipher.setAuthTag(tag);

  return decipher.update(text, 'hex', 'utf-8') + decipher.final('utf-8');
}

export async function downloadFile(
  url,
  targetPath,
  expectedSha256Hex,
  chmod = false,
): Promise<void> {
  console.log('Downloading from ', url);
  return new Promise((resolve, reject) => {
    exec(`curl -f -L --output ${targetPath} ${url}`, (error, stdout, stderr) => {
      console.log(stdout);
      console.log(stderr);
      if (error !== null) {
        console.log('exec error: ' + error);
        reject('Failed to fetch resource.');
      } else {
        const fileBytes = fs.readFileSync(targetPath);
        const hasher = crypto.createHash('sha256');
        hasher.update(fileBytes);
        const sha256Hex = hasher.digest('hex');
        if (sha256Hex !== expectedSha256Hex)
          throw new Error(
            `sha256 does not match the expected sha256. Got ${sha256Hex} but expected ${expectedSha256Hex}`,
          );

        console.log('Download successful. sha256 of file (hex): ', sha256Hex);
        if (chmod) {
          fs.chmodSync(targetPath, 511);
          console.log('Gave executable permission to file.');
        }
        resolve();
      }
    });
  });
}

/**
 * Reads the value of a key in a yaml string. Only works for single-line values
 *
 * @param yamlString
 * @param key
 */
export function readYamlValue(yamlString: string, key: string) {
  const lines = yamlString.split('\n');
  const idx = lines.findIndex((line) => line.includes(`${key}:`));
  if (idx === -1) {
    return undefined;
  }
  const relevantLine = lines[idx];
  return relevantLine.replace(`${key}:`, '').trim();
}

export async function signZomeCall(
  request: CallZomeRequest,
  handler: WeRustHandler,
): Promise<CallZomeRequestSigned> {
  const zomeCallUnsignedNapi: ZomeCallUnsignedNapi = {
    provenance: Array.from(request.provenance),
    cellId: [Array.from(request.cell_id[0]), Array.from(request.cell_id[1])],
    zomeName: request.zome_name,
    fnName: request.fn_name,
    payload: Array.from(encode(request.payload)),
    nonce: Array.from(await randomNonce()),
    expiresAt: getNonceExpiration(),
  };

  const zomeCallSignedNapi: ZomeCallNapi = await handler.signZomeCall(zomeCallUnsignedNapi);

  const zomeCallSigned: CallZomeRequestSigned = {
    provenance: Uint8Array.from(zomeCallSignedNapi.provenance),
    cap_secret: null,
    cell_id: [
      Uint8Array.from(zomeCallSignedNapi.cellId[0]),
      Uint8Array.from(zomeCallSignedNapi.cellId[1]),
    ],
    zome_name: zomeCallSignedNapi.zomeName,
    fn_name: zomeCallSignedNapi.fnName,
    payload: Uint8Array.from(zomeCallSignedNapi.payload),
    signature: Uint8Array.from(zomeCallSignedNapi.signature),
    expires_at: zomeCallSignedNapi.expiresAt,
    nonce: Uint8Array.from(zomeCallSignedNapi.nonce),
  };

  return zomeCallSigned;
}
