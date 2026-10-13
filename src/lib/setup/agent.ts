import { readFileSync, statSync } from 'node:fs';
import type { Io } from '../../main.js';
import { BurhanError } from '../errors.js';
import { applySetup, currentAnswers, docsPathError, planSetup, recommended, renderSummary, type DocsChoice, type SetupAnswers, type SetupFilesystem } from './engine.js';
import { superpowersLine } from './summary.js';
import { messages, QUESTIONS, type Lang } from './messages.js';

/** `setup --agent`: the rules for the agent, then one json block with the questions and the recommended answers. */
export function agentInstructions(target: string, lang: Lang, home: string): string {
  const m = messages(lang);
  const recommendedAnswers = { ...(currentAnswers(target) ?? recommended(target, home)), lang };
  const plan = planSetup(target, recommendedAnswers, home);
  const questions: { id: string; text: string; choices: { value: string; label: string; hint: string }[] }[] = QUESTIONS[lang].map((q) => ({ id: q.id, text: q.ask, choices: q.options.map((o) => ({ value: o.value, label: o.label, hint: o.hint ?? '' })) }));
  const body = {
    recommended: recommendedAnswers,
    questions,
  };
  const details = plan.existingHooks.length ? renderSummary(plan, lang) : superpowersLine(plan, lang);
  return `${m.agent.rules.join('\n')}${details ? `\n\n${details}` : ''}\n\n\`\`\`json\n${JSON.stringify(body, null, 2)}\n\`\`\`\n`;
}

const MAX_ANSWERS_BYTES = 1024 * 1024; // an answers file is a few hundred bytes

function rejectUnknownFields(value: Record<string, unknown>, allowed: readonly string[], unknownField: (field: string) => string): void {
  const field = Object.keys(value).find((key) => !allowed.includes(key));
  if (field !== undefined) throw new BurhanError(unknownField(field));
}

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
  rejectUnknownFields(o, ['agents', 'mode', 'docs', 'lang'], m.unknownField);
  const suppliedAgents = typeof o.agents === 'string' ? [o.agents] : o.agents;
  const agents = Array.isArray(suppliedAgents) ? suppliedAgents.flatMap((agent) => agent === 'both' ? ['claude', 'codex'] : [agent]) : suppliedAgents;
  if (!Array.isArray(agents) || agents.length === 0 || !agents.every((a) => a === 'claude' || a === 'codex') || new Set(agents).size !== agents.length) throw new BurhanError(m.badAgents);
  if (o.mode !== 'step' && o.mode !== 'auto') throw new BurhanError(m.badMode);
  const d = o.docs;
  let docs: DocsChoice;
  if (d === 'private' || d === 'shared') docs = { kind: d };
  else if (typeof d === 'object' && d !== null && !Array.isArray(d)) {
    const docFields = d as Record<string, unknown>;
    rejectUnknownFields(docFields, ['kind', 'path'], m.unknownField);
    if (docFields.kind === 'private' || docFields.kind === 'shared') docs = { kind: docFields.kind };
    else if (docFields.kind === 'custom' && typeof docFields.path === 'string') {
      const bad = docsPathError(docFields.path);
      if (bad !== undefined) throw new BurhanError(bad);
      docs = { kind: 'custom', path: docFields.path };
    } else throw new BurhanError(m.badDocs);
  } else throw new BurhanError(m.badDocs);
  if (o.lang !== undefined && o.lang !== 'en' && o.lang !== 'ar') throw new BurhanError(m.badLang);
  return { agents: agents as SetupAnswers['agents'], mode: o.mode, docs, lang: (o.lang as Lang | undefined) ?? lang };
}

/** `setup --answers <file> [--apply]`: the summary, or (with --apply) write it and print the after-apply lines. */
export function runAnswers(target: string, file: string, apply: boolean, io: Io, lang: Lang, home: string, fs?: SetupFilesystem): number {
  const a = readAnswers(file, lang);
  const m = messages(a.lang);
  const plan = planSetup(target, a, home);
  io.stdout(renderSummary(plan, a.lang) + '\n');
  if (!apply) return 0;
  applySetup(plan, fs);
  io.stdout(`\n${m.wizard.done}\n${m.changeUndo}\n${m.wizard.askAgent}\n`);
  return 0;
}
