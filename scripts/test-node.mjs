import { spawn } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { cpus, freemem } from 'node:os';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const MEBIBYTE = 1024 * 1024;

export function jobsFor({ freeBytes, cpus: cpuCount, env }) {
  const override = env.BURHAN_TEST_JOBS;
  if (override !== undefined) {
    if (!/^[1-9]\d*$/.test(override)) {
      throw new Error('BURHAN_TEST_JOBS must be a positive integer');
    }
    return Number(override);
  }

  return Math.max(1, Math.min(Math.floor(freeBytes * 0.5 / (256 * MEBIBYTE)), cpuCount - 1));
}

/** Ends this process the way the child ended: the same exit code, or the same signal re-raised. */
export function finish(code, signal, proc = process) {
  if (signal) proc.kill(proc.pid, signal);
  else proc.exit(code ?? 1);
}

function testFiles() {
  const root = '.test-build/test';
  const files = [];

  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile() && entry.name.endsWith('.test.js')) files.push(relative('.', file));
    }
  }

  visit(root);
  return files;
}

function main() {
  const jobs = jobsFor({ freeBytes: freemem(), cpus: cpus().length, env: process.env });
  const files = process.argv.slice(2);
  const selectedFiles = files.length > 0 ? files : testFiles();

  console.log(`node tests: ${jobs} at a time`);
  const child = spawn(process.execPath, ['--test', `--test-concurrency=${jobs}`, ...selectedFiles], {
    stdio: 'inherit',
  });
  child.on('error', (error) => {
    throw error;
  });
  child.on('exit', (code, signal) => finish(code, signal));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
