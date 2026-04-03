/**
 * Injects GitHub release notes into a latest-*.yml file.
 *
 * Usage: node scripts/inject-release-notes.mjs <yml-file-path>
 *
 * Requires GITHUB_TOKEN env var and gh CLI to be available.
 * Reads the version from package.json, fetches the release body
 * from GitHub, and adds it as releaseNotes to the yml file.
 */
import yaml from 'js-yaml';
import fs from 'fs';
import child_process from 'child_process';

const ymlPath = process.argv[2];

if (!ymlPath) {
  console.error('Usage: node scripts/inject-release-notes.mjs <yml-file-path>');
  process.exit(1);
}

const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf-8'));
const version = packageJson.version;
const tag = `v${version}`;

let releaseNotes;
try {
  releaseNotes = child_process
    .execSync(`gh release view ${tag} --json body --jq '.body'`, { encoding: 'utf-8' })
    .trim();
} catch (e) {
  console.error(`ERROR: Could not fetch release notes for ${tag}: ${e.message}`);
  console.error('Make sure the GitHub release exists and has a body before running the build.');
  process.exit(1);
}

if (!releaseNotes) {
  console.error(`ERROR: Release notes for ${tag} are empty.`);
  console.error('Add release notes to the GitHub release before running the build.');
  process.exit(1);
}

const latestYaml = yaml.load(fs.readFileSync(ymlPath, 'utf-8'));
latestYaml.releaseNotes = releaseNotes;

fs.writeFileSync(ymlPath, yaml.dump(latestYaml, { lineWidth: -1 }), 'utf-8');
console.log(`Injected release notes into ${ymlPath}`);
