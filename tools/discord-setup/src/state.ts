import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
export const STATE_PATH = join(here, "..", ".state.json");

export interface SetupState {
  readonly guildId: string;
  readonly rulesMessageId: string | null;
}

export function readState(): SetupState[] {
  if (!existsSync(STATE_PATH)) return [];
  const raw = readFileSync(STATE_PATH, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(
    (e): e is SetupState =>
      typeof e === "object" &&
      e !== null &&
      typeof (e as { guildId?: unknown }).guildId === "string" &&
      (typeof (e as { rulesMessageId?: unknown }).rulesMessageId === "string" ||
        (e as { rulesMessageId?: unknown }).rulesMessageId === null),
  );
}

export function writeState(next: SetupState): void {
  const others = readState().filter((e) => e.guildId !== next.guildId);
  writeFileSync(STATE_PATH, JSON.stringify([...others, next], null, 2), "utf8");
}
