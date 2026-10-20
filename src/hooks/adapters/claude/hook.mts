import { emitClaude } from './emit.mjs';
import { saveAuditMark } from '../../core/store.mjs';
import { plainProject, prepareClaude, storeEnv } from './normalize.mjs';

export type CoreRunner = (check: string, stdin: string, env: NodeJS.ProcessEnv) => Promise<string>;

/** Runs normalize -> core -> emit in-process, preserving the adapter's fail-open contract. */
export async function hookClaude(check: string | undefined, stdin: string, env: NodeJS.ProcessEnv, runCore: CoreRunner): Promise<string> {
  try {
    if (!check) return '';
    const { event, mark, project, session } = prepareClaude(stdin, env);
    if (event === '') return '';
    const output = await runCore(check, event, env);
    // Audited now: the next Stop of this prompt starts after this one. Saved when the core returned; a gate that threw inside the core is
    // swallowed there (each gate fails open), so that part's audit for that gate is lost rather than repeated.
    if (mark !== null && check === 'turn-audit') saveAuditMark(plainProject(project), session, mark, storeEnv(plainProject(project), env));
    if (output === '') return '';
    const parsed: unknown = JSON.parse(event);
    const name = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).event : '';
    return typeof name === 'string' ? emitClaude(name, output) : '';
  } catch {
    return '';
  }
}
