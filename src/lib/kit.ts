import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The package root: the nearest ancestor of this module holding package.json and kit/WORKFLOW.md
 *  (works from dist/ and from .test-build/src/ alike). */
export function packageRoot(): string {
  let d = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    if (existsSync(join(d, 'package.json')) && existsSync(join(d, 'kit', 'WORKFLOW.md'))) return d;
    const up = dirname(d);
    if (up === d) throw new Error('cannot locate the kit (package.json + kit/WORKFLOW.md)');
    d = up;
  }
}

export const kitDir = (): string => join(packageRoot(), 'kit');

export const readVersion = (): string =>
  (JSON.parse(readFileSync(join(packageRoot(), 'package.json'), 'utf8')) as { version: string }).version;

/** The built Node hooks the CLI ships next to itself: `dist/hooks` in the package, `.test-build/src/hooks` under test
 *  (main.mjs, core/, adapters/, install-root.mjs, gates.txt). `init` and `upgrade` copy them to `.burhan/hooks/node/`. */
export const nodeHooksDir = (): string => join(dirname(fileURLToPath(import.meta.url)), '..', 'hooks');
