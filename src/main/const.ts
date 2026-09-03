import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import { app } from 'electron';
import { MOSS_CONFIG } from './mossConfig';
import { holochainBinaryName, versionedBinaryName } from '../../scripts/binary-names.mjs';

const RESOURCES_DIRECTORY = app.isPackaged
  ? path.join(app.getAppPath(), '../app.asar.unpacked/resources')
  : path.join(app.getAppPath(), './resources');

const BINARIES_DIRECTORY = path.join(RESOURCES_DIRECTORY, 'bins');

// Keyed by holochain version, not by binary filename: callers look the binary up
// by the version they intend to run. The filename may carry a fork tag instead of
// that version (see scripts/binary-names.mjs).
const HOLOCHAIN_BINARIES: Record<string, string> = {};
HOLOCHAIN_BINARIES[MOSS_CONFIG.holochain] = path.join(
  BINARIES_DIRECTORY,
  holochainBinaryName('holochain', MOSS_CONFIG),
);

const LAIR_BINARY = path.join(
  BINARIES_DIRECTORY,
  holochainBinaryName('lair-keystore', MOSS_CONFIG),
);

/**
 * Only used to run agents in dev mode using the dev CLI - should not be shipped in the actual distributables for Moss
 */
const kitsune2BootstrapSrvVersion = MOSS_CONFIG.kitsune2BootstrapSrv ?? MOSS_CONFIG.holochain;
const KITSUNE2_BOOTSTRAP_SRV_BINARY = path.join(
  BINARIES_DIRECTORY,
  versionedBinaryName('kitsune2-bootstrap-srv', kitsune2BootstrapSrvVersion),
);

const conductorConfigTemplateString = fs.readFileSync(
  path.join(RESOURCES_DIRECTORY, 'conductor-config.yaml'),
  'utf-8',
);
const CONDUCTOR_CONFIG_TEMPLATE = yaml.load(conductorConfigTemplateString);

export {
  HOLOCHAIN_BINARIES,
  LAIR_BINARY,
  KITSUNE2_BOOTSTRAP_SRV_BINARY,
  CONDUCTOR_CONFIG_TEMPLATE,
};
