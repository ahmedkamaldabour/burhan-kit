export const CMD_MARK = '<!-- managed by burhan';

export const isManagedCommand = (text: string): boolean => text.includes(CMD_MARK);

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
