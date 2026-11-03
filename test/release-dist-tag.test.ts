import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { notOnWindows, tmpDir } from './helpers.js';

// Tests run from .test-build/test, so the repository root is two levels up.
const script = fileURLToPath(new URL('../../scripts/release-dist-tag.mjs', import.meta.url));

/** One ustar entry: a 512-byte header, the body, and zero padding to a 512-byte boundary. */
function tarEntry(name: string, body: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 'utf8');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return Buffer.concat([header, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

/** A gzip'd tarball laid out as npm packs one: package/README.md, then package/package.json at `version` (left out when null). */
function tarball(version: string | null): string {
  const entries = [tarEntry('package/README.md', Buffer.from('readme\n'))];
  if (version !== null) entries.push(tarEntry('package/package.json', Buffer.from(JSON.stringify({ name: 'demo-pkg', version }))));
  const file = join(tmpDir('burhan-dist-tag-'), 'package.tgz');
  writeFileSync(file, gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])));
  return file;
}

/** Runs the script with GITHUB_OUTPUT pointed at a fresh file (never the CI run's own), and returns that file's text. */
function run(...args: string[]): { status: number | null; out: string; output: string } {
  const output = join(tmpDir('burhan-dist-tag-out-'), 'github-output');
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: output } });
  return { status: r.status, out: r.stdout + r.stderr, output: existsSync(output) ? readFileSync(output, 'utf8') : '' };
}

test('a prerelease tarball checked against latest is refused, exit 1', () => {
  const r = run('--tarball', tarball('1.0.0-rc.1'), '--expect', 'latest');
  assert.equal(r.status, 1);
  assert.match(r.out, /release-dist-tag: refused: 1\.0\.0-rc\.1 inside .*package\.tgz goes to next, not to "latest"/);
});

test('a plain tarball checked against next is refused, exit 1', () => {
  const r = run('--tarball', tarball('1.0.0'), '--expect', 'next');
  assert.equal(r.status, 1);
  assert.match(r.out, /release-dist-tag: refused: 1\.0\.0 inside .*package\.tgz goes to latest, not to "next"/);
});

test('the two right pairs pass: a prerelease with next, a plain version with latest', () => {
  const pre = run('--tarball', tarball('1.0.0-rc.1'), '--expect', 'next');
  assert.equal(pre.status, 0, pre.out);
  assert.match(pre.out, /release-dist-tag: ok 1\.0\.0-rc\.1 goes to next/);
  const plain = run('--tarball', tarball('0.8.0'), '--expect', 'latest');
  assert.equal(plain.status, 0, plain.out);
  assert.match(plain.out, /release-dist-tag: ok 0\.8\.0 goes to latest/);
});

test('an empty --expect (a missing step output) is refused', () => {
  const r = run('--tarball', tarball('0.8.0'), '--expect', '');
  assert.equal(r.status, 1);
  assert.match(r.out, /release-dist-tag: refused: 0\.8\.0 inside .* goes to latest, not to ""/);
});

test('without --expect it prints the dist-tag and writes it to GITHUB_OUTPUT', () => {
  const pre = run('--tarball', tarball('1.0.0-beta'));
  assert.equal(pre.status, 0, pre.out);
  assert.equal(pre.out, 'dist-tag=next\n');
  assert.equal(pre.output, 'dist-tag=next\n');
  const plain = run('--tarball', tarball('0.8.0'));
  assert.equal(plain.output, 'dist-tag=latest\n');
});

test('a version the rule refuses gives no dist-tag at all', () => {
  const r = run('--tarball', tarball('1.0.0+abc'));
  assert.equal(r.status, 1);
  assert.match(r.out, /release-dist-tag: refused: the version 1\.0\.0\+abc inside .* is not X\.Y\.Z or X\.Y\.Z-<prerelease>/);
  assert.equal(r.output, '');
});

