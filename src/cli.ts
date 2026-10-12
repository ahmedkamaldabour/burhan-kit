#!/usr/bin/env node
import { runCli } from './main.js';

// Output piped into a reader that closes early (`burhan status | head`): stop quietly, as Unix tools do.
for (const s of [process.stdout, process.stderr])
  s.on('error', (e: NodeJS.ErrnoException) => { if (e.code === 'EPIPE') process.exit(process.exitCode ?? 0); throw e; });

process.exitCode = await runCli(process.argv.slice(2), {
  stdout: (s) => process.stdout.write(s),
  stderr: (s) => process.stderr.write(s),
  cwd: process.cwd(),
});
