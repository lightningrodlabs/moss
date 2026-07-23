/**
 * This script extends the appRun script of an AppImage to disable SUID sandboxing.
 * Then repackages the AppImage and overwrites the latest-linux.yaml file with a new sha512 hash.
 *
 * This script extends the deb postinst script with the creation of an apparmor profile
 * on Ubuntu 24.04 (https://github.com/electron/electron/issues/41066), repackages
 * the deb file and then overwrites the latest-linux.yaml file with the new sha512 hash
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
let app_image_arch;
switch (process.arch) {
    case 'arm64':
        arch = 'arm64';
        app_image_arch = 'arm64';
        arch_linux = 'aarch64';
        break;
    case 'x64':
        arch = 'amd64';
        app_image_arch = 'x86_64';
        arch_linux = 'x86_64';
        break;
}

///////////////////////////////////////////////////////////////////////////////////////////////////

// AppImage extraction
const imageFileName = `${appId}-${appVersion}-${app_image_arch}.AppImage`;
const imageFilePath = `dist/${imageFileName}`;
const fileBytesBefore = fs.readFileSync(imageFilePath);
const sha512_before = crypto.createHash('sha512').update(fileBytesBefore).digest('base64');
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

const fileBytes = fs.readFileSync(imageFilePath);
const sha512 = crypto.createHash('sha512').update(fileBytes).digest('base64');


///////////////////////////////////////////////////////////////////////////////////////////////////

// deb extraction
const debFileName = `${appId}-${appVersion}-${arch}.deb`;
const debFilePath = `dist/${debFileName}`;
const debFileBytesBefore = fs.readFileSync(debFilePath);
const deb_sha512_before = crypto.createHash('sha512').update(debFileBytesBefore).digest('base64');
console.log('  sha512 before modification: ', deb_sha512_before);
console.log('fileSize before modification: ', debFileBytesBefore.length);
const debUnpackDirectory = `dist/modified-deb`;
console.log('Unpacking deb file for subsequent modification. This may take a while...');
const deb_stdout = child_process.execSync(`dpkg-deb -R ${debFilePath} ${debUnpackDirectory}`);
console.log('.deb file unpacked.');

// Modify the postinst script
const debPosinstPath = `${debUnpackDirectory}/DEBIAN/postinst`;
const debPostinstScript = fs.readFileSync(debPosinstPath, 'utf-8');
const debPostinstScriptModified = debPostinstScript.replace(
    '# SUID chrome-sandbox for Electron 5+',
    `
if [ -e /etc/lsb-release ]; then

  while IFS='=' read -r key value

  do
    if [ "$key" == "DISTRIB_RELEASE" ]; then
       release_version=$value
    fi
  done < /etc/lsb-release


  if [[ $release_version > 24* ]]; then

  # chown the sandbox on Ubuntu 24.04 or higher
  chown root '/opt/${productName}/chrome-sandbox' || true

  # add AppArmor profile on Ubuntu 24.04 or higher
  profile_content="# This profile allows everything and only exists to give the
# application a name instead of having the label "unconfined"

abi <abi/4.0>,
include <tunables/global>

profile ${appId} \\"/opt/${productName}/${appId}\\" flags=(unconfined) {
  userns,

  # Site-specific additions and overrides. See local/README for details.
  include if exists <local/${appId}>
}"

    echo "$profile_content" > /etc/apparmor.d/${appId}

    systemctl reload apparmor.service

  fi

fi

# SUID chrome-sandbox for Electron 5+
`,
);

fs.writeFileSync(debPosinstPath, debPostinstScriptModified);
console.log('Wrote modified postinst script: ', debPostinstScriptModified);
// Package modified .deb file
console.log('Re-packaging modified deb file...');
const deb_stdout2 = child_process.execSync(`dpkg-deb -b ${debUnpackDirectory} ${debFilePath}`);
console.log('Modified deb file packaged.');
/// Compute new sha512 hash of deb file
const debFileBytes = fs.readFileSync(debFilePath);
const debSha512 = crypto.createHash('sha512').update(debFileBytes).digest('base64');

///////////////////////////////////////////////////////////////////////////////////////////////////

// Modify sha512 hashes of latest-linux.yaml
const latestYaml = yaml.load(
    fs.readFileSync(`dist/latest-linux${arch === 'arm64' ? '-arm64' : ''}.yml`),
);
console.log('latestYaml before modification:\n', latestYaml);

const files = [] //latestYaml.files.filter((file) => file.url !== imageFileName);
files.push({
    url: imageFileName,
    sha512,
    size: fileBytes.length,
    //blockMapSize: FIXME: Figure out how to get this value updated,
});
files.push({
    url: debFileName,
    sha512: debSha512,
    size: debFileBytes.length,
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
console.log('\n Script update latest yaml DONE\n\n');