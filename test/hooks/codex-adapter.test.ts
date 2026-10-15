import { test } from 'node:test';
import { nodeDriver } from './drivers.js';
import { runCorpus } from './corpora/codex-adapter.js';

test('Codex adapter: every golden case equals the bash adapter', () => runCorpus(nodeDriver));
