import { parseArgs } from 'node:util';
import { BurhanError } from './lib/errors.js';
import { install, parseAgents } from './lib/install.js';
import { readVersion } from './lib/kit.js';
import { changed } from './lib/changed.js';
import { uninstall } from './lib/uninstall.js';
import { doctor } from './lib/doctor.js';
import { prBody } from './lib/pr-body.js';
import { evidence, projectRoot } from './lib/evidence.js';
import { findProject } from './lib/find-project.js';
import { fullRunFor, fullRunLine } from './lib/full-run.js';
import { stats } from './lib/stats.js';
import { status } from './lib/status.js';
import { useItem } from './lib/use.js';
import { itemCheck } from './lib/item-check.js';
import { itemNew } from './lib/item-new.js';
import { itemSet } from './lib/item-set.js';
import { gateTick } from './lib/gate-tick.js';
import { stateCompact } from './lib/state-compact.js';
import { reviewAdd } from './lib/review-add.js';
import { approve } from './lib/approve.js';
import { deviationAdd, deviationResolve } from './lib/deviation.js';
import { findingAdd, findingDecide, findingDiscover, findingList } from './lib/finding.js';
import { itemFinish } from './lib/item-finish.js';
import { itemRecordsQuiet, verify } from './lib/verify.js';
import { guide } from './lib/guide.js';
import { printAdvice } from './lib/skill-advice.js';
import { memoryAffected, memoryCheck, memoryStatus } from './lib/memory.js';
import { inspectCommand } from './lib/inspect.js';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { statSync } from 'node:fs';
import { clackPrompter, numberedPrompter, withFallback } from './lib/setup/prompter.js';
import { runWizard } from './lib/setup/wizard.js';
import { agentInstructions, runAnswers } from './lib/setup/agent.js';
import { messages } from './lib/setup/messages.js';
import { parseSetArgs, setStack, stackInstructions } from './lib/setup/stack.js';
import type { SetupFilesystem } from './lib/setup/engine.js';