test('a tarball without package/package.json, or a file that is not gzip, is refused', () => {
  const none = run('--tarball', tarball(null));
  assert.equal(none.status, 1);
  assert.match(none.out, /release-dist-tag: refused: .*package\.tgz holds no package\/package\.json/);
  const plain = join(tmpDir('burhan-dist-tag-'), 'package.tgz');
  writeFileSync(plain, 'not a tarball');
  const bad = run('--tarball', plain);
  assert.equal(bad.status, 1);
  assert.match(bad.out, /release-dist-tag: refused: cannot read .*package\.tgz as a gzip file/);
});

test('a missing --tarball, or --expect with no value, is a usage error', () => {
  const r = run();
  assert.equal(r.status, 1);
  assert.match(r.out, /usage: release-dist-tag --tarball <file> \[--expect latest\|next\]/);
  const e = run('--tarball', tarball('0.8.0'), '--expect');
  assert.equal(e.status, 1);
  assert.match(e.out, /usage: release-dist-tag/);
});

test('a tarball made by npm pack is read the same way', { skip: notOnWindows('npm is spawned through a .cmd shim there; the release runs this on Linux') }, () => {
  const dir = tmpDir('burhan-dist-tag-pkg-');
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'demo-pkg', version: '2.0.0-beta.1' }));
  writeFileSync(join(dir, 'README.md'), 'x');
  const out = tmpDir('burhan-dist-tag-packed-');
  const packed = spawnSync('npm', ['pack', '--pack-destination', out], { cwd: dir, encoding: 'utf8' });
  assert.equal(packed.status, 0, packed.stderr);
  const [file] = readdirSync(out).filter((name) => name.endsWith('.tgz'));
  const r = run('--tarball', join(out, file!));
  assert.equal(r.status, 0, r.out);
  assert.equal(r.out, 'dist-tag=next\n');
});

/** A copy of a tar entry whose header gives `size` as its size field, with the checksum written again. */
function withSize(entry: Buffer, size: string): Buffer {
  const copy = Buffer.from(entry);
  copy.fill(0, 124, 136);
  copy.write(size, 124, 'latin1');
  copy.write('        ', 148);
  let sum = 0;
  for (const byte of copy.subarray(0, 512)) sum += byte;
  copy.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return copy;
}

/** A gzip'd tarball of exactly these entries, then the two zero blocks that end a tar. */
function tarballOf(...entries: Buffer[]): string {
  const file = join(tmpDir('burhan-dist-tag-'), 'package.tgz');
  writeFileSync(file, gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)])));
  return file;
}

const readme = tarEntry('package/README.md', Buffer.from('readme\n'));
const manifest = (version: string): Buffer => tarEntry('package/package.json', Buffer.from(JSON.stringify({ name: 'demo-pkg', version })));

test('a tarball holding package/package.json twice is refused, in either order, and no dist-tag is written', () => {
  for (const versions of [['1.0.0', '1.0.0-rc.1'], ['1.0.0-rc.1', '1.0.0']]) {
    const file = tarballOf(readme, ...versions.map((v) => manifest(v)));
    for (const args of [[], ['--expect', 'latest'], ['--expect', 'next']]) {
      const r = run('--tarball', file, ...args);
      assert.equal(r.status, 1, `${versions.join(' then ')} ${args.join(' ')}: ${r.out}`);
      assert.match(r.out, /release-dist-tag: refused: .*package\.tgz holds package\/package\.json more than once \(npm would publish the last one\)/);
      assert.equal(r.output, '');
    }
  }
});

test('a tar header with a negative or malformed size is refused, and the read ends', () => {
  for (const size of ['-001000', '0000007x']) {
    const output = join(tmpDir('burhan-dist-tag-out-'), 'github-output');
    const file = tarballOf(withSize(readme, size), manifest('1.0.0'));
    const r = spawnSync(process.execPath, [script, '--tarball', file], { encoding: 'utf8', timeout: 10_000, env: { ...process.env, GITHUB_OUTPUT: output } });
    assert.equal(r.status, 1, `size ${size}: ${r.error?.message ?? ''} ${r.stdout}${r.stderr}`);
    assert.match(r.stderr, new RegExp(`release-dist-tag: refused: .*package\\.tgz has a tar header whose size is not an octal number: "${size}"`));
    assert.equal(existsSync(output), false);
  }
});
