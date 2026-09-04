import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { app } from 'electron';
import { HOLOCHAIN_CHECKSUMS, MOSS_CONFIG } from './mossConfig';
import {
  binaryVersionFor,
  holochainBinaryName,
  type BinaryNameConfig,
} from '../../scripts/binary-names.mjs';

const RESOURCES_DIRECTORY = app.isPackaged
  ? path.join(app.getAppPath(), '../app.asar.unpacked/resources')
  : path.join(app.getAppPath(), './resources');

const BINARIES_DIRECTORY = path.join(RESOURCES_DIRECTORY, 'bins');

// The same derivation the build scripts use, so the app looks for exactly the
// file the fetch produced -- fork release tag included.
const BINARY_NAME_CONFIG: BinaryNameConfig = {
  ...MOSS_CONFIG,
  binarySources: HOLOCHAIN_CHECKSUMS.binarySources,
};

const binaryPath = (binaryName: string): string =>
  path.join(BINARIES_DIRECTORY, holochainBinaryName(binaryName, BINARY_NAME_CONFIG));

const HOLOCHAIN_BINARY = binaryPath('holochain');

/**
 * The release the shipped holochain binary was built from -- the holochain
 * version for a stock build, the fork release tag for a fork build. It is what
 * the startup progress and logs should name, so a field-test build says which
 * build it is starting.
 */
const HOLOCHAIN_BINARY_VERSION = binaryVersionFor('holochain', BINARY_NAME_CONFIG);

const LAIR_BINARY = binaryPath('lair-keystore');

/**
 * Only used to run agents in dev mode using the dev CLI - should not be shipped in the actual distributables for Moss
 */
const KITSUNE2_BOOTSTRAP_SRV_BINARY = binaryPath('kitsune2-bootstrap-srv');

const conductorConfigTemplateString = fs.readFileSync(
  path.join(RESOURCES_DIRECTORY, 'conductor-config.yaml'),
  'utf-8',
);
const CONDUCTOR_CONFIG_TEMPLATE = yaml.load(conductorConfigTemplateString);

export {
  HOLOCHAIN_BINARY,
  HOLOCHAIN_BINARY_VERSION,
  LAIR_BINARY,
  KITSUNE2_BOOTSTRAP_SRV_BINARY,
  CONDUCTOR_CONFIG_TEMPLATE,
};
