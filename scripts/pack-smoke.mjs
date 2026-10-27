// Packs the project in the current folder once, installs that tarball in an empty folder and runs its bin, so the file
// the release workflow publishes is the file that was seen to run.
//   node scripts/pack-smoke.mjs --out <dir>
// Leaves <dir>/package.tgz and prints its shasum. Any failure prints `pack-smoke: failed: <reason>` and exits 1.
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const at = process.argv.indexOf('--out');
const outArg = at >= 0 ? process.argv[at + 1] : undefined;
if (!outArg || outArg.startsWith('-')) {
  console.error('usage: pack-smoke --out <dir>');
  process.exit(1);
}

class Failure extends Error {}
const fail = (reason) => { throw new Failure(reason); };
const npm = (args, cwd) => spawnSync('npm', args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' });

/** The JSON array `npm pack --json` prints: the last line that is a lone `[`, so a lifecycle script's own output before it is ignored. */
const packResult = (stdout) => {
  const starts = [...stdout.matchAll(/^\[$/gm)];
  if (starts.length === 0) fail('npm pack printed no JSON result');
  return JSON.parse(stdout.slice(starts.at(-1).index));
};

const work = mkdtempSync(join(tmpdir(), 'burhan-pack-smoke-'));
let summary;
try {
  const { name, version, bin } = JSON.parse(readFileSync('package.json', 'utf8'));
  const binPath = typeof bin === 'string' ? bin : Object.values(bin ?? {})[0];
  if (!binPath) fail(`${name} declares no bin`);

  const out = resolve(outArg);
  mkdirSync(out, { recursive: true });
  const packed = npm(['pack', '--json', '--pack-destination', out], process.cwd());
  if (packed.status !== 0) fail(`npm pack exited ${packed.status}: ${packed.stderr.trim().split('\n').pop()}`);
  const [{ filename, shasum }] = packResult(packed.stdout);
  const tarball = join(out, 'package.tgz');
  renameSync(join(out, filename), tarball);

  writeFileSync(join(work, 'package.json'), '{"private":true}');
  const installed = npm(['install', '--ignore-scripts', '--no-audit', '--no-fund', tarball], work);
  if (installed.status !== 0) fail(`installing the tarball exited ${installed.status}: ${installed.stderr.trim().split('\n').pop()}`);
  const ran = spawnSync(process.execPath, [join(work, 'node_modules', name, binPath), '--version'], { encoding: 'utf8' });
  if (ran.status !== 0) fail(`the installed bin exited ${ran.status}: ${(ran.stderr || ran.error?.message || '').trim().split('\n').pop()}`);
  const printed = ran.stdout.trim();
  if (printed !== version) fail(`the installed bin printed "${printed}", expected "${version}"`);
  summary = `pack-smoke: ok ${name}@${version} ${tarball} shasum ${shasum}`;
} catch (error) {
  if (!(error instanceof Failure)) throw error;
  console.error(`pack-smoke: failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  rmSync(work, { recursive: true, force: true });
}
if (summary) console.log(summary);
