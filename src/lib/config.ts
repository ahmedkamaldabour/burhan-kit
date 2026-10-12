// The parser lives with the hooks (they ship without the CLI); the CLI uses the same one.
export { TEAM_CONFIG, LOCAL_CONFIG, parseConfig, readProjectConfig } from '../hooks/core/config.mjs';
export type { ConfigProblem, ParsedConfig } from '../hooks/core/config.mjs';
