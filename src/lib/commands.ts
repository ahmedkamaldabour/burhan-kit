export const CMD_MARK = '<!-- managed by burhan';

/** Managed = the mark is the line `withManagedMark` writes: right after the closing `---` of the front matter.
 *  Quoted in prose, in a code block or mid-line, it is not. */
export function isManagedCommand(text: string): boolean {
  const lines = text.split('\n').map((l) => l.replace(/\r$/, ''));
  if (lines[0] !== '---') return false;
  const close = lines.indexOf('---', 1);
  return close > 0 && (lines[close + 1] ?? '').startsWith(CMD_MARK);
}

/** Insert the managed marker after the front matter (the first `---` line after line 1). */
export function withManagedMark(src: string): string {
  const out: string[] = [];
  let done = false;
  src.split('\n').forEach((line, i) => {
    out.push(line);
    if (!done && i > 0 && line === '---') {
      out.push(`${CMD_MARK} — run \`burhan upgrade\` to update; copy under another name to customise -->`);
      done = true;
    }
  });
  return out.join('\n');
}
