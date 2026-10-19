import { statSync } from 'node:fs';
import type { Io } from '../main.js';
import { BurhanError } from './errors.js';
import { readProjectConfig } from './config.js';
import { BROWNFIELD_MIN_SOURCE_FILES, DIR_MAX_ENTRIES, INSPECT_MAX_DEPTH, INSPECT_MAX_ENTRIES, INSPECT_MAX_MS, sourceTest, walkTree } from '../hooks/core/baseline.mjs';

/** Files a newcomer opens first, by name only (never read): manifests, build and CI files, top-level docs. */
const IMPORTANT = /^(?:package\.json|pyproject\.toml|setup\.py|setup\.cfg|requirements[^/]*\.txt|Pipfile|go\.mod|Cargo\.toml|pom\.xml|build\.gradle(?:\.kts)?|settings\.gradle(?:\.kts)?|Gemfile|composer\.json|mix\.exs|Package\.swift|pubspec\.yaml|[^/]+\.csproj|[^/]+\.sln|CMakeLists\.txt|Makefile|Dockerfile|docker-compose\.ya?ml|compose\.ya?ml|\.gitlab-ci\.yml|Jenkinsfile|azure-pipelines\.yml|\.github\/workflows\/[^/]+\.ya?ml|\.circleci\/config\.yml|(?:README|CONTRIBUTING|ARCHITECTURE|SECURITY)(?:\.[^/]+)?|docs|doc|adr|docs\/adr|docs\/decisions)$/i;

export interface Inspection {
  kind: 'brownfield' | 'greenfield'; reason: string; sourceFiles: number; threshold: number; codeRegex: string | null;
  important: string[]; entries: number; symlinks: number; unreadable: string[];
  truncated: { depth: boolean; entries: boolean; wide: boolean; time: boolean }; limits: { depth: number; entries: number };
}

/** `burhan inspect`: names only, no file content, no LLM, bounded; symlinks counted, never followed. */
export function inspect(project: string, o: { maxEntries?: number; maxMs?: number } = {}): Inspection {
  let st;
  try { st = statSync(project); } catch { st = null; }
  if (st === null || !st.isDirectory()) throw new BurhanError(`inspect: ${project} is not a folder`);
  const regex = readProjectConfig(project).values.WF_CODE_REGEX ?? '';
  const important: string[] = [];
  const maxEntries = o.maxEntries ?? INSPECT_MAX_ENTRIES;
  const src = sourceTest(regex);
  const w = walkTree(project, { isSource: src.test, maxEntries, maxMs: o.maxMs ?? INSPECT_MAX_MS, onEntry: (rel) => { if (IMPORTANT.test(rel)) important.push(rel); } });
  const kind = w.sourceFiles >= BROWNFIELD_MIN_SOURCE_FILES ? 'brownfield' : 'greenfield';
  const what = src.kind === 'regex' ? 'files matching WF_CODE_REGEX' : regex === '' ? 'source files' : 'source files by the built-in source extensions (WF_CODE_REGEX could not be used)';
  return {
    kind, reason: `${w.sourceFiles} ${what} (threshold ${BROWNFIELD_MIN_SOURCE_FILES})`, sourceFiles: w.sourceFiles,
    threshold: BROWNFIELD_MIN_SOURCE_FILES, codeRegex: regex === '' ? null : regex, important: important.sort(),
    entries: w.entries, symlinks: w.symlinks, unreadable: w.unreadable.map((d) => (d === '' ? '.' : d)), truncated: w.truncated, limits: { depth: INSPECT_MAX_DEPTH, entries: maxEntries },
  };
}

const capped = (list: string[], n: number): string => (list.length > n ? `${list.slice(0, n).join(', ')} … +${list.length - n} more` : list.join(', '));

export function inspectCommand(target: string, json: boolean, io: Io): number {
  const r = inspect(target);
  if (json) { io.stdout(`${JSON.stringify(r, null, 2)}\n`); return 0; }
  io.stdout(`${r.kind} — ${r.reason}\n`);
  io.stdout(`important: ${r.important.length ? capped(r.important, 40) : '(none found)'}\n`);
  io.stdout(`read: ${r.entries} entries, names only · ${r.symlinks} symlinks counted, not followed${r.unreadable.length ? ` · unreadable: ${capped(r.unreadable, 10)}` : ''}\n`);
  const cut = [r.truncated.depth ? `deeper than ${r.limits.depth} levels not read` : '', r.truncated.entries ? `stopped after ${r.limits.entries} entries` : '', r.truncated.wide ? `only the first ${DIR_MAX_ENTRIES} entries of a large folder` : '', r.truncated.time ? `stopped at the ${INSPECT_MAX_MS / 1000} s time limit` : ''].filter(Boolean);
  io.stdout(`${cut.length ? `truncated: ${cut.join('; ')}` : 'not truncated'}\n`);
  return 0;
}
