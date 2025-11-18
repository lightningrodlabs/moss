/**
 * This script extends the appRun script of an AppImage to disable SUID sandboxing.
 * Then repackages the AppImage and overwrites the latest-linux.yaml file with a new sha256 hash.
 */
import yaml from 'js-yaml';
import fs from 'fs';
import crypto from 'crypto';
import child_process from 'child_process';

const electronBuilderYaml = yaml.load(fs.readFileSync('electron-builder.yml', 'utf-8'));
const packageJson = JSON.parse(fs.readFileSync('package.json'));
const appId = electronBuilderYaml.appId;
const productName = electronBuilderYaml.productName;
const appVersion = packageJson.version;

let arch;
let arch_linux;
switch (process.arch) {
  case 'arm64':
    arch = 'arm64';
    arch_linux = 'aarch64';
    break;
  case 'x64':
    arch = 'x86_64';
    arch_linux = 'x86_64';
    break;
}

const imageFileName = `${appId}-${appVersion}-${arch}.AppImage`;
const imageFilePath = `dist/${imageFileName}`;

const fileBytesBefore = fs.readFileSync(imageFilePath);
const hasher1 = crypto.createHash('sha512');
hasher1.update(fileBytesBefore);
const sha512_before = hasher1.digest('base64');
console.log('  sha512 before modification: ', sha512_before);
console.log('fileSize before modification: ', fileBytesBefore.length);

const unpackDirectory = `squashfs-root`;
console.log('Unpacking appImage file for subsequent modification. This may take a while...');
const stdout = child_process.execSync(`${imageFilePath} --appimage-extract`);
console.log('appImage file unpacked.');

// Modify the postinst script
const posinstPath = `${unpackDirectory}/AppRun`;
const postinstScript = fs.readFileSync(posinstPath, 'utf-8');
const postinstScriptModified = postinstScript.replace(
  'exec "$BIN"',
  `ELECTRON_DISABLE_SANDBOX=1 exec "$BIN"`,
);

fs.writeFileSync(posinstPath, postinstScriptModified);

console.log('Wrote modified AppRun script:\n', postinstScriptModified);

// Package modified .AppImage file
if (!fs.existsSync(`appimagetool-${arch_linux}.AppImage`)) {
  const stdout42 = child_process.execSync(`wget https://github.com/AppImage/AppImageKit/releases/download/continuous/appimagetool-${arch_linux}.AppImage`);
}
const stdout43 = child_process.execSync(`chmod +x appimagetool-${arch_linux}.AppImage`)
console.log('Re-packaging modified AppRun file...');
const stdout2 = child_process.execSync(`./appimagetool-${arch_linux}.AppImage ${unpackDirectory} ${imageFilePath}`);
console.log('Modified appImage file packaged.', stdout2.toString());

// Modify sha512 hashes of latest-linux.yaml
const fileBytes = fs.readFileSync(imageFilePath);
const hasher = crypto.createHash('sha512');
hasher.update(fileBytes);
const sha512 = hasher.digest('base64');

const latestYaml = yaml.load(
  fs.readFileSync(`dist/latest-linux${arch === 'arm64' ? '-arm64' : ''}.yml`),
);

console.log('latestYaml before modification:\n', latestYaml);

const files = latestYaml.files.filter((file) => file.url !== imageFileName);
files.push({
  url: imageFileName,
  sha512,
  size: fileBytes.length,
  //blockMapSize: FIXME: Figure out how to get this value updated,
});

latestYaml.files = files;
latestYaml.sha512 = sha512;

console.log('\n\nsha512: ', sha512);
console.log('\n\nlatestYaml after modification:\n', latestYaml);

fs.writeFileSync(
  `latest-linux${arch === 'arm64' ? '-arm64' : ''}.yml`,
  yaml.dump(latestYaml, { lineWidth: -1 }),
  'utf-8',
);
console.log('\nextend-apprun script DONE\n\n');