// The npm dist-tag of the tarball the release workflow is about to publish, from the version inside that tarball
// (release-rules.mjs: `next` for a prerelease, `latest` for X.Y.Z).
//   node scripts/release-dist-tag.mjs --tarball <file>                         prints dist-tag=<tag>, and appends it to $GITHUB_OUTPUT
//   node scripts/release-dist-tag.mjs --tarball <file> --expect latest|next   exits 1 unless that is the tarball's dist-tag
// Any refusal prints `release-dist-tag: refused: <reason>` and exits 1.
import { appendFileSync, readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { distTagFor } from './release-rules.mjs';

const argv = process.argv.slice(2);
const option = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined; };
const tarball = option('--tarball');
const expect = option('--expect');
if (!tarball || tarball.startsWith('-') || (argv.includes('--expect') && (expect === undefined || expect.startsWith('-')))) {
  console.error('usage: release-dist-tag --tarball <file> [--expect latest|next]');
  process.exit(1);
}

const refuse = (reason) => {
  console.error(`release-dist-tag: refused: ${reason}`);
  process.exit(1);
};

/** The `version` of the one package/package.json inside a gzip'd tar, read with no dependency: 512-byte ustar headers. Every header is
 *  read to the end of the tar: npm publishes the last entry of a name, so a second package/package.json is refused, and so is a size
 *  field that is not an octal number (a negative one would keep the walk on the same header). */
function tarballVersion(file) {
  let data;
  try {
    data = gunzipSync(readFileSync(file));
  } catch (error) {
    return refuse(`cannot read ${file} as a gzip file (${error.message.split('\n')[0]})`);
  }
  const field = (header, start, length) => header.subarray(start, start + length).toString('utf8').replace(/\0.*$/s, '');
  let manifest = null;
  for (let at = 0; at + 512 <= data.length;) {
    const header = data.subarray(at, at + 512);
    const name = field(header, 0, 100);
    if (name === '') break;
    const prefix = field(header, 345, 155);
    const sizeField = field(header, 124, 12).trim();
    if (!/^[0-7]+$/.test(sizeField)) return refuse(`${file} has a tar header whose size is not an octal number: ${JSON.stringify(sizeField)}`);
    const size = parseInt(sizeField, 8);
    const type = field(header, 156, 1);
    if ((prefix ? `${prefix}/${name}` : name) === 'package/package.json') {
      if (manifest !== null) return refuse(`${file} holds package/package.json more than once (npm would publish the last one)`);
      manifest = { type, body: data.subarray(at + 512, at + 512 + size) };
    }
    at += 512 + Math.ceil(size / 512) * 512;
  }
  if (manifest === null || !(manifest.type === '0' || manifest.type === '')) return refuse(`${file} holds no package/package.json`);
  try {
    return JSON.parse(manifest.body.toString('utf8')).version;
  } catch {
    return refuse(`package/package.json in ${file} is not JSON`);
  }
}

const version = tarballVersion(tarball);
const distTag = distTagFor(version);
if (!distTag) refuse(`the version ${version} inside ${tarball} is not X.Y.Z or X.Y.Z-<prerelease>`);

if (expect !== undefined) {
  if (expect !== distTag) refuse(`${version} inside ${tarball} goes to ${distTag}, not to ${JSON.stringify(expect)}`);
  console.log(`release-dist-tag: ok ${version} goes to ${distTag}`);
} else {
  console.log(`dist-tag=${distTag}`);
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `dist-tag=${distTag}\n`);
}
