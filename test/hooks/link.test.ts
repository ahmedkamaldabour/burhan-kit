import assert from 'node:assert/strict';
import { test } from 'node:test';
import { explicitLink } from '../../src/hooks/core/link.mjs';

/* Planned link.mts API (the turn-audit.sh awk command-position tokenizer):
 * explicitLink(cmds: string[]): string -> the last qualifying `burhan use <safe-slug>` invocation, or ''.
 */

test('explicitLink accepts every Bash command shape and takes the last invocation', () => {
  assert.equal(explicitLink(['burhan use alpha', 'burhan-kit use beta', 'npx burhan-kit use gamma', 'node ./kit/cli.js use delta',
    'ASSIGN=value burhan use epsilon', 'echo nope && burhan use zeta', 'false || burhan use eta', 'true; burhan use theta',
    'printf x | burhan use iota', '( burhan use kappa']), 'kappa');
});

test('explicitLink rejects quoted, argument-shaped, and non-cli look-alikes', () => {
  for (const cmd of ["echo 'burhan use alpha'", 'grep "burhan use alpha" README.md', 'echo burhan use alpha', 'burhan use',
    'burhan use alpha extra', 'npx other use alpha', 'node ./kit/not-cli.js use alpha']) assert.equal(explicitLink([cmd]), '', cmd);
});
