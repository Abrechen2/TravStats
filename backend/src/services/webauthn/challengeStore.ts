/**
 * WebAuthn challenges, held in memory.
 *
 * In memory on purpose: a challenge lives for two minutes and is worthless
 * afterwards, so persisting it would add a table, a cleanup job and a migration
 * for no gain. The cost is that a restart mid-ceremony makes the user press the
 * button again — the same cost as a dropped network request.
 *
 * Single-process assumption: this instance runs one Node process per container.
 * If that ever changes, this is the piece that has to move to the database.
 */
export const CHALLENGE_TTL_MS = 2 * 60 * 1000;

interface Entry {
  challenge: string;
  expiresAt: number;
}

const entries = new Map<string, Entry>();

function sweep(): void {
  const now = Date.now();
  for (const [key, entry] of entries) {
    if (entry.expiresAt <= now) entries.delete(key);
  }
}

export function putChallenge(key: string, challenge: string): void {
  sweep();
  entries.set(key, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}

/** Read and remove. A challenge answers one ceremony and no more. */
export function takeChallenge(key: string): string | null {
  const entry = entries.get(key);
  entries.delete(key);
  if (!entry || entry.expiresAt <= Date.now()) return null;
  return entry.challenge;
}
