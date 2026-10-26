/** Ordered turn steps used by turn-audit gate A (ports turn-audit.sh's jq/awk stream). */
import { evidenceMatches } from './evidence-cmd.mjs';
import { relPath } from './lib.mjs';
import type { Matcher } from './ere.mjs';

export interface Step {
  seq: number;
  kind: string;
  status: string;
  exit: string;
  file: string;
  cmd: string;
  by: string;
  /** The edit wrote a `Performed by:` line (Claude only; false when the adapter did not say). */
  performedBy: boolean;
}

const flat = (value: unknown): string => {
  if (value === undefined || value === null || value === false) return '';
  const text = typeof value === 'string' ? value : typeof value === 'number' ? String(value) : JSON.stringify(value);
  return (text ?? '').replace(/[\t\n\r]/g, ' ');
};

/** jq TSV flattening: `.status // "unknown"`, `.exit // ""`, then `gsub("[\\t\\n\\r]"; " ")`. */
export function parseSteps(raw: unknown[], project = ''): Step[] {
  const out: Step[] = [];
  try {
    for (const value of raw) {
      if (value === null || typeof value !== 'object' || Array.isArray(value)) continue;
      const step = value as Record<string, unknown>;
      const seqText = flat(step.seq);
      out.push({
        seq: Number(seqText) || 0,
        kind: flat(step.kind),
        status: step.status === undefined || step.status === null || step.status === false ? 'unknown' : flat(step.status),
        exit: flat(step.exit),
        file: relPath(flat(step.file), project),
        cmd: flat(step.cmd),
        by: flat(step.by),
        performedBy: step.performed_by === true,
      });
    }
  } catch { /* malformed adapter input is ignored, like jq's empty stream on failure */ }
  return out;
}

/** The last ordered edit whose normalised file matches the configured code ERE. */
export function lastCodeEdit(steps: Step[], code: Matcher | RegExp): Step | null {
  let found: Step | null = null;
  for (const step of steps) if (step.kind === 'edit' && (code instanceof RegExp ? code.test(step.file) : code.test(step.file))) found = step;
  return found;
}

/** Evidence commands, except result-less subagent commands which Bash intentionally drops. */
export function evidenceRuns(steps: Step[], evidence: Matcher | RegExp): Step[] {
  return steps.filter((step) => step.kind === 'cmd' && evidenceMatches(evidence, step.cmd)
    && !(step.by !== '' && ['blocked', 'background', 'unknown'].includes(step.status)));
}

/** Last run for every command after the final edit, in first-command order. */
export function lastRunPerCommand(runs: Step[], afterSeq: number): Step[] {
  const out: Step[] = [];
  const at = new Map<string, number>();
  for (const run of runs) {
    if (run.seq <= afterSeq) continue;
    const old = at.get(run.cmd);
    if (old === undefined) { at.set(run.cmd, out.length); out.push(run); }
    // blocked/background never produce a result, so they cannot undo an earlier result of this command.
    else if (!['blocked', 'background'].includes(run.status)) out[old] = run;
  }
  return out;
}
