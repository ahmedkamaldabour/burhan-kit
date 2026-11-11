import { kitMissing, realKitProbe, type KitProbe } from '../../hooks/core/kit-command.mjs';
import { readVersion } from '../kit.js';
import { messages, type Lang } from './messages.js';

/** The "install the kit" block printed before the Step 3 block: empty when the kit command is found. burhan only prints the command; the person runs it. */
export function kitStepLines(target: string, lang: Lang, kit: KitProbe = realKitProbe(), version: string | null = readVersion()): string[] {
  const cmd = kitMissing(target, kit, version);
  return cmd === null ? [] : messages(lang).kitInstall(cmd);
}
