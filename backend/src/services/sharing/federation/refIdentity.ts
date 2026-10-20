/**
 * What a catalogue reference in a `fact-update` IS, for the precondition (F-S4d review).
 *
 * Comparing the resolved local ids alone made two references this catalogue cannot match equal
 * — both resolve to null — so a change from one unknown ship to another was acknowledged as
 * already held, and the copy kept the old ship's name. A reference whose miss leaves a name on
 * the copy is therefore compared by what it names: its local id when it resolves here, else the
 * name the copy keeps for it (and the sender's reference by its own name).
 *
 * Only the cruise's ship leaves such a name (`shipNameOverride`). The other references have no
 * place on the copy that a miss could fill — a cruise's departure and arrival port, a rail
 * station and a rental airport resolve to an id or to nothing, their names travel as facts of
 * their own (`depStationName`, `pickupStationName`, …) and are compared as such; a port call
 * keeps its port's name as `unresolvedPortName` inside the compared stop list already.
 */
import type { ShareEntity } from "../shareTypes";

export interface NamedReference {
  /** The wire key (`ship`), the local id fact (`shipId`) and the fact that keeps its name. */
  wire: string;
  id: string;
  name: string;
}

export const NAMED_REFERENCES: Readonly<Partial<Record<ShareEntity, readonly NamedReference[]>>> = {
  cruise: [{ wire: "ship", id: "shipId", name: "shipNameOverride" }],
};

export const namedReference = (entity: ShareEntity, idKey: string): NamedReference | undefined =>
  NAMED_REFERENCES[entity]?.find((r) => r.id === idKey);

const refName = (wire: unknown): string | null => {
  const name = (wire as { name?: unknown } | null)?.name;
  return typeof name === "string" && name !== "" ? name : null;
};

/** A sent reference: its id here if it resolves, else the name it carries. */
export function sentIdentity(localId: unknown, wire: unknown): string {
  if (localId !== null && localId !== undefined) return `id:${String(localId)}`;
  const name = refName(wire);
  return name ? `name:${name}` : "none";
}

/** The copy's reference: its id, else the name it keeps for an unmatched one. */
export function heldIdentity(facts: Record<string, unknown>, ref: NamedReference): string {
  const id = facts[ref.id];
  if (id !== null && id !== undefined) return `id:${String(id)}`;
  const name = facts[ref.name];
  return typeof name === "string" && name !== "" ? `name:${name}` : "none";
}

/**
 * The name fact to write with a reference: the new name when it does not resolve here; cleared
 * when it now resolves and the copy's name was only the old reference's fallback.
 */
export function nameToWrite(
  ref: NamedReference,
  copy: Record<string, unknown>,
  afterId: unknown,
  beforeWire: unknown,
  afterWire: unknown
): { write: boolean; value: string | null } {
  if (afterId === null || afterId === undefined) return { write: true, value: refName(afterWire) };
  const fallback = refName(beforeWire);
  return copy[ref.name] !== null && copy[ref.name] === fallback
    ? { write: true, value: null }
    : { write: false, value: null };
}
