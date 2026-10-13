import { readFileSync, statSync } from 'node:fs';
import type { Io } from '../../main.js';
import { BurhanError } from '../errors.js';
import { applySetup, currentAnswers, docsPathError, planSetup, recommended, renderSummary, type DocsChoice, type SetupAnswers } from './engine.js';
import { messages, QUESTIONS, type Lang } from './messages.js';

/** `setup --agent`: the rules for the agent, then one json block with the questions and the recommended answers. */
export function agentInstructions(target: string, lang: Lang, home: string): string {
  const m = messages(lang);
  const body = {
    recommended: { ...(currentAnswers(target) ?? recommended(target, home)), lang },
    questions: QUESTIONS[lang].map((q) => ({ id: q.id, text: q.ask, choices: q.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint ?? '' })) })),
  };
  return `${m.agent.rules.join('\n')}\n\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\`\n`;
}

const MAX_ANSWERS_BYTES = 1024 * 1024; // an answers file is a few hundred bytes

/** Reads and validates an answers file; one clear error per bad field. */
export function readAnswers(file: string, lang: Lang): SetupAnswers {
  const m = messages(lang).agent;
  let text: string;
  // Look before reading: a device (/dev/zero never ends) or a huge file must not be read into memory.
  let st;
  try { st = statSync(file); } catch (e) { throw new BurhanError(m.readFailed(file, (e as Error).message)); }
  if (!st.isFile()) throw new BurhanError(m.notRegular(file));
  if (st.size > MAX_ANSWERS_BYTES) throw new BurhanError(m.tooLarge(file));
  try { text = readFileSync(file, 'utf8'); } catch (e) { throw new BurhanError(m.readFailed(file, (e as Error).message)); }
  let v: unknown;
  try { v = JSON.parse(text); } catch { throw new BurhanError(m.notJson(file)); }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new BurhanError(m.notObject);
  const o = v as Record<string, unknown>;
  const agents = o.agents;
  if (!Array.isArray(agents) || agents.length === 0 || !agents.every((a) => a === 'claude' || a === 'codex') || new Set(agents).size !== agents.length) throw new BurhanError(m.badAgents);
  if (o.mode !== 'step' && o.mode !== 'auto') throw new BurhanError(m.badMode);
  const d = o.docs as Record<string, unknown> | null;
  let docs: DocsChoice;
  if (typeof d !== 'object' || d === null) throw new BurhanError(m.badDocs);
  if (d.kind === 'private' || d.kind === 'shared') docs = { kind: d.kind };
  else if (d.kind === 'custom' && typeof d.path === 'string') {
    const bad = docsPathError(d.path);
    if (bad !== undefined) throw new BurhanError(bad);
    docs = { kind: 'custom', path: d.path };
  } else throw new BurhanError(m.badDocs);
  if (o.lang !== undefined && o.lang !== 'en' && o.lang !== 'ar') throw new BurhanError(m.badLang);
  return { agents: agents as SetupAnswers['agents'], mode: o.mode, docs, lang: (o.lang as Lang | undefined) ?? lang };
}

/** `setup --answers <file> [--apply]`: the summary, or (with --apply) write it and print the after-apply lines. */
export function runAnswers(target: string, file: string, apply: boolean, io: Io, lang: Lang, home: string): number {
  const a = readAnswers(file, lang);
  const m = messages(a.lang);
  const plan = planSetup(target, a, home);
  io.stdout(renderSummary(plan, a.lang) + '\n');
  if (!apply) return 0;
  applySetup(plan);
  io.stdout(`\n${m.wizard.done}\n${m.changeUndo}\n${m.wizard.askAgent}\n`);
  return 0;
}
