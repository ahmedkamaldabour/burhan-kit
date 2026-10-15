import { test } from 'node:test';
import { nodeDriver } from './drivers.js';
import { runCorpus } from './corpora/turn-audit.js';

test('turnAudit: Bash-generated gates A–I and session-link corpora', () => runCorpus(nodeDriver));
