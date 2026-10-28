import { createHash } from 'node:crypto';
/** What a plan says, read the one way: its status, its sub-units and their ladder, its route. Pure — no file access, no imports — so the CLI commands
 *  (src/lib/item-*.ts) and the hooks read a plan the same way. Hook files are copied into projects, which is why this is not in src/lib. */

export const RUNGS = [['⬜', 'Draft'], ['🟡', 'Approved'], ['🔵', 'In progress'], ['🟢', 'Implemented'], ['✅', 'Reviewed']] as const;
const RUNG_TAIL = /· (⬜ Draft|🟡 Approved|🔵 In progress|🟢 Implemented|✅ Reviewed)\s*$/;

export interface Unit { n: number; line: number; rung: number }

/** Per line: is it inside a fenced code block (a fence line itself counts as inside)? A block opens with three or more backticks or tildes and
 *  closes with the same kind of fence at least as long, so a 4-backtick block may hold a 3-backtick one. */
export function fenced(lines: string[]): boolean[] {
  let kind = '';
  let size = 0;
  return lines.map((raw) => {
    const l = raw.replace(/\r$/, '');
    if (kind === '') {
      const m = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(l);
      if (m === null || (m[1]![0] === '`' && m[2]!.includes('`'))) return false;
      kind = m[1]![0]!;
      size = m[1]!.length;
      return true;
    }
    const close = /^[ \t]*(`{3,}|~{3,})[ \t]*$/.exec(l);
    if (close !== null && close[1]![0] === kind && close[1]!.length >= size) { kind = ''; size = 0; }
    return true;
  });
}

/** The plan's Overall status line value, or null. */
export function overallStatus(plan: string): string | null {
  const lines = plan.split('\n');
  const inFence = fenced(lines);
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue;
    const m = /^- \*\*Overall status:\*\*[ \t]*([^\r\n·]*)/.exec(lines[i]!);
    if (m) return m[1]!.replace(/\*/g, '').trim();
  }
  return null;
}

/** The routes the routing matrix allows (WORKFLOW §3): a spike is only a bug's or an investigation's; the patch lane is only a change's, a bug's or a refactor's. */
const SCOPES: Record<string, string[]> = {
  feature: ['bounded', 'architectural'], bug: ['spike', 'bounded', 'architectural', 'patch'], investigation: ['spike', 'bounded', 'architectural'],
  change: ['bounded', 'architectural', 'patch'], refactor: ['bounded', 'architectural', 'patch'], release: ['bounded', 'architectural'],
};
export const routeAllowed = (route: string): boolean => { const [type = '', scope = ''] = route.split(' / '); return Object.prototype.hasOwnProperty.call(SCOPES, type) && SCOPES[type]!.includes(scope); };

/** Every "### Sub-unit N" heading with the rung its status is on (-1 when the status is not on the ladder); headings in a code fence are not read. */
export function units(plan: string): Unit[] {
  const out: Unit[] = [];
  const lines = plan.split('\n');
  const inFence = fenced(lines);
  lines.forEach((l, line) => {
    const m = /^### Sub-unit (\d+)\b/.exec(l);
    if (!m || inFence[line]) return;
    const tail = RUNG_TAIL.exec(l.replace(/\r$/, ''));
    out.push({ n: Number(m[1]), line, rung: tail ? RUNGS.findIndex(([, word]) => tail[1]!.endsWith(word)) : -1 });
  });
  return out;
}

/** The heading line with its status replaced by the rung's; a trailing CR is kept. */
export const withRung = (heading: string, rung: number): string =>
  heading.replace(RUNG_TAIL, `· ${RUNGS[rung]![0]} ${RUNGS[rung]![1]}`) + (heading.endsWith('\r') ? '\r' : '');

/** The route ("<type> / <scope>") a text states exactly, or ''. */
export function planRoute(text: string): string {
  const m = /^- \*\*Route:\*\*[ \t]*(feature|bug|investigation|change|refactor|release) \/ (spike|bounded|architectural|patch)/m.exec(text);
  return m ? `${m[1]} / ${m[2]}` : '';
}

/** The text with the value of the first real (not fenced) `- **Label:** value` line replaced; null when there is none. The value is taken as it is:
 *  no replacement pattern is expanded, and a CR at the end of the line is kept. */
export function setFieldLine(text: string, label: string, value: string): string | null {
  const lines = text.split('\n');
  const inFence = fenced(lines);
  const head = `- **${label}:**`;
  const at = lines.findIndex((l, i) => !inFence[i] && l.startsWith(head));
  if (at === -1) return null;
  lines[at] = `${head} ${value}${lines[at]!.endsWith('\r') ? '\r' : ''}`;
  return lines.join('\n');
}

/** What a route needs of the plan's gate checklist (WORKFLOW §3): a story, QC, a knowledge review. A route that is not exact needs everything:
 *  never "nothing" by guess. */
export function routeNeeds(route: string): { story: boolean; qc: boolean; knowledge: boolean } {
  if (!/^(feature|bug|investigation|change|refactor|release) \/ (spike|bounded|architectural|patch)$/.test(route)) return { story: true, qc: true, knowledge: true };
  const [type = '', scope = ''] = route.split(' / ');
  const story = ['feature', 'bug', 'change'].includes(type) && scope !== 'spike' && scope !== 'patch';
  const qc = type === 'feature' ? scope !== 'spike' : (type === 'bug' || type === 'change') ? scope === 'architectural' : false;
  const knowledge = type === 'feature' ? scope !== 'spike' : (type === 'bug' || type === 'change') ? scope !== 'spike' : type === 'refactor' ? scope === 'architectural' : false;
  return { story, qc, knowledge };
}

/** One row of the plan's Deviations table (a step that did not go as the spec said). `line` is its index in the plan's lines. */
export interface Deviation { n: number; unit: number; what: string; where: string; output: string; status: string; decision: string; line: number }

/** The cells of a table row: split on a pipe that is not escaped (`\|` is a pipe inside a cell). null when the line is not a table row. */
function rowCells(line: string): string[] | null {
  const l = line.replace(/\r$/, '').trim();
  if (!l.startsWith('|')) return null;
  const cells: string[] = [];
  let cell = '';
  for (let i = 1; i < l.length; i++) {
    if (l[i] === '\\' && l[i + 1] === '|') { cell += '|'; i++; }
    else if (l[i] === '|') { cells.push(cell.trim()); cell = ''; }
    else cell += l[i];
  }
  if (cell.trim() !== '') cells.push(cell.trim());
  return cells;
}

/** A cell value on one table line: line ends become a space and a pipe is escaped. Its length is not limited. */
export const deviationCell = (value: string): string => value.split(/[\r\n\u0085\u2028\u2029]+/).map((part) => part.trim()).filter((part) => part !== '').join(' ').replace(/\|/g, '\\|');

/** The line range [from, to) of the plan's "## … Deviations" section, outside code fences; null when there is none. */
function deviationRange(lines: string[]): [number, number] | null {
  const inFence = fenced(lines);
  const from = lines.findIndex((l, i) => !inFence[i] && /^##[ \t]+(\d+\.[ \t]+)?Deviations[ \t]*\r?$/i.test(l));
  if (from === -1) return null;
  let to = lines.length;
  for (let i = from + 1; i < lines.length; i++) if (!inFence[i] && /^## /.test(lines[i]!)) { to = i; break; }
  return [from, to];
}

/** Every data row of the Deviations table (a row whose first cell is a number). */
export function deviations(plan: string): Deviation[] {
  const lines = plan.split('\n');
  const range = deviationRange(lines);
  if (range === null) return [];
  const out: Deviation[] = [];
  for (let i = range[0] + 1; i < range[1]; i++) {
    const c = rowCells(lines[i]!);
    // The header row (# …) and the separator row are not data; every other row is, even one whose number or status cannot be read (it then stops the work).
    if (c === null || (c[0] ?? '') === '#' || c.every((x) => /^:?-+:?$/.test(x) || x === '')) continue;
    out.push({ n: Number(/\d+/.exec(c[0] ?? '')?.[0] ?? 0), unit: /^\d+$/.test(c[1] ?? '') ? Number(c[1]) : -1, what: c[2] ?? '', where: c[3] ?? '', output: c[4] ?? '', status: (c[5] ?? '').replace(/\*/g, '').trim().toLowerCase(), decision: c[6] ?? '', line: i });
  }
  return out;
}

const rowText = (n: number, unit: number, what: string, where: string, output: string, status: string, decision: string): string =>
  `| ${n} | ${unit} | ${deviationCell(what)} | ${deviationCell(where)} | ${deviationCell(output)} | ${status} | ${deviationCell(decision)} |`;

/** The plan with an open row added to the Deviations table (numbered after the last), or null when the plan has no such table. */
export function withDeviationRow(plan: string, r: { unit: number; what: string; where: string; output: string }): { text: string; n: number } | null {
  const lines = plan.split('\n');
  const range = deviationRange(lines);
  if (range === null) return null;
  let last = -1;
  for (let i = range[0] + 1; i < range[1]; i++) if (rowCells(lines[i]!) !== null) last = i;
  if (last === -1) return null;
  const n = deviations(plan).reduce((m, d) => Math.max(m, d.n), 0) + 1;
  lines.splice(last + 1, 0, rowText(n, r.unit, r.what, r.where, r.output, 'open', '') + (lines[last]!.endsWith('\r') ? '\r' : ''));
  return { text: lines.join('\n'), n };
}

/** The plan with row `n` closed (approved or rejected) and its decision written, or null when the row is not there. */
export function withDeviationResolved(plan: string, n: number, status: 'approved' | 'rejected', decision: string): string | null {
  const row = deviations(plan).find((d) => d.n === n);
  if (row === undefined) return null;
  const lines = plan.split('\n');
  lines[row.line] = rowText(row.n, row.unit, row.what, row.where, row.output, status, decision) + (lines[row.line]!.endsWith('\r') ? '\r' : '');
  return lines.join('\n');
}

/** The rows that stop the work: every row the owner has not decided. Only exactly approved or rejected lets the work go on, so a row that cannot be read stops it too. */
export const openDeviations = (plan: string): Deviation[] => deviations(plan).filter((d) => d.status !== 'approved' && d.status !== 'rejected');

/** The parts of an approved plan the executor follows: the AC coverage table, the executor rules and each sub-unit's Covers line. Status, gate ticks,
 *  results and deviation rows change while the work goes on and are not part of it. Line ends and trailing spaces do not count. */
export function executableParts(plan: string): string {
  const lines = plan.split('\n').map((l) => l.replace(/\r$/, '').trimEnd());
  const inFence = fenced(lines);
  const out: string[] = [];
  let keep = false;
  lines.forEach((l, i) => {
    if (inFence[i]) { if (keep) out.push(l); return; }
    if (/^## /.test(l)) keep = /^##[ \t]+(\d+\.[ \t]+)?(AC coverage|Executor rules)[ \t]*$/i.test(l);
    if (keep || /^- \*\*Covers:\*\*/.test(l)) out.push(l);
  });
  return out.join('\n');
}

/** A short fingerprint of the executable parts (16 hex characters). */
export const executableHash = (plan: string): string => createHash('sha256').update(executableParts(plan)).digest('hex').slice(0, 16);

/** The fingerprint written when the plan was approved, or null when the plan has none (approved before it existed). */
export const recordedHash = (plan: string): string | null => {
  const lines = plan.split('\n');
  const inFence = fenced(lines);
  for (let i = 0; i < lines.length; i++) { const m = inFence[i] ? null : /^- \*\*Executable parts:\*\*[ \t]*([0-9a-f]{16})[ \t]*\r?$/.exec(lines[i]!); if (m) return m[1]!; }
  return null;
};

/** The verdict of a QC report, wherever the `**Verdict:**` field sits on its line (kit/templates/qc.md puts it on the Date line, the commands write it on its own
 *  line); lines in a code fence are not read. null when there is none or it is not PASS or FAIL. */
export function qcVerdict(qc: string): 'PASS' | 'FAIL' | null {
  const lines = qc.split('\n');
  const inFence = fenced(lines);
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue;
    const m = /\*\*Verdict:\*\*[ \t]*(PASS|FAIL)(?![A-Za-z0-9_])/.exec(lines[i]!);
    if (m) return m[1] as 'PASS' | 'FAIL';
  }
  return null;
}

/** Is the QC accepted in the exact form "<name> · YYYY-MM-DD" (the name has a letter and no `<` or `·`; the date is a real one)? Any other value, the template's
 *  placeholder and a dash included, is not an acceptance. */
export function qcAccepted(qc: string): boolean {
  const lines = qc.split('\n');
  const inFence = fenced(lines);
  for (let i = 0; i < lines.length; i++) {
    if (inFence[i]) continue;
    const m = /^- \*\*Accepted by:\*\*[ \t]*([^\r\n]*)/.exec(lines[i]!);
    if (m) return acceptedForm(m[1]!);
  }
  return false;
}

/** "<name> · YYYY-MM-DD": split at the last " · " (no pattern that can backtrack over a long line); the name has a letter and no `<` or `·`; the date is a real one. */
export function acceptedForm(value: string): boolean {
  const v = value.trim();
  const at = v.lastIndexOf(' · ');
  if (at < 1) return false;
  const name = v.slice(0, at);
  const date = v.slice(at + 3);
  if (/[<·]/.test(name) || !/\p{L}/u.test(name) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  const d = new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10))));
  return d.getUTCFullYear() === Number(date.slice(0, 4)) && d.getUTCMonth() === Number(date.slice(5, 7)) - 1 && d.getUTCDate() === Number(date.slice(8, 10));
}
