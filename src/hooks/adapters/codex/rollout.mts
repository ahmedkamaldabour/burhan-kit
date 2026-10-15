import { closeSync, openSync, readSync, statSync } from 'node:fs';

export interface CommandExit { exit: unknown; status: unknown }

/** Calls `each` for every line of the file that contains `needle`, reading in chunks (a rollout can be large). */
function forEachLineWith(path: string, needle: string, each: (line: string) => void): void {
  let fd: number | undefined;
  try {
    if (!statSync(path).isFile()) return;
    fd = openSync(path, 'r');
    const chunk = Buffer.allocUnsafe(1 << 20);
    let carry = Buffer.alloc(0);
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      const data = Buffer.concat([carry, chunk.subarray(0, n)]);
      const cut = data.lastIndexOf(0x0a);
      if (cut < 0) { carry = data; continue; }
      for (const line of data.subarray(0, cut).toString('utf8').split('\n')) if (line.includes(needle)) each(line);
      carry = data.subarray(cut + 1);
    }
    const last = carry.toString('utf8');
    if (last.includes(needle)) each(last);
  } catch { /* an unreadable rollout leaves exits unknown */ } finally {
    if (fd !== undefined) try { closeSync(fd); } catch { /* fail open */ }
  }
}

const object = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

/** tool_use_id -> the exit code and status the rollout recorded (CommandExecution items); {} when unreadable. */
export function rolloutExits(path: string): Map<string, CommandExit> {
  const exits = new Map<string, CommandExit>();
  if (path === '') return exits;
  forEachLineWith(path, '"CommandExecution"', (line) => {
    try {
      const record = object(JSON.parse(line.replaceAll('\0', '')));
      const payload = object(record?.payload);
      const item = object(payload?.item);
      if (record?.type !== 'event_msg' || payload?.type !== 'item_completed' || item?.type !== 'CommandExecution' || !item) return;
      const id = item.id;
      exits.set(id === null || id === undefined || id === false ? '' : typeof id === 'string' ? id : JSON.stringify(id), { exit: item.exit_code ?? null, status: item.status ?? null });
    } catch { /* an unparseable line is skipped */ }
  });
  return exits;
}
