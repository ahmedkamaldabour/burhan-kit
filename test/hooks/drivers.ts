import { run } from '../../src/hooks/main.mjs';

/** One hook call: returns stdout. `label` names the implementation in failure messages. */
export type Driver = ((argv: string[], stdin: string, env: NodeJS.ProcessEnv) => Promise<string>) & { label: 'node' };

/** The Node hooks, in process. A swallowed error (fail open) is a bug in a corpus run, so it fails the case. */
export const nodeDriver: Driver = Object.assign(async (argv: string[], stdin: string, env: NodeJS.ProcessEnv) => {
  const result = await run(argv, stdin, env);
  if (result.debug !== '') throw new Error(`the Node hook swallowed an error: ${result.debug.split('\n')[0]}`);
  return result.stdout;
}, { label: 'node' as const });
