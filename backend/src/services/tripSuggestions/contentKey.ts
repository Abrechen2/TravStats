/**
 * A key for an entry that survives losing its id.
 *
 * An answer remembers its members as `domain:id`. Delete a flight and import it
 * again and the id is new, so the answered proposal no longer recognises it and
 * the question comes back. The label is what the user recognises ("LH 1790 MUC
 * → LIS", "Hotel Avenida") and is built from content, never from an id; with the
 * domain and the day it names the same real-world thing before and after a
 * re-import.
 */
export function contentKey(domain: string, day: string, label: string): string {
  return `${domain}|${day}|${label.trim().replace(/\s+/g, " ").toLowerCase()}`;
}
