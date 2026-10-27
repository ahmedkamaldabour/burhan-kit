import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Io } from '../../main.js';
import type { Agent } from '../bootstrap.js';
import { parseConfig, TEAM_CONFIG } from '../config.js';
import { realTarget } from '../fs-safe.js';
import { runCheck } from '../../hooks/core/run-check.mjs';
import { applySetup, currentAnswers, discoveryBeside, discoveryPathError, docsPathError, planSetup, recommended, renderSummary, type SetupAnswers } from './engine.js';
import { PRIVATE_DOCS, SHARED_DOCS } from './answers.js';
import { messages, QUESTIONS, REVIEWER_QUESTION, type Lang } from './messages.js';
import { CANCEL, type Prompter } from './prompter.js';

const agentValue = (a: SetupAnswers): string => (a.agents.length > 1 ? 'both' : a.agents[0]);

/** AC-04: exactly the four questions (five with two agents), sequentially, each starting on the current answer (the recommended one on a fresh project). */
async function ask(p: Prompter, a: SetupAnswers, lang: Lang, target: string): Promise<SetupAnswers | typeof CANCEL> {
  const [qa, qm, qd, qv] = QUESTIONS[lang];
  const choices = (q: typeof qa) => q.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint }));
  const ag = await p.select(qa.ask, choices(qa), agentValue(a));
  if (ag === CANCEL) return CANCEL;
  const mode = await p.select(qm.ask, choices(qm), a.mode);
  if (mode === CANCEL) return CANCEL;
  const kind = await p.select(qd.ask, choices(qd), a.docs.kind);
  if (kind === CANCEL) return CANCEL;
  let docs: SetupAnswers['docs'];
  if (kind === 'custom') {
    const path = await p.text(messages(lang).wizard.customPath, a.docs.kind === 'custom' ? a.docs.path : 'docs/work', (v) => docsPathError(v, target));
    if (path === CANCEL) return CANCEL;
    docs = { kind: 'custom', path };
  } else docs = { kind: kind === 'shared' ? 'shared' : 'private' };
  // Name the folder "beside" means for the work files just chosen.
  const folder = discoveryBeside(target, docs);
  const dchoices = qv.options.map((o) => ({ value: o.value, label: o.label, hint: o.value === 'beside' ? `${o.hint ?? ''} · ${folder}/`.trim() : o.hint }));
  const dkind = await p.select(qv.ask, dchoices, a.discovery?.kind ?? 'beside');
  if (dkind === CANCEL) return CANCEL;
  let discovery: NonNullable<SetupAnswers['discovery']>;
  if (dkind === 'custom') {
    const path = await p.text(messages(lang).wizard.customDiscoveryPath, a.discovery?.kind === 'custom' ? a.discovery.path : 'docs/discovery', (v) => discoveryPathError(v, docs, target));
    if (path === CANCEL) return CANCEL;
    discovery = { kind: 'custom', path };
  } else discovery = { kind: 'beside' };
  const agents = (ag === 'both' ? ['claude', 'codex'] : [ag]) as Agent[];
  let reviewer: SetupAnswers['reviewer'] = 'same';
  if (agents.length > 1) {
    const qr = REVIEWER_QUESTION[lang];
    const selected = await p.select(qr.ask, qr.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint })), a.reviewer === 'same' ? 'same' : 'other');
    if (selected === CANCEL) return CANCEL;
    reviewer = selected as SetupAnswers['reviewer'];
  }
  return { ...a, agents, mode: mode as 'step' | 'auto', docs, discovery, reviewer, lang };
}

/** AC-01–03, 04, 06: what you get → recommended or choose → summary → apply / change / cancel. Cancel anywhere writes nothing and exits 0. */
export async function runWizard(target: string, io: Io, p: Prompter, lang: 'en' | 'ar', home: string, allowOutside = false): Promise<number> {
  const m = messages(lang);
  const w = m.wizard;
  const installed = currentAnswers(target);
  let a: SetupAnswers = { ...(installed ?? recommended(target, home)), lang };
  const cancelled = (): number => { io.stdout(w.cancelled + '\n'); return 0; };

  const cfg = a.docs.kind === 'private' ? PRIVATE_DOCS : a.docs.kind === 'shared' ? SHARED_DOCS : a.docs.path;
  const docsKind = a.docs.kind === 'private' ? m.docsPrivate : a.docs.kind === 'shared' ? m.docsShared : m.docsCustom;
  p.note([...w.what, '', w.scope].join('\n'));
  const found = parseConfig(planSetup(target, a, home).config).values.WF_DISCOVERY_DIR ?? '';
  p.note([installed ? w.current : w.recommended, `  ${m.agents(a.agents)}`, `  ${m.mode(a.mode)}`, `  ${m.docs(`${cfg}/ (${docsKind})`)}`, `  ${m.discovery(`${found}/`)}`,
    ...(installed ? [] : [`  ${m.check(true, '')}`])].join('\n'));
  const first = await p.select(w.useOrChoose, [{ value: 'use', label: w.use }, { value: 'choose', label: w.choose }], 'use');
  if (first === CANCEL) return cancelled();

  let asking = first === 'choose';
  for (;;) {
    if (asking) {
      const r = await ask(p, a, lang, target);
      if (r === CANCEL) return cancelled();
      a = r;
    }
    const plan = planSetup(target, a, home);
    p.note(renderSummary(plan, lang, undefined, allowOutside));
    const next = await p.select(w.applyOrChange, [{ value: 'apply', label: w.apply }, { value: 'change', label: w.change }, { value: 'cancel', label: w.cancel }], 'apply');
    if (next === CANCEL || next === 'cancel') return cancelled();
    if (next === 'change') { asking = true; continue; }
    applySetup(plan, undefined, { allowOutside });
    break;
  }

  io.stdout(`\n${w.done}\n${m.changeUndo}\n${w.askAgent}\n`);
  // Offer the check only when one is already set (first-use setup does the rest).
  const real = realTarget(target);
  const conf = existsSync(join(real, TEAM_CONFIG)) ? parseConfig(readFileSync(join(real, TEAM_CONFIG), 'utf8')).values : {};
  const cmd = conf.WF_CHECK_CMD ?? '';
  if (cmd !== '') {
    const run = await p.select(w.runCheck(cmd), [{ value: 'yes', label: w.runYes }, { value: 'no', label: w.runNo }], 'no');
    if (run === 'yes') {
      const t = /^\d+$/.test(conf.WF_CHECK_TIMEOUT ?? '') ? Number(conf.WF_CHECK_TIMEOUT) : 60;
      const r = await runCheck(cmd, real, t, process.env);
      if (r.output !== '') io.stdout(r.output.replace(/\n*$/, '\n'));
      io.stdout(m.stack.result(r.code, r.kind === 'timeout') + '\n');
    }
  }
  io.stdout(`\n${m.onboardStep(a.agents).join('\n')}\n`);
  return 0;
}
