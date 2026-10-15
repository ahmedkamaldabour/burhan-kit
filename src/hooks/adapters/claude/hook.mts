import { emitClaude } from './emit.mjs';
import { normalizeClaude } from './normalize.mjs';

export type CoreRunner = (check: string, stdin: string, env: NodeJS.ProcessEnv) => Promise<string>;

/** Runs normalize -> core -> emit in-process, preserving the adapter's fail-open contract. */
export async function hookClaude(check: string | undefined, stdin: string, env: NodeJS.ProcessEnv, runCore: CoreRunner): Promise<string> {
  try {
    if (!check) return '';
    const event = normalizeClaude(stdin, env);
    if (event === '') return '';
    const output = await runCore(check, event, env);
    if (output === '') return '';
    const parsed: unknown = JSON.parse(event);
    const name = parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as Record<string, unknown>).event : '';
    return typeof name === 'string' ? emitClaude(name, output) : '';
  } catch {
    return '';
  }
}
