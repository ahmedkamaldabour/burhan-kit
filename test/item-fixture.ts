import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { kitDir } from '../src/lib/kit.js';
import { runCli } from '../src/main.js';
import { capture, tmpDir } from './helpers.js';

export const STATE = join('.burhan', 'local', 'PROGRESS.md');

/** A project with the templates the install puts in .burhan/templates and a state file with an empty Now. */
export function project(): string {
  const dir = tmpDir('burhan-item-');
  cpSync(join(kitDir(), 'templates'), join(dir, '.burhan', 'templates'), { recursive: true });
  mkdirSync(join(dir, '.burhan', 'local'), { recursive: true });
  writeFileSync(join(dir, STATE), '# State\n\n## Now\n\n## Waiting on you\n- nothing\n');
  return dir;
}

export async function cli(dir: string, args: string[]): Promise<{ code: number; out: string; err: string }> {
  const c = capture(dir);
  const code = await runCli(args, c.io);
  return { code, ...c.o };
}

export const itemDir = (dir: string, slug = 'foo'): string => join(dir, '.burhan', 'work', slug);
export const planFile = (dir: string, slug = 'foo'): string => join(itemDir(dir, slug), `${slug}-implementation-plan.md`);
export const specFile = (dir: string, slug = 'foo'): string => join(itemDir(dir, slug), `${slug}-build-spec.md`);
export const storyFile = (dir: string, slug = 'foo'): string => join(itemDir(dir, slug), `${slug}-story.md`);
export const read = (path: string): string => readFileSync(path, 'utf8');
export const write = (path: string, text: string): void => { mkdirSync(join(path, '..'), { recursive: true }); writeFileSync(path, text); };

/** A project with item `foo` made by `burhan item new` (a feature / architectural one: story and plan), plus a second sub-unit in the plan, with every template placeholder filled in
 *  (`raw: true` keeps the files exactly as `item new` made them). */
export async function projectWithItem(o: { raw?: boolean } = {}): Promise<string> {
  const dir = project();
  const r = await cli(dir, ['item', 'new', 'foo', '--type', 'feature', '--scope', 'architectural']);
  if (r.code !== 0) throw new Error(`item new failed: ${r.err}`);
  write(planFile(dir), read(planFile(dir)).replace(/(### Sub-unit 1 — .*\n(?:- .*\n)*)/, '$1\n### Sub-unit 2 — other · ⬜ Draft\n- **Covers:** AC-01\n'));
  // the build spec gets the same second sub-unit: a copy of the first
  const specText = read(specFile(dir));
  const first = /(## Sub-unit 1 [\s\S]*?)(?=\n## |$)/.exec(specText)?.[1];
  if (first !== undefined) write(specFile(dir), `${specText.trimEnd()}\n\n${first.replace('## Sub-unit 1', '## Sub-unit 2')}\n`);
  if (o.raw !== true) fillItem(dir); // approvable by default: the placeholder check is exact
  return dir;
}

/** Sets the plan's Overall status line. */
export const setPlanStatus = (dir: string, status: string): void => write(planFile(dir), read(planFile(dir)).replace(/^- \*\*Overall status:\*\* .*$/m, `- **Overall status:** ${status}`));
export const unitLine = (dir: string, n: number): string => read(planFile(dir)).split('\n').find((l) => l.startsWith(`### Sub-unit ${n} `)) ?? '';

/** Fills every template placeholder of item `foo` (story, plan, build spec) so that it can be approved: the placeholder check is exact, so a fixture that approves must fill them. */
export function fillItem(dir: string, slug = 'foo'): void {
  const special: Array<[RegExp, (m: RegExpExecArray) => string]> = [
    [/^- \*\*Baseline:\*\*/, () => '- **Baseline:** n/a (greenfield)'],
    [/^\| AC-01 \| \| \|$/, () => '| AC-01 | does a thing | request |'],
    [/^\| AC-01 \| 1 \| `<test file>`/, () => '| AC-01 | 1 | `a.test.ts` → `works` |'],
    [/^- \*\*Covers:\*\*/, () => '- **Covers:** AC-01'],
    [/^- \*\*Review group:\*\*/, () => '- **Review group:** —'],
    [/^- \*\*Reopened after PASS:\*\*/, () => '- **Reopened after PASS:** —'],
    [/^Knowledge review: none </, (m) => m.input], // decided after QC: stays as the template gives it
    [/^> As a <role>/, () => '> As a developer, I want a thing, so that it works.'],
    [/^(#{2,3}) Sub-unit (\d+) — <name>(.*)$/, (m) => `${m[1]} Sub-unit ${m[2]} — first${m[3]}`],
    [/^\| `<path>` \|/, () => '| `src/a.ts` | modify | 10-20 |'],
    [/^<the complete test code>$/, () => "test('x', () => {});"],
    [/^<the complete implementation code>$/, () => 'export const a = 1;'],
    [/^\| <exact name and signature> \|/, () => '| `a()` | — |'],
    [/^- \*\*Command:\*\*/, () => '- **Command:** `node --test`'],
  ];
  const templates = join(dir, '.burhan', 'templates');
  const files: Array<[string, string]> = [[join(itemDir(dir, slug), `${slug}-story.md`), 'story.md'], [join(itemDir(dir, slug), `${slug}-implementation-plan.md`), 'plan.md'], [join(itemDir(dir, slug), `${slug}-build-spec.md`), 'build-spec.md']];
  for (const [file, name] of files) {
    const tpl = new Set(readFileSync(join(templates, name), 'utf8').split('\n').map((l) => l.trim()));
    const out = readFileSync(file, 'utf8').split('\n').map((line) => {
      const t = line.trim();
      if (!tpl.has(t) || !(/<[^<>\n]+>/.test(t) || /^\|[^|]+\|(\s*\|)+$/.test(t))) return line;
      for (const [re, to] of special) { const m = re.exec(t); if (m) return to(m); }
      return line.replace(/<[^<>\n]+>/g, 'ok');
    });
    writeFileSync(file, out.join('\n'));
  }
}
