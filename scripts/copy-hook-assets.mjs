#!/usr/bin/env node
// Build step: the Node hooks read gates.txt next to main.mjs, and `burhan init` keeps the entries it installed
// (snippets/<agent>.snippet.json) in the project so a later release can still recognise them as ours.
//   node scripts/copy-hook-assets.mjs <hooks output dir>   (dist/hooks, or .test-build/src/hooks)
import { copyFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = process.argv[2];
if (!out) { console.error('usage: copy-hook-assets.mjs <hooks output dir>'); process.exit(2); }
mkdirSync(join(out, 'snippets'), { recursive: true });
copyFileSync(join(root, 'kit/hooks/core/gates.txt'), join(out, 'gates.txt'));
copyFileSync(join(root, 'kit/hooks/adapters/claude/settings.node.snippet.json'), join(out, 'snippets/claude.snippet.json'));
copyFileSync(join(root, 'kit/hooks/adapters/codex/hooks.node.snippet.json'), join(out, 'snippets/codex.snippet.json'));
