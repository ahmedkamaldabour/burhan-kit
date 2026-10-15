/** Where a project's hooks are installed: `<project>/.burhan/hooks/node/main.mjs`. hook.sh derives the project from
 *  its own install path (Codex may be started from a subdirectory, so the payload's cwd is not the project). */
export function installRoot(entryFile: string): string {
  const path = entryFile.replaceAll('\\', '/');
  const tail = '/.burhan/hooks/node/main.mjs';
  return path.endsWith(tail) ? path.slice(0, -tail.length) : '';
}
