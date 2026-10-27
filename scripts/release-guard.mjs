// Refuses a release that should not go out: run by the release workflow before anything is published.
//   node scripts/release-guard.mjs --tag vX.Y.Z [--main-ref origin/main]
// Checks, all reported together: the tag is v + the package.json version; the checked-out commit is on main;
// that version is not already on npm. A registry that cannot be read counts as a refusal, never as "free".
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const argv = process.argv.slice(2);
const option = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
const tag = option('--tag');
const mainRef = option('--main-ref') ?? 'origin/main';

if (!tag || mainRef.startsWith('-')) {
  console.error('usage: release-guard --tag vX.Y.Z [--main-ref origin/main]');
  process.exit(1);
}

const { name, version } = JSON.parse(readFileSync('package.json', 'utf8'));
const refused = [];

if (tag !== `v${version}`) refused.push(`the tag ${tag} is not v${version} (the version in package.json)`);

const onMain = spawnSync('git', ['merge-base', '--is-ancestor', 'HEAD', mainRef], { encoding: 'utf8' });
if (onMain.status !== 0) refused.push(`this commit is not on ${mainRef}`);

const view = spawnSync('npm', ['view', `${name}@${version}`, 'version'], { encoding: 'utf8', shell: process.platform === 'win32' });
if (view.status === 0 && view.stdout.trim() === version) refused.push(`${name}@${version} is already published`);
else if (!(view.status !== 0 && /E404/.test(view.stderr))) refused.push(`cannot tell whether ${name}@${version} is published (npm view: ${(view.stderr || view.error?.message || 'no answer').trim().split('\n')[0]})`);

for (const reason of refused) console.error(`release-guard: refused: ${reason}`);
if (refused.length > 0) process.exit(1);
console.log(`release-guard: ok ${name}@${version} on ${mainRef}, not published`);
