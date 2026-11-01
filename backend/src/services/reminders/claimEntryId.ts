/**
 * The entry id a claim is kept under. An entry with two reminder anchors (a
 * rental: pick-up and return) claims each under its own part, so the two never
 * dedupe each other; the push payload and every other reader keep the plain id.
 */
export const claimEntryId = (entryId: string, part?: string): string =>
  part ? `${entryId}#${part}` : entryId;
