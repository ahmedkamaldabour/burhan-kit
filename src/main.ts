import { parseArgs } from 'node:util';
import { BurhanError } from './lib/errors.js';
import { install, parseAgents } from './lib/install.js';
import { readVersion } from './lib/kit.js';
import { changed } from './lib/changed.js';
import { uninstall } from './lib/uninstall.js';
import { doctor } from './lib/doctor.js';
import { prBody } from './lib/pr-body.js';
import { evidence } from './lib/evidence.js';
import { stats } from './lib/stats.js';
import { status } from './lib/status.js';
import { homedir } from 'node:os';
import { clackPrompter, numberedPrompter, withFallback } from './lib/setup/prompter.js';
import { runWizard } from './lib/setup/wizard.js';
import { agentInstructions, runAnswers } from './lib/setup/agent.js';
import { messages } from './lib/setup/messages.js';
import { parseSetArgs, setStack, stackInstructions } from './lib/setup/stack.js';
import type { SetupFilesystem } from './lib/setup/engine.js';

const FORBIDDEN_SETUP_FLAG_PAIRS = [
  ['agent', 'answers'],
  ['agent', 'apply'],
  ['agent', 'set'],
  ['agent', 'stack'],
  ['stack', 'set'],
  ['stack', 'answers'],
] as const;

const SETUP_FLAG_NAMES = {
  agent: '--agent', answers: '--answers', apply: '--apply', set: '--set', stack: '--stack',
} as const;

export interface Io { stdout(s: string): void; stderr(s: string): void; cwd: string; /** stdin and stdout are both terminals: only then may a prompt be shown. */ interactive?: boolean }

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
  setup [dir] [--lang en|ar]
                       guided setup in a terminal (also: no command at all); shows a summary before writing anything
  setup [dir] --agent [--lang en|ar]
                       print the questions and rules for an AI agent to ask, with the recommended answers
  setup [dir] --answers <file> [--apply]
                       show (or, with --apply, write) the setup for the answers in a JSON file
  setup [dir] --stack  print the first-use instructions for an AI agent
  setup [dir] --set check=<cmd|none> [never-run=<a;b> | never-run-regex=<ERE>] [sensitive=<p;q>] [--force]
                       save the project's check command (runs it once first)
  uninstall [dir] [--apply] [--all]
                       remove burhan from a project; keeps workflow.config, bindings.md, local/ and your work files unless --all
  doctor [dir]         read-only health check: runtime, install, config, hook wiring, state (exit 1 on a fail)
  --version | --help

Without --apply, init, upgrade and uninstall are a dry run: they print what they would do and change nothing.
`;

export async function runCli(argv: string[], io: Io, setupFilesystem?: SetupFilesystem): Promise<number> {
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
      case 'uninstall': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { apply: { type: 'boolean' }, all: { type: 'boolean' } },
        });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return uninstall({ target: positionals[0] ?? io.cwd, apply: values.apply === true, all: values.all === true }, io);
      }
      case 'doctor': {
        const { positionals } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: {} });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return doctor({ target: positionals[0] ?? io.cwd }, io);
      }
      case 'setup': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { lang: { type: 'string' }, stack: { type: 'boolean' }, set: { type: 'boolean' }, force: { type: 'boolean' }, agent: { type: 'boolean' }, answers: { type: 'string' }, apply: { type: 'boolean' } },
        });
        const lang = values.lang ?? 'en';
        if (lang !== 'en' && lang !== 'ar') throw new BurhanError(`--lang must be en or ar, not "${lang}"`);
        const setupFlags = {
          agent: values.agent === true,
          answers: values.answers !== undefined,
          apply: values.apply === true,
          set: values.set === true,
          stack: values.stack === true,
        };
        for (const [first, second] of FORBIDDEN_SETUP_FLAG_PAIRS) {
          if (setupFlags[first] && setupFlags[second]) {
            throw new BurhanError(messages(lang).agent.conflictingFlags(SETUP_FLAG_NAMES[first], SETUP_FLAG_NAMES[second]));
          }
        }
        // With --set the KEY=VALUE pairs are the positionals that contain "="; a quoted `check=npm test` stays one argument.
        const pairs = values.set ? positionals.filter((x) => x.includes('=')) : [];
        const dirs = positionals.filter((x) => !pairs.includes(x));
        if (dirs.length > 1) throw new BurhanError(`unexpected argument: ${dirs[1]}`);
        const target = dirs[0] ?? io.cwd;
        if (values.agent) { io.stdout(agentInstructions(target, lang, homedir())); return 0; }
        if (values.answers !== undefined) return runAnswers(target, values.answers, values.apply === true, io, lang, homedir(), setupFilesystem);
        if (values.apply) throw new BurhanError('--apply needs --answers <file>');
        if (values.stack) { io.stdout(stackInstructions(lang) + '\n'); return 0; }
        if (values.set) return await setStack(target, parseSetArgs(pairs), { force: values.force === true }, io);
        return await setupWizard(target, io, lang);
      }
      case '--version': case '-v':
        io.stdout(readVersion() + '\n'); return 0;
      case '--help': case '-h': case 'help':
        io.stdout(USAGE); return 0;
      case undefined:
        if (io.interactive) return await setupWizard(io.cwd, io, 'en');
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

/** The terminal wizard: clack when it loads, numbered lists when it does not or breaks mid-way (AC-08). */
async function setupWizard(target: string, io: Io, lang: 'en' | 'ar'): Promise<number> {
  if (!io.interactive) { io.stderr(messages(lang).wizard.terminalOnly + '\n'); return 2; }
  const numbered = (): ReturnType<typeof numberedPrompter> => numberedPrompter(process.stdin, process.stdout);
  const clack = await clackPrompter();
  const p = clack ? withFallback(clack, numbered) : numbered();
  try { return await runWizard(target, io, p, lang, homedir()); }
  finally { p.close?.(); }
}
