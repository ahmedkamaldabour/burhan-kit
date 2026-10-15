/** apply_patch bodies and shell commands -> the files and skills a Codex turn touched (ports of `patch_files`
 *  and `skill_ids` in normalize.sh). */

export interface PatchFile { kind: 'A' | 'E'; path: string }

const ADD = '*** Add File: ';
const UPDATE = '*** Update File: ';
const MOVE = '*** Move to: ';

/** `A` — the file now exists and is new (Add File, or Update + Move to: the new path); `E` — an existing file changed.
 *  In patch order; deletes give nothing; a path is listed once per kind. Headers only count at column 0. */
export function patchFiles(text: string): PatchFile[] {
  const out: PatchFile[] = [];
  const seen = new Set<string>();
  let pending: PatchFile | null = null;
  const push = (file: PatchFile): void => {
    const id = `${file.kind}\t${file.path}`;
    if (!seen.has(id)) { seen.add(id); out.push(file); }
  };
  const flush = (): void => { if (pending) push(pending); pending = null; };
  for (const line of text.replaceAll('\r', '').split('\n')) {
    if (line.startsWith(ADD)) { flush(); push({ kind: 'A', path: line.slice(ADD.length) }); }
    else if (line.startsWith(UPDATE)) { flush(); pending = { kind: 'E', path: line.slice(UPDATE.length) }; }
    else if (line.startsWith(MOVE)) pending = { kind: 'A', path: line.slice(MOVE.length) };
    else if (line.startsWith('*** ')) flush();
  }
  flush();
  return out;
}

const SKILL_PATH = /[^\s"']*\/SKILL\.md/gu;
const SKILL_RULES: [RegExp, string][] = [
  [/^.*\/plugins\/cache\/[^/]+\/([^/]+)\/[^/]+\/skills\/([^/]+)\/SKILL\.md$/u, '$1:$2'],
  [/^.*\/superpowers\/skills\/([^/]+)\/SKILL\.md$/u, 'superpowers:$1'],
  [/^.*\/skills\/superpowers\/([^/]+)\/SKILL\.md$/u, 'superpowers:$1'],
  [/^.*\/([^/]+)\/SKILL\.md$/u, '$1'],
];

/** Every SKILL.md a command reads, as a skill id; the first rule that matches decides; once each, in order. */
export function skillIds(commands: string[]): string[] {
  const ids: string[] = [];
  for (const command of commands) {
    for (const line of command.split('\n')) {
      for (const [path] of line.matchAll(SKILL_PATH)) {
        const rule = SKILL_RULES.find(([re]) => re.test(path));
        const id = rule ? path.replace(rule[0], rule[1]) : path;
        if (id.trim() !== '' && !ids.includes(id)) ids.push(id);
      }
    }
  }
  return ids;
}
