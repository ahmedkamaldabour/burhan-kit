import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { runCli, USAGE } from '../src/main.js';
import { capture, tmpDir } from './helpers.js';

/** Every command the CLI knows: each answers --help and -h with its own entries of the top-level usage. */
const COMMANDS = ['init', 'upgrade', 'status', 'stats', 'changed', 'evidence', 'pr-body', 'setup', 'uninstall', 'inspect', 'memory', 'doctor', 'use', 'item', 'gate', 'state', 'guide', 'verify', 'review', 'approve', 'deviation', 'finding'];
const SUBCOMMANDS: Record<string, string[]> = {
  item: ['check', 'new', 'set', 'finish', 'list', 'close'], state: ['compact', 'show', 'set', 'close'], deviation: ['add', 'resolve'],
  finding: ['add', 'list', 'decide', 'discover'], review: ['add'], gate: ['tick'], memory: ['check', 'status', 'affected'],
};
const usageLines = USAGE.split('\n');
/** The first line of each entry of a command (or of one subcommand), read from the top-level usage itself. */
const heads = (command: string, sub?: string): string[] => usageLines.filter((l) => (sub === undefined ? l === `  ${command}` || l.startsWith(`  ${command} `) : l === `  ${command} ${sub}` || l.startsWith(`  ${command} ${sub} `)));
const printed = (out: string): string[] => out.split('\n').slice(0, -1);
const firsts = (lines: string[]): string[] => lines.filter((l) => /^ {2}\S/.test(l));

async function run(args: string[]): Promise<{ code: number; out: string; err: string; before: string[]; after: string[] }> {
  const dir = tmpDir('burhan-help-');
  const before = readdirSync(dir);
  const c = capture(dir);
  const code = await runCli(args, c.io);
  return { code, ...c.o, before, after: readdirSync(dir) };
}

test('every command answers --help and -h with its own usage lines and nothing else', async () => {
  for (const command of COMMANDS) {
    for (const flag of ['--help', '-h']) {
      const r = await run([command, flag]);
      assert.equal(r.code, 0, `${command} ${flag}: ${r.err}`);
      assert.equal(r.err, '', `${command} ${flag} wrote to stderr`);
      assert.ok(r.out.endsWith('\n'), `${command} ${flag}`);
      const lines = printed(r.out);
      for (const l of lines) assert.ok(usageLines.includes(l), `${command} ${flag}: "${l}" is not a line of the top-level usage`);
      assert.deepEqual(firsts(lines), heads(command), `${command} ${flag}: the entries of the command`);
      assert.deepEqual(r.after, r.before, `${command} ${flag} wrote a file`);
    }
  }
});

test('a command with subcommands answers <command> <sub> --help with that subcommand only', async () => {
  for (const [command, subs] of Object.entries(SUBCOMMANDS)) {
    for (const sub of subs) {
      const r = await run([command, sub, '--help']);
      assert.equal(r.code, 0, `${command} ${sub}: ${r.err}`);
      assert.equal(r.err, '', `${command} ${sub}`);
      const lines = printed(r.out);
      for (const l of lines) assert.ok(usageLines.includes(l), `${command} ${sub}: "${l}"`);
      assert.deepEqual(firsts(lines), heads(command, sub), `${command} ${sub}`);
    }
  }
});

test('the flag may follow the subcommand arguments', async () => {
  for (const [args, command, sub] of [[['item', 'set', 'foo', '--help'], 'item', 'set'], [['state', 'set', 'alpha', 'Next action', '--help'], 'state', 'set'], [['finding', 'decide', 'foo', '1', '-h'], 'finding', 'decide']] as const) {
    const r = await run([...args]);
    assert.equal(r.code, 0, `${args.join(' ')}: ${r.err}`);
    assert.deepEqual(firsts(printed(r.out)), heads(command, sub), args.join(' '));
  }
});

test('--help after -- belongs to the command that verify runs, and an unknown command stays unknown', async () => {
  const a = await run(['verify', 'foo', '--', process.execPath, '--help']);
  assert.equal(a.code, 2);
  assert.match(a.err, /has no folder/);
  assert.equal(a.out, '');
  const b = await run(['frobnicate', '--help']);
  assert.equal(b.code, 2);
  assert.match(b.err, /unknown command: frobnicate/);
  const c = await run(['--help']);
  assert.equal(c.code, 0);
  assert.equal(c.out, USAGE);
});

test('an option value before the subcommand does not hide the subcommand: `state --docs d show --help` prints `state show` only', async () => {
  const r = await run(['state', '--docs', 'd', 'show', '--help']);
  assert.equal(r.code, 0, r.err);
  assert.deepEqual(firsts(printed(r.out)), heads('state', 'show'));
});