const CONFLICTING_SETUP_FLAG_PAIRS = [
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

const isDir = (p: string): boolean => { try { return statSync(p).isDirectory(); } catch { return false; } };

export interface Io { stdout(s: string): void; stderr(s: string): void; cwd: string; /** stdin and stdout are both terminals: only then may a prompt be shown. */ interactive?: boolean }

export const USAGE = `usage: burhan <command> [options]

  init [dir] --agents claude[,codex] [--apply] [--no-bootstrap] [--allow-outside-links]
                       install the kit into a project (dir defaults to the current directory)
  upgrade [dir] [--agents …] [--apply] [--no-bootstrap] [--allow-outside-links]
                       refresh an installed project (agents default to the installed ones)
  status [dir] [--write] [--force] [--docs <path>]
                       list work items; --write regenerates <docs>/README.md
  stats [dir] [--docs <path>] [--json]
                       routes, QC verdicts, self vs independent QC, escaped defects, phase timing, evidence
  changed [dir] --item <slug> [--docs <path>] [--json]
                       files changed since the commit the story was verified at (re-check only those)
  evidence [dir] [--item <slug>] [--session <id>] [--last N] [--json]
                       the evidence ledger: every command with its exit code, in order, per turn (with --item: ends with the full run line)
  pr-body [dir] --item <slug> [--docs <path>]
                       a pull-request description from the item's files (read-only; for gh pr create --body-file)
  setup [dir] [--lang en|ar] [--allow-outside-links]
                       guided setup in a terminal (also: no command at all); shows a summary before writing anything
  setup [dir] --agent [--lang en|ar]
                       print the questions and rules for an AI agent to ask, with the recommended answers
  setup [dir] --answers <file> [--apply] [--allow-outside-links]
                       show (or, with --apply, write) the setup for the answers in a JSON file
  setup [dir] --stack  print the first-use instructions for an AI agent
  setup [dir] --set check=<cmd|none> [code=<re>] [test=<re>] [evidence=<re>] [sensitive=<p;q>] [--force] [--allow-outside-links]
                       save the project's check command (runs it once first) and, if given, what counts as code, tests and proof
  uninstall [dir] [--apply] [--all]
                       remove burhan from a project; keeps workflow.config, bindings.md, local/ and your work files unless --all
  inspect [dir] [--json]
                       read-only, bounded look at the tree (names only, no LLM): brownfield or greenfield, the important files
  memory check [dir]   read-only check of the project memory (.burhan/PROJECT.md, .burhan/context/): fact shape,
                       duplicate IDs, one state per ID, merge markers, secret-looking text (exit 1 on a fail)
  memory status [dir]  each fact fresh / changed / missing / unchecked, from the evidence hashes (no Git needed);
                       changed does not mean false
  memory affected [dir] --since <ref>
                       the facts whose evidence files changed since <ref> (needs Git)
  doctor [dir]         read-only health check: runtime, install, config, hook wiring, state (exit 1 on a fail)
  use <slug>           validate an in-Now item; the turn-end hook links this session
  item new <slug> --type <t> --scope <s> [--docs <path>]
                       create an item's files from the templates (by route), with **Contract:** 1, and its block in Now
  item set <slug> plan <status> [--reopen <why>] | unit <N> <status> | findings concluded
                       move a plan or sub-unit status one step along its ladder (Reviewed needs a review section; Approved is set by approve;
                       --reopen reopens a Completed plan whose QC passed and records why)
  gate tick <slug> <gate> [--evidence <text>]
                       tick a gate of the plan's checklist when its evidence exists (or is given)
  state compact [--apply]
                       shorten the closed items' old lines in the state file: a dry run unless --apply; never touches a "### " block; the old text goes to the item's <slug>-state-notes.md first
  guide [slug] [--json]
                       the item's stage, whether code edits are authorized now, the process skill to run (with WF_SKILLS=superpowers), the next step, and whether a passing full run exists after the last code edit
  verify <slug> [--docs <path>] -- <command> [args]
                       run a proof command without a shell, show how it ended, and record it in the item's folder (command, exit code, time, code state)
  item finish <slug> [--evidence <text>]
                       complete the plan: every sub-unit Reviewed, every gate the route needs ticked, a proof (a burhan verify record on the current code state, or the hook ledger)
  review add <slug> --kind review|qc|verification --by <who> [--unit N] [--verdict V] [--round N] [--text T]
                       write a review section or report with Performed by in the exact form
  approve story|plan|qc <slug> --by <name>
                       write an approval in the exact form and tick its gate (the approval is a person's)
  deviation add <slug> --unit N --what <t> --where <w> --output <o> [--apply "<why no decision is needed>"]
                       record a step that did not go as the build spec said: the executor stops until the owner decides; with --apply the row is applied at once (a problem that needs no decision: the agent fixes it and reports it)
  deviation resolve <slug> <n> --approved|--rejected --by <name> [--decision <t>]
                       write the owner's decision on an open deviation (the decision is a person's)
  finding add <slug> --in review:<unit>|qc[:<round>] (--severity <S> --text <t> | --none)
                       add one finding to a review section or QC report (a row of its findings table, with no decision), or write "No findings."
  finding list <slug>  every finding with its decision, and the grouped question for the owner about the ones with none (read-only)
  finding decide <slug> <n> (--fixed unit:<N>|deviation:<n> | --discovery <file> [--outside <why>] | --accepted <reason>) --by <owner name>
                       write the owner's decision on one finding (a person's decision; a Critical is never accepted)
  finding discover <slug> --by <owner name>
                       open a discovery file (and its index line) for every finding with no decision, a Critical excepted, and record each as the decision
  item check <slug> [--docs <path>]
                       check an item's files against the written contract; names every fault (exit 1 only for a file with **Contract:** 1)
  --version | --help

Without --apply, init, upgrade and uninstall are a dry run: they print what they would do and change nothing.
`;

export async function runCli(argv: string[], io: Io, setupFilesystem?: SetupFilesystem): Promise<number> {
  const [cmd, ...rest] = argv;
  let here: string | undefined;
  /** The folder a command works on: the nearest folder at or above `dir` (default: the current one) that holds .burhan/WORKFLOW.md, said on
   *  stderr when it is not that folder; with no install there or above, the folder as given (as before). `init` never calls this. */
  const at = (dir?: string): string => {
    const given = dir ?? io.cwd;
    const start = resolve(io.cwd, given);
    const found = isDir(start) ? findProject(start) : null; // a folder that does not exist, or a file: as given, so the command refuses it as before
    if (found === null || found === start) return (here = given);
    io.stderr(`project: ${found}\n`);
    return (here = found);
  };
  const advise = (code: number, slug: string | undefined, docs: string | undefined, withNext = true): number => { if (code === 0) printAdvice(here ?? io.cwd, slug, io, docs, withNext); return code; };
  try {
    switch (cmd) {
      case 'init': case 'upgrade': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { agents: { type: 'string' }, apply: { type: 'boolean' }, 'no-bootstrap': { type: 'boolean' }, 'allow-outside-links': { type: 'boolean' }, 'allow-outside-settings': { type: 'boolean' } },
        });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        if (cmd === 'init' && values.agents === undefined) { io.stderr('burhan: init needs --agents claude[,codex]\n'); io.stdout(USAGE); return 2; }
        return install({
          mode: cmd, target: cmd === 'init' ? positionals[0] ?? io.cwd : at(positionals[0]),
          agents: values.agents === undefined ? null : parseAgents(values.agents),
          apply: values.apply === true, bootstrap: values['no-bootstrap'] !== true, allowOutsideSettings: values['allow-outside-links'] === true || values['allow-outside-settings'] === true,
        }, io);
      }
      case 'status': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { write: { type: 'boolean' }, force: { type: 'boolean' }, docs: { type: 'string' } },
        });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return status({ target: at(positionals[0]), write: values.write === true, force: values.force === true, docs: values.docs }, io);
      }
      case 'changed': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { item: { type: 'string' }, docs: { type: 'string' }, json: { type: 'boolean' } },
        });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return changed({ target: at(positionals[0]), item: values.item, docs: values.docs, json: values.json === true }, io);
      }
      case 'evidence': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { item: { type: 'string' }, session: { type: 'string' }, last: { type: 'string' }, json: { type: 'boolean' } },
        });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        const target = at(positionals[0]);
        const root = projectRoot(target);
        const records = values.item !== undefined && values.json !== true ? itemRecordsQuiet(root, values.item) : undefined;
        const code = evidence({ target, item: values.item, session: values.session, last: values.last, json: values.json === true, records }, io);
        if (code === 0 && values.item !== undefined && values.json !== true) io.stdout(`${fullRunLine(fullRunFor(root, process.env, { slug: values.item, records }))}\n`);
        return code;
      }
      case 'stats': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { docs: { type: 'string' }, json: { type: 'boolean' } },
        });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return stats({ target: at(positionals[0]), docs: values.docs, json: values.json === true }, io);
      }
      case 'pr-body': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { item: { type: 'string' }, docs: { type: 'string' } },
        });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return prBody({ target: at(positionals[0]), item: values.item, docs: values.docs }, io);
      }
      case 'uninstall': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { apply: { type: 'boolean' }, all: { type: 'boolean' } },
        });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return uninstall({ target: at(positionals[0]), apply: values.apply === true, all: values.all === true }, io);
      }
      case 'doctor': {
        const { positionals } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: {} });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return doctor({ target: at(positionals[0]) }, io);
      }
      case 'inspect': {
        const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: { json: { type: 'boolean' } } });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return inspectCommand(at(positionals[0]), values.json === true, io);
      }
      case 'memory': {
        const [sub, ...args] = rest;
        if (sub !== 'check' && sub !== 'status' && sub !== 'affected') throw new BurhanError(`memory needs a subcommand: check, status or affected${sub === undefined ? '' : ` (not "${sub}")`}`);
        const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: sub === 'affected' ? { since: { type: 'string' } } : {} });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        const dir = at(positionals[0]);
        if (sub === 'status') return memoryStatus(dir, io);
        if (sub === 'affected') return memoryAffected(dir, values.since as string | undefined, io);
        return memoryCheck(dir, io);
      }
      case 'item': {
        const [sub, ...args] = rest;
        if (sub !== 'check' && sub !== 'new' && sub !== 'set' && sub !== 'finish') throw new BurhanError(`item needs a subcommand: check, new, set or finish${sub === undefined ? '' : `, not "${sub}"`}`);
        const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: { docs: { type: 'string' }, ...(sub === 'new' ? { type: { type: 'string' }, scope: { type: 'string' } } : {}), ...(sub === 'finish' ? { evidence: { type: 'string' } } : {}), ...(sub === 'set' ? { reopen: { type: 'string' } } : {}) } });
        if (sub === 'set') return advise(itemSet(at(), positionals[0], positionals.slice(1), io, values.docs, (values as { reopen?: string }).reopen), positionals[0], values.docs);
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        if (sub === 'finish') return advise(itemFinish(at(), positionals[0], io, { evidence: (values as { evidence?: string }).evidence, docs: values.docs }), positionals[0], values.docs, false);
        if (sub === 'new') return advise(itemNew(at(), { slug: positionals[0], type: values.type as string | undefined, scope: values.scope as string | undefined, docs: values.docs }, io), positionals[0], values.docs, false);
        return itemCheck(at(), positionals[0], io, values.docs);
      }
      case 'guide': {
        const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: { docs: { type: 'string' }, json: { type: 'boolean' } } });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return guide(at(), positionals[0], io, { json: values.json === true, docs: values.docs });
      }
      case 'review': {
        const [sub, ...args] = rest;
        if (sub !== 'add') throw new BurhanError(`review needs a subcommand: add${sub === undefined ? '' : `, not "${sub}"`}`);
        const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: { docs: { type: 'string' }, kind: { type: 'string' }, unit: { type: 'string' }, by: { type: 'string' }, verdict: { type: 'string' }, round: { type: 'string' }, text: { type: 'string' } } });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]}`);
        return reviewAdd(at(), positionals[0], values, io);
      }
      case 'approve': {
        const { values, positionals } = parseArgs({ args: rest, allowPositionals: true, strict: true, options: { docs: { type: 'string' }, by: { type: 'string' } } });
        if (positionals.length > 2) throw new BurhanError(`unexpected argument: ${positionals[2]}`);
        return advise(approve(at(), positionals[0], positionals[1], values, io), positionals[1], values.docs);
      }
      case 'deviation': {
        const [sub, ...args] = rest;
        if (sub !== 'add' && sub !== 'resolve') throw new BurhanError(`deviation needs a subcommand: add or resolve${sub === undefined ? '' : `, not "${sub}"`}`);
        const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: { docs: { type: 'string' }, unit: { type: 'string' }, what: { type: 'string' }, where: { type: 'string' }, output: { type: 'string' }, apply: { type: 'string' }, approved: { type: 'boolean' }, rejected: { type: 'boolean' }, by: { type: 'string' }, decision: { type: 'string' } } });
        if (positionals.length > (sub === 'add' ? 1 : 2)) throw new BurhanError(`unexpected argument: ${positionals[sub === 'add' ? 1 : 2]}`);
        return sub === 'add' ? deviationAdd(at(), positionals[0], values, io) : advise(deviationResolve(at(), positionals[0], positionals[1], values, io), positionals[0], values.docs);
      }
      case 'finding': {
        const [sub, ...args] = rest;
        if (sub !== 'add' && sub !== 'list' && sub !== 'decide' && sub !== 'discover') throw new BurhanError(`finding needs a subcommand: add, list, decide or discover${sub === undefined ? '' : `, not "${sub}"`}`);
        const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: { docs: { type: 'string' }, in: { type: 'string' }, severity: { type: 'string' }, text: { type: 'string' }, none: { type: 'boolean' }, by: { type: 'string' }, fixed: { type: 'string' }, discovery: { type: 'string' }, accepted: { type: 'string' }, outside: { type: 'string' } } });
        if (positionals.length > (sub === 'decide' ? 2 : 1)) throw new BurhanError(`unexpected argument: ${positionals[sub === 'decide' ? 2 : 1]}`);
        if (sub === 'add') return findingAdd(at(), positionals[0], values, io);
        if (sub === 'list') return findingList(at(), positionals[0], values, io);
        if (sub === 'discover') return advise(findingDiscover(at(), positionals[0], values, io), positionals[0], values.docs);
        return advise(findingDecide(at(), positionals[0], positionals[1], values, io), positionals[0], values.docs);
      }
      case 'gate': {
        const [sub, ...args] = rest;
        if (sub !== 'tick') throw new BurhanError(`gate needs a subcommand: tick${sub === undefined ? '' : `, not "${sub}"`}`);
        const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: { docs: { type: 'string' }, evidence: { type: 'string' } } });
        if (positionals.length > 2) throw new BurhanError(`unexpected argument: ${positionals[2]}`);
        return gateTick(at(), positionals[0], positionals[1], io, { evidence: values.evidence, docs: values.docs });
      }
      case 'state': {
        const [sub, ...args] = rest;
        if (sub !== 'compact') throw new BurhanError(`state needs a subcommand: compact${sub === undefined ? '' : `, not "${sub}"`}`);
        const { values, positionals } = parseArgs({ args, allowPositionals: true, strict: true, options: { docs: { type: 'string' }, apply: { type: 'boolean' } } });
        if (positionals.length > 0) throw new BurhanError(`unexpected argument: ${positionals[0]}`);
        return stateCompact(at(), io, { apply: values.apply === true, docs: values.docs });
      }
      case 'verify': {
        const cut = rest.indexOf('--');
        const own = cut === -1 ? rest : rest.slice(0, cut);
        const command = cut === -1 ? [] : rest.slice(cut + 1);
        const { values, positionals } = parseArgs({ args: own, allowPositionals: true, strict: true, options: { docs: { type: 'string' } } });
        if (positionals.length > 1) throw new BurhanError(`unexpected argument: ${positionals[1]} (the command goes after --)`);
        return verify(at(), positionals[0], command, io, { docs: values.docs });
      }
      case 'use': {
        if (rest.length !== 1) throw new BurhanError('use needs exactly one item slug');
        return useItem(at(), rest[0], io);
      }
      case 'setup': {
        const { values, positionals } = parseArgs({
          args: rest, allowPositionals: true, strict: true,
          options: { lang: { type: 'string' }, stack: { type: 'boolean' }, set: { type: 'boolean' }, force: { type: 'boolean' }, agent: { type: 'boolean' }, answers: { type: 'string' }, apply: { type: 'boolean' }, 'allow-outside-links': { type: 'boolean' }, 'allow-outside-settings': { type: 'boolean' } },
        });
        const allowOutside = values['allow-outside-links'] === true || values['allow-outside-settings'] === true;
        const lang = values.lang ?? 'en';
        if (lang !== 'en' && lang !== 'ar') throw new BurhanError(`--lang must be en or ar, not "${lang}"`);
        const setupFlags = {
          agent: values.agent === true,
          answers: values.answers !== undefined,
          apply: values.apply === true,
          set: values.set === true,
          stack: values.stack === true,
        };
        for (const [first, second] of CONFLICTING_SETUP_FLAG_PAIRS) {
          if (setupFlags[first] && setupFlags[second]) {
            throw new BurhanError(messages(lang).agent.conflictingFlags(SETUP_FLAG_NAMES[first], SETUP_FLAG_NAMES[second]));
          }
        }
        // With --set the KEY=VALUE pairs are the positionals that contain "="; a quoted `check=npm test` stays one argument.
        const pairs = values.set ? positionals.filter((x) => x.includes('=')) : [];
        const dirs = positionals.filter((x) => !pairs.includes(x));
        if (dirs.length > 1) throw new BurhanError(`unexpected argument: ${dirs[1]}`);
        const target = at(dirs[0]);
        if (values.agent) { io.stdout(agentInstructions(target, lang, homedir())); return 0; }
        if (values.answers !== undefined) return runAnswers(target, values.answers, values.apply === true, io, lang, homedir(), setupFilesystem, { allowOutside });
        if (values.apply) throw new BurhanError('--apply needs --answers <file>');
        if (values.stack) { io.stdout(stackInstructions(lang) + '\n'); return 0; }
        if (values.set) return await setStack(target, parseSetArgs(pairs), { force: values.force === true, allowOutside }, io);
        return await setupWizard(target, io, lang, allowOutside);
      }
      case '--version': case '-v':
        io.stdout(readVersion() + '\n'); return 0;
      case '--help': case '-h': case 'help':
        io.stdout(USAGE); return 0;
      case undefined:
        if (io.interactive) return await setupWizard(at(), io, 'en', false);
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
async function setupWizard(target: string, io: Io, lang: 'en' | 'ar', allowOutside: boolean): Promise<number> {
  if (!io.interactive) { io.stderr(messages(lang).wizard.terminalOnly + '\n'); return 2; }
  const numbered = (): ReturnType<typeof numberedPrompter> => numberedPrompter(process.stdin, process.stdout);
  const clack = await clackPrompter();
  const p = clack ? withFallback(clack, numbered) : numbered();
  try { return await runWizard(target, io, p, lang, homedir(), allowOutside); }
  finally { p.close?.(); }
}
