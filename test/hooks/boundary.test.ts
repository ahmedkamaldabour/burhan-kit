import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { packageRoot } from '../../src/lib/kit.js';

// dist/hooks/ is copied into projects as is: it may import only node: built-ins and its own files.
test('src/hooks imports only node: built-ins and files inside src/hooks', () => {
  const root = join(packageRoot(), 'src/hooks');
  const files: string[] = [];
  const walk = (d: string): void => { for (const e of readdirSync(d, { withFileTypes: true })) e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.mts') && files.push(join(d, e.name)); };
  walk(root);
  assert.ok(files.length > 0, 'no .mts files found');
  const bad: string[] = [];
  for (const f of files) {
    for (const m of readFileSync(f, 'utf8').matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
      const spec = m[1];
      if (spec.startsWith('node:')) continue;
      if (spec.startsWith('.') && !relative(root, resolve(dirname(f), spec)).startsWith('..')) continue;
      bad.push(`${relative(root, f)}: ${spec}`);
    }
  }
  assert.deepEqual(bad, []);
});
