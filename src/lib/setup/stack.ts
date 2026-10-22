import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { applyPlan, planInstall } from '../install.js';
import { BurhanError } from '../errors.js';
import { parseConfig, TEAM_CONFIG } from '../config.js';
import { putFile, realTarget } from '../fs-safe.js';
import { ereRefusal } from '../../hooks/core/ere.mjs';
import { runCheck } from '../../hooks/core/run-check.mjs';
import type { Io } from '../../main.js';
import { assertWritable, sensitiveRegex, setConfigKeys } from './config-write.js';
import { messages, type Lang } from './messages.js';

const DEFAULT_SENSITIVE_NOTE = 'Access-control path: re-read authorization and data scoping; test allowed AND denied cases.';

/** The agent's first-use instructions (AC-13): read the project; propose a check and sensitive paths;
 *  show the user ONLY the fixed block; save with `npx burhan-kit setup --set …`; if no check fits, say so and ask (never invent). */
export function stackInstructions(lang: 'en' | 'ar'): string {
  return messages(lang as Lang).stack.instructions;
}

export interface StackValues { check: string; sensitive: string[]; code?: string; test?: string; evidence?: string }

const list = (s: string): string[] => s.split(';').map((x) => x.trim()).filter(Boolean);

/** R-2: parse `check=<cmd|none> sensitive=<p;q>` args (each arg is KEY=VALUE). */
export function parseSetArgs(args: string[]): StackValues {
  const out: StackValues = { check: '', sensitive: [] };
  for (const a of args) {
    const i = a.indexOf('=');
    if (i <= 0) throw new BurhanError(`"${a}" is not KEY=VALUE — use check=<command|none> [code=<pattern>] [test=<pattern>] [evidence=<pattern>] [sensitive=<p;q>]`);
    const key = a.slice(0, i);
    const val = a.slice(i + 1);
    if (key === 'check') out.check = val.trim();
    else if (key === 'never-run' || key === 'never-run-regex') throw new BurhanError(`setting "${key}" was removed`);
    else if (key === 'sensitive') out.sensitive = list(val);
    else if (key === 'code' || key === 'test' || key === 'evidence') out[key] = val.trim();
    else throw new BurhanError(`unknown setting "${key}" — the choices are check, sensitive, code, test, evidence`);
  }
  if (out.check === '') throw new BurhanError('check=<command|none> is required — say which command checks the work before a commit, or none');
  return out;
}

/** R-8, AC-14: run the check once (unless 'none'), show it, save only when it passes (or --force), mark first-use done,
 *  then regenerate the files that depend on the check. Returns the exit code. */
export async function setStack(target: string, v: StackValues, o: { force: boolean }, io: Io): Promise<number> {
  const m = messages('en').stack;
  const real = realTarget(target);
  if (!existsSync(join(real, '.burhan/WORKFLOW.md'))) throw new BurhanError(m.notInstalled);
  const configPath = join(real, TEAM_CONFIG);
  const text = existsSync(configPath) ? readFileSync(configPath, 'utf8') : '';
  const have = parseConfig(text).values;

  const none = v.check === 'none';
  const check = none ? '' : v.check;
  const sensitive = v.sensitive.map((c) => c.trim()).filter(Boolean);
  // R-4: every value that reaches the config is checked before anything runs or is written.
  assertWritable('the check command', check);
  sensitive.forEach((c) => assertWritable('a sensitive path', c));
  const sens = sensitiveRegex(sensitive);
  assertWritable('the sensitive paths', sens);
  // The three patterns feed the "done without proof" warning: refuse one the hooks would refuse, before anything runs.
  const patterns: [string, 'WF_CODE_REGEX' | 'WF_TEST_REGEX' | 'WF_EVIDENCE_REGEX', string | undefined][] = [
    ['code', 'WF_CODE_REGEX', v.code], ['test', 'WF_TEST_REGEX', v.test], ['evidence', 'WF_EVIDENCE_REGEX', v.evidence]];
  for (const [name, , value] of patterns) {
    if (!value) continue;
    assertWritable(`the ${name} pattern`, value);
    const why = ereRefusal(value);
    if (why) throw new BurhanError(`the ${name} pattern: the hooks refuse it (${why}) — rewrite it`);
  }

  if (check === '') io.stdout(m.none + '\n');
  else {
    const t = have.WF_CHECK_TIMEOUT !== undefined && /^\d+$/.test(have.WF_CHECK_TIMEOUT) ? Number(have.WF_CHECK_TIMEOUT) : 60;
    io.stdout(m.running(check, t) + '\n');
    const r = await runCheck(check, real, t, process.env);
    if (r.output !== '') io.stdout(r.output.replace(/\n*$/, '\n'));
    io.stdout(m.result(r.code, r.kind === 'timeout') + '\n');
    if (r.kind !== 'pass' && !o.force) { io.stdout(m.failed(check) + '\n'); return 1; }
  }

  const values: Record<string, string> = { WF_CHECK_CMD: check, WF_STACK_SETUP: 'done' };
  if (sensitive.length) {
    values.WF_SENSITIVE_REGEX = sens;
    if ((have.WF_SENSITIVE_NOTE ?? '') === '') values.WF_SENSITIVE_NOTE = DEFAULT_SENSITIVE_NOTE;
  }
  for (const [, key, value] of patterns) if (value) values[key] = value;
  putFile(configPath, setConfigKeys(text, values));
  // The verify skill carries the check command: regenerate it (and anything else that depends on the config).
  // The bootstrap block only where the project already has it: a --no-bootstrap install stays without one.
  const hasBlock = ['CLAUDE.md', 'AGENTS.md'].some((f) => { try { return /^<!-- burhan:start -->\r?$/m.test(readFileSync(join(target, f), 'utf8')); } catch { return false; } });
  applyPlan(planInstall({ mode: 'upgrade', target, agents: null, apply: true, bootstrap: hasBlock, keepProjectFiles: true }));
  io.stdout(m.saved(check) + '\n');
  return 0;
}
