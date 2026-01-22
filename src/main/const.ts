import path from 'path';
import fs from 'fs';
import yaml from 'js-yaml';
import {app} from 'electron';
import {MOSS_CONFIG} from './mossConfig';

const RESOURCES_DIRECTORY = app.isPackaged
    ? path.join(app.getAppPath(), '../app.asar.unpacked/resources')
    : path.join(app.getAppPath(), './resources');

const BINARIES_DIRECTORY = path.join(RESOURCES_DIRECTORY, 'bins');

const HOLOCHAIN_BINARIES: Record<string, string> = {};
HOLOCHAIN_BINARIES[MOSS_CONFIG.holochain.version] = path.join(
    BINARIES_DIRECTORY,
    `holochain-v${MOSS_CONFIG.holochain.version}${process.platform === 'win32' ? '.exe' : ''}`,
);

const LAIR_BINARY = path.join(
    BINARIES_DIRECTORY,
    `lair-keystore-v${MOSS_CONFIG["lair-keystore"].version}${process.platform === 'win32' ? '.exe' : ''}`,
);

/**
 * Only used to run agents in dev mode using the dev CLI - should not be shipped in the actual distributables for Moss
 */
const KITSUNE2_BOOTSTRAP_SRV_BINARY = path.join(
    BINARIES_DIRECTORY,
    `kitsune2-bootstrap-srv-v${MOSS_CONFIG["kitsune2-bootstrap-srv"].version}${process.platform === 'win32' ? '.exe' : ''}`,
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
