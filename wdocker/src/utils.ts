import semver from 'semver';
import crypto from 'crypto';
import fs from 'fs';
import { sha512 } from 'js-sha512';
import { exec } from 'child_process';
import {
  CallZomeRequest,
  CallZomeRequestSigned,
  getNonceExpiration,
  randomNonce,
} from '@holochain/client';
import rustUtils from '@lightningrodlabs/we-rust-utils';
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
  handler: rustUtils.WeRustHandler,
): Promise<CallZomeRequestSigned> {
  if (!request.provenance)
    return Promise.reject(
      'Call zome request has provenance field not set. This should be set by the js-client.',
    );

  const zomeCallToSign: CallZomeRequest = {
    cell_id: request.cell_id,
    zome_name: request.zome_name,
    fn_name: request.fn_name,
    payload: encode(request.payload),
    provenance: request.provenance,
    nonce: await randomNonce(),
    expires_at: getNonceExpiration(),
  };

  const zomeCallBytes = encode(zomeCallToSign);
  const bytesHash = sha512.array(zomeCallBytes);

  const signature: number[] = await handler.signZomeCall(bytesHash, Array.from(request.provenance));

  const signedZomeCall: CallZomeRequestSigned = {
    bytes: zomeCallBytes,
    signature: Uint8Array.from(signature),
  };

  return signedZomeCall;
}
