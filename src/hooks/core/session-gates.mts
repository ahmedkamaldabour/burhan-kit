/** Session start (also after compaction): re-inject the gates, filled from the config, and surface the
 *  state file's "Now" section (port of session-gates.sh). */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { itemBlock, itemField, itemResolved, itemRoute, itemSlugs, stateNow, type Check } from './lib.mjs';
import { fingerprintSnapshot, linkedItem, stateSnapshot } from './store.mjs';

const STATE_LINES_MAX = 30;
const STATE_LINE_CHARS = 300;
// gates.txt is copied next to the entry at build time (dist/hooks/gates.txt).
const GATES = fileURLToPath(new URL('../gates.txt', import.meta.url));

/** fill(): every gate line, with {{KEY}} filled from WF_KEY; a line whose value is empty is dropped, and a
 *  "[skills]" line is kept only when the skills mapping is bound. */
function fill(v: Record<string, string>, skillsOn: boolean): string {
  const lines = readFileSync(GATES, 'utf8').split('\n');
  lines.pop(); // `read` sees only complete lines
  const out: string[] = [];
  next: for (let line of lines) {
    if (line.startsWith('[skills]')) { if (!skillsOn) continue; line = line.slice('[skills]'.length); }
    for (const key of ['DOCS_DIR', 'STATE_FILE', 'CHECK_CMD', 'MODE']) {
      if (line.includes(`{{${key}}}`)) {
        const val = v[key] ?? '';
        if (val === '') continue next;
        line = line.split(`{{${key}}}`).join(val);
      }
    }
    out.push(line);
  }
  return out.join('\n');
}

const isPlanOnly = (s: string): boolean => /^[ \t\n\v\f\r]*plan[-_ ]?only[ \t\n\v\f\r]*$/i.test(s.replace(/[`*]/g, ''));

export const sessionGates: Check = ({ cfg, project, ev, env }) => {
  const out: string[] = [];
  const now = stateNow(project, cfg).split('\n').map((line) => Array.from(line).slice(0, STATE_LINE_CHARS).join('')).join('\n');
  const slugs = itemSlugs(now);
  const storeEnv = { ...env, ...cfg };
  const item = itemResolved(now, linkedItem(project, ev.get('.session'), slugs, storeEnv));
  stateSnapshot(project, ev.get('.session'), slugs, storeEnv);
  fingerprintSnapshot(project, ev.get('.session'), cfg.WF_STATE_FILE ?? '', storeEnv);
  const active = item ? itemBlock(now, item) : now;
  // Autonomy mode: the item's **Mode:**, else WF_MODE_<TYPE>_<SCOPE> for its route, else WF_MODE_DEFAULT,
  // else step — exactly step | auto, anything else is step.
  const route = itemRoute(active);
  const routeKey = route ? 'WF_MODE_' + route.replace(' / ', '_').toUpperCase() : '';
  const routeMode = routeKey ? cfg[routeKey] ?? '' : '';
  const modeVal = itemField(active, 'Mode');
  const dflt = cfg.WF_MODE_DEFAULT ?? '';
  let mode = modeVal || routeMode || dflt || 'step';
  if (mode !== 'step' && mode !== 'auto') mode = 'step';
  let oldPlanOnly = '';
  for (const [name, val] of [["the item's Mode", modeVal], [routeKey, routeMode], ['WF_MODE_DEFAULT', dflt]]) {
    if (isPlanOnly(val)) {
      oldPlanOnly = `⚑ plan-only is no longer a mode (step | auto): the old value in ${name} is ignored; this session runs as ${mode}. To stop after the plan, say so — the item closes at Plan ready (.burhan/phases/lifecycle.md · Modes).`;
      break;
    }
  }
  out.push(fill({ DOCS_DIR: cfg.WF_DOCS_DIR ?? '', STATE_FILE: cfg.WF_STATE_FILE ?? '', CHECK_CMD: cfg.WF_CHECK_CMD ?? '', MODE: mode },
    cfg.WF_SKILLS === 'superpowers'));
  if (cfg.WF_STACK_SETUP === 'pending') out.push("⚑ FIRST USE: burhan's project checks are not set up yet. Do this FIRST, whatever the person's first message says (a greeting too): run `npx burhan-kit setup --stack` and follow it. Do not ask what they want to work on before it. When it finishes, present the project onboarding in this same session (Claude Code: /burhan:onboard · Codex: follow .burhan/commands/onboard.md), then go on with their request.");
  if (oldPlanOnly) out.push(oldPlanOnly);

  if (slugs.length > 1 && item === '') {
    out.push(`⚑ ITEMS IN FLIGHT: ${slugs.join(', ')} — this session isn't linked to one yet — say which, or run /burhan:e2e <slug>.`);
  } else if (slugs.length > 1) {
    const shown = itemBlock(now, item).split('\n').map((l) => Array.from(l).slice(0, STATE_LINE_CHARS).join('')).join('\n');
    out.push(`⚑ CURRENT STATE (${cfg.WF_STATE_FILE} · Now · linked: ${item}):\n${shown}\n⚑ OTHER ITEMS: ${slugs.filter((s) => s !== item).join(', ')}`);
  } else if (now !== '') {
    const lines = now.split('\n').map((l) => Array.from(l).slice(0, STATE_LINE_CHARS).join(''));
    let shown = lines.slice(0, STATE_LINES_MAX).join('\n');
    if (lines.length > STATE_LINES_MAX) shown += `\n… truncated (${lines.length} lines) — read ${cfg.WF_STATE_FILE}`;
    out.push(`⚑ CURRENT STATE (${cfg.WF_STATE_FILE} · Now):\n${shown}`);
  }
  return out;
};
