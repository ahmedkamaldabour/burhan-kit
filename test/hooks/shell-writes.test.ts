import assert from 'node:assert/strict';
import { test } from 'node:test';
import { shellWrites } from '../../src/hooks/core/shell-writes.mjs';

type Case = { name: string; cmds: string[]; want: string[] };

// Literal expectations of the shell-writes heuristic (the contract of the 0.2 awk script, which no longer ships).
const CASES: Case[] = [
  { name: 'plain, append, clobber, and stdout redirections', cmds: ['echo x > out.txt', 'echo x >> append.txt', 'echo x >| clobber.txt', 'echo x 1> stdout.txt'], want: ['out.txt', 'append.txt', 'clobber.txt', 'stdout.txt'] },
  { name: 'combined stdout and stderr redirections', cmds: ['run &> both.txt', 'run &>> both-append.txt'], want: ['both.txt', 'both-append.txt'] },
  { name: 'tee writes every target, including quoted and append targets', cmds: ['echo x | tee first.txt second.txt', 'echo x | tee -a "my notes.txt" \'a > b.txt\''], want: ['first.txt', 'second.txt', 'my notes.txt', 'a > b.txt'] },
  { name: 'stderr redirects and duplicate descriptors are ignored', cmds: ['ls 2> errors.txt', 'run >&2', 'run 2>&1'], want: [] },
  { name: 'device, numeric comparison, arrows, and assignments are ignored', cmds: ['grep x a.src > /dev/null', '[ 3 > 2 ]', 'a -> b.txt', 'x => b.txt'], want: [] },
  { name: 'redirection-looking text in quotes, brackets, and here-strings is ignored', cmds: ['echo "a > b.txt"', 'git commit -m "fix: a > b.txt"', 'node -e "x=>b.txt"', '[[ $a > b.txt ]]', 'cat <<< "x > y.txt"'], want: [] },
  { name: 'heredoc bodies are ignored but the heredoc target is counted', cmds: ["cat > notes.txt <<'EOF'\n> hidden.txt\nEOF", "cat > a.src <<'EOF'\nx\nEOF"], want: ['notes.txt', 'a.src'] },
  { name: 'tab-stripped heredoc bodies are ignored', cmds: ['cat > tabbed.txt <<-EOF\n\t> hidden-tab.txt\n\tEOF'], want: ['tabbed.txt'] },
  { name: 'arithmetic comparisons and escaped redirect-like text are ignored', cmds: ['$((3>2))', 'echo \\> not-a-redirect.txt'], want: [] },
  { name: 'escaped spaces and escaped greater-than signs stay in targets', cmds: ['echo x > my\\ file.txt', 'echo x > a\\>b.txt'], want: ['my file.txt', 'a>b.txt'] },
  { name: 'multi-line commands preserve redirect order', cmds: ['echo x > first.txt\nprintf y >> second.txt'], want: ['first.txt', 'second.txt'] },
  { name: 'several commands preserve appearance order', cmds: ['echo x > one.txt', 'echo x | tee two.txt three.txt', 'echo x >> four.txt'], want: ['one.txt', 'two.txt', 'three.txt', 'four.txt'] },
  { name: 'repeated raw targets are not deduplicated', cmds: ['echo x > same.txt', 'echo y >> same.txt'], want: ['same.txt', 'same.txt'] },
  { name: 'an empty command list writes nothing', cmds: [], want: [] },

  // Every command in tests/core/turn-audit.test.sh's shell-write section.
  { name: 'turn-audit: printf append to a story', cmds: ['printf %s\\n note >> .burhan/work/foo/foo-story.md && tail -3 .burhan/work/foo/foo-story.md'], want: ['.burhan/work/foo/foo-story.md'] },
  { name: 'turn-audit: tee append to the state file', cmds: ['echo x | tee -a .burhan/local/PROGRESS.md'], want: ['.burhan/local/PROGRESS.md'] },
  { name: 'turn-audit: heredoc code file', cmds: ['cat > a.src <<EOF\nx\nEOF'], want: ['a.src'] },
  { name: 'turn-audit: stderr device redirect', cmds: ['ls 2>/dev/null'], want: [] },
  { name: 'turn-audit: stdout device redirect', cmds: ['grep x a.src > /dev/null'], want: [] },
  { name: 'turn-audit: bracket comparison', cmds: ['[ 3 > 2 ]'], want: [] },
  { name: 'turn-audit: quoted echo', cmds: ['echo "a > b.src"'], want: [] },
  { name: 'turn-audit: quoted commit message', cmds: ['git commit -m "fix: a > b.src"'], want: [] },
  { name: 'turn-audit: quoted JavaScript arrow', cmds: ['node -e "x=>b.src"'], want: [] },
  { name: 'turn-audit: double-bracket comparison', cmds: ['[[ $a > b.src ]]'], want: [] },
  { name: 'turn-audit: here-string', cmds: ['cat <<< "x > y.src"'], want: [] },
  { name: 'turn-audit: heredoc body redirect-like line', cmds: ["cat > notes.txt <<'EOF'\n> .burhan/work/foo/foo-story.md quoted\nEOF"], want: ['notes.txt'] },
  { name: 'turn-audit: heredoc target', cmds: ["cat > a.src <<'EOF'\nx\nEOF"], want: ['a.src'] },
  { name: 'turn-audit: combined redirect', cmds: ['run &> a.src'], want: ['a.src'] },
  { name: 'turn-audit: clobber redirect', cmds: ['echo x >| a.src'], want: ['a.src'] },
  { name: 'turn-audit: stdout descriptor redirect', cmds: ['echo x 1> a.src'], want: ['a.src'] },
  { name: 'turn-audit: quoted target', cmds: ['echo x > "my a.src"'], want: ['my a.src'] },
  { name: 'turn-audit: tee with two targets', cmds: ['echo x | tee -a notes.txt a.src'], want: ['notes.txt', 'a.src'] },
];

test('shellWrites: the shell-writes contract', () => {
  for (const { name, cmds, want } of CASES) assert.deepEqual(shellWrites(cmds), want, name);
});
