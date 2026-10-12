import { parseArgs } from 'node:util';
import { BurhanError } from './lib/errors.js';
import { install, parseAgents } from './lib/install.js';
import { readVersion } from './lib/kit.js';
import { changed } from './lib/changed.js';
import { doctor } from './lib/doctor.js';
import { prBody } from './lib/pr-body.js';
import { evidence } from './lib/evidence.js';
import { stats } from './lib/stats.js';
import { status } from './lib/status.js';

export interface Io { stdout(s: string): void; stderr(s: string): void; cwd: string }

export const USAGE = `usage: burhan <command> [options]

  init [dir] --agents claude[,codex] [--apply] [--no-bootstrap]
                       install the kit into a project (dir defaults to the current directory)
  upgrade [dir] [--agents …] [--apply] [--no-bootstrap]
                       refresh an installed project (agents default to the installed ones)
  status [dir] [--write] [--force] [--docs <path>]
                       list work items; --write regenerates <docs>/README.md
  stats [dir] [--docs <path>] [--json]
                       routes, QC verdicts, self vs independent QC, escaped defects, phase timing, evidence
  changed [dir] --item <slug> [--docs <path>] [--json]
                       files changed since the commit the story was verified at (re-check only those)
  evidence [dir] [--item <slug>] [--session <id>] [--last N] [--json]
                       the evidence ledger: every command with its exit code, in order, per turn
  pr-body [dir] --item <slug> [--docs <path>]
                       a pull-request description from the item's files (read-only; for gh pr create --body-file)
  doctor [dir]         read-only health check: runtime, install, config, hook wiring, state (exit 1 on a fail)
  --version | --help

Without --apply, init and upgrade are a dry run: they print what they would do and change nothing.
`;

export async function runCli(argv: string[], io: Io): Promise<number> {
  const [cmd, ...rest] = argv;
  try {
    switch (cmd) {
      case 'init': case 'upgrade': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { agents: { type: 'string' }, apply: { type: 'boolean' }, 'no-bootstrap': { type: 'boolean' } },
        });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        if (cmd === 'init' && values.agents === undefined) { io.stderr('burhan: init needs --agents claude[,codex]\n'); io.stdout(USAGE); return 2; }
        return install({
          mode: cmd, target: positionals[0] ?? io.cwd,
          agents: values.agents === undefined ? null : parseAgents(values.agents),
          apply: values.apply === true, bootstrap: values['no-bootstrap'] !== true,
        }, io);
      }
      case 'status': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { write: { type: 'boolean' }, force: { type: 'boolean' }, docs: { type: 'string' } },
        });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return status({ target: positionals[0] ?? io.cwd, write: values.write === true, force: values.force === true, docs: values.docs }, io);
      }
      case 'changed': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { item: { type: 'string' }, docs: { type: 'string' }, json: { type: 'boolean' } },
        });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return changed({ target: positionals[0] ?? io.cwd, item: values.item, docs: values.docs, json: values.json === true }, io);
      }
      case 'evidence': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { item: { type: 'string' }, session: { type: 'string' }, last: { type: 'string' }, json: { type: 'boolean' } },
        });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return evidence({ target: positionals[0] ?? io.cwd, item: values.item, session: values.session, last: values.last, json: values.json === true }, io);
      }
      case 'stats': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { docs: { type: 'string' }, json: { type: 'boolean' } },
        });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return stats({ target: positionals[0] ?? io.cwd, docs: values.docs, json: values.json === true }, io);
      }
      case 'pr-body': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { item: { type: 'string' }, docs: { type: 'string' } },
        });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return prBody({ target: positionals[0] ?? io.cwd, item: values.item, docs: values.docs }, io);
      }
      case 'doctor': {
        const { positionals } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: {} });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return doctor({ target: positionals[0] ?? io.cwd }, io);
      }
      case '--version': case '-v':
        io.stdout(readVersion() + '\n'); return 0;
      case '--help': case '-h': case 'help':
        io.stdout(USAGE); return 0;
      case undefined:
        io.stdout(USAGE); return 2;
      default:
        io.stderr(`burhan: unknown command: ${cmd}\n`); io.stdout(USAGE); return 2;
    }
  } catch (e) {
    const code = (e as { code?: string }).code ?? '';
    if (e instanceof BurhanError || code.startsWith('ERR_PARSE_ARGS')) { io.stderr(`burhan: ${(e as Error).message}\n`); return 2; }
    throw e;
  }
}
