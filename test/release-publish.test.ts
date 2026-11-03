import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Tests run from .test-build/test, so the repository root is two levels up.
const root = fileURLToPath(new URL('../../', import.meta.url));
const folder = join(root, '.github', 'workflows');
const workflows = readdirSync(folder).filter((name) => /\.ya?ml$/.test(name)).map((name) => [name, readFileSync(join(folder, name), 'utf8')] as const);
const release = readFileSync(join(folder, 'release.yml'), 'utf8');

/** The text of one top-level job of the release workflow (from `  <name>:` to the next job or the end). */
function job(name: string): string {
  const lines = release.split('\n');
  const start = lines.findIndex((l) => l === `  ${name}:`);
  assert.notEqual(start, -1, `release.yml has no "${name}" job`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => /^  [A-Za-z0-9_-]+:/.test(l));
  return rest.slice(0, end === -1 ? undefined : end).join('\n');
}

/**
 * The lines of a workflow that could publish a package: each line, not a comment, that holds `publish` in any case (npm
 * with any spacing, pnpm, yarn, yarn npm, bun, npx, a publish action, a command continued on the next line) or a word
 * npm reads as publish (`pu`, `pub`, `publ`, `publi`, `publis`), except the lines that only name the publish job: its
 * head, the `needs:` that waits for it, and a step's name.
 */
function publishLines(text: string): string[] {
  return text.split('\n').filter((l) => !/^\s*#/.test(l) && /publish|\bpu(?:b(?:l(?:i(?:s)?)?)?)?\b/i.test(l)
    && !/^ {2}publish:$/.test(l) && !/^ {4}needs: publish$/.test(l) && !/^ +- name: [^{}[\]]*$/.test(l));
}

test('the workflows hold exactly one npm publish: the packed tarball, with provenance, public, and --tag from an env value', () => {
  const lines = workflows.flatMap(([name, text]) => publishLines(text).map((l) => `${name}: ${l}`));
  assert.equal(lines.length, 1, lines.join('\n'));
  assert.match(lines[0]!, /^release\.yml:\s+run: npm publish \.\/pack\/package\.tgz --provenance --access public --tag "\$DIST_TAG"$/);
  assert.doesNotMatch(lines[0]!, /\$\{\{/);
});

test('any other publish command in a workflow is counted too, so a second publisher fails the one-publish test', () => {
  const others = [
    '        run: npm  publish ./pack/package.tgz',
    '        run: pnpm publish --no-git-checks',
    '        run: yarn publish',
    '        run: yarn npm publish',
    '        run: bun publish',
    '        run: npx npm@11 publish ./pack/package.tgz',
    '        run: npm pu ./pack/package.tgz',
    '        run: npm pub ./pack/package.tgz',
    '        run: NPM PUBLISH',
    '      - uses: JS-DevTools/npm-publish@v3',
    '        run: |\n          npm \\\n            publish ./pack/package.tgz',
  ];
  for (const other of others) assert.equal(publishLines(`${release}${other}\n`).length, 2, other);
});

test('no workflow names a dist-tag as a word, and none sets npm\'s tag through the environment', () => {
  for (const [name, text] of workflows) {
    assert.doesNotMatch(text, /--tag[ =]["']?(latest|next)\b/, name);
    assert.doesNotMatch(text, /npm_config_tag/i, name);
  }
});

test('the publish job takes DIST_TAG from the tarball and checks it again just before npm publish', () => {
  const p = job('publish');
  const find = (text: string): number => {
    const at = p.indexOf(text);
    assert.notEqual(at, -1, `publish has no "${text}"`);
    return at;
  };
  const checkout = find('uses: actions/checkout@');
  const download = find('uses: actions/download-artifact@');
  const compute = find('run: node scripts/release-dist-tag.mjs --tarball ./pack/package.tgz\n');
  const check = find('run: node scripts/release-dist-tag.mjs --tarball ./pack/package.tgz --expect "$DIST_TAG"');
  const publish = find('run: npm publish ');
  assert.ok(checkout < download, 'the checkout comes first, so it cannot clean away the downloaded tarball');
  assert.ok(download < compute && compute < check && check < publish, 'download, dist-tag, check, publish');
  assert.match(p, /id: dist-tag\n\s+run: node scripts\/release-dist-tag\.mjs --tarball \.\/pack\/package\.tgz\n/);
  const envLines = p.split('\n').filter((l) => l.includes('DIST_TAG:'));
  assert.equal(envLines.length, 2);
  for (const line of envLines) assert.match(line, /^\s+DIST_TAG: \$\{\{ steps\.dist-tag\.outputs\.dist-tag \}\}$/);
});

test('nothing outside the workflow can set the dist-tag: no publishConfig.tag, no tag in a root .npmrc', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { publishConfig?: { tag?: string } };
  assert.equal(pkg.publishConfig?.tag, undefined);
  const npmrc = join(root, '.npmrc');
  if (existsSync(npmrc)) assert.doesNotMatch(readFileSync(npmrc, 'utf8'), /^\s*tag\s*=/m);
});
