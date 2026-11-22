import { prisma } from "../../db";
import type { ProvenanceEntryType, SetProvenanceInput } from "../../schemas/provenance";

export interface ProvenanceState {
  provenance: string | null;
  rememberedOn: string | null;
  rememberedNote: string | null;
}

type Delegate = {
  findFirst(args: {
    where: { id: string; userId: string };
    select: { id: true };
  }): Promise<{ id: string } | null>;
  update(args: {
    where: { id: string };
    data: { provenance: string | null; rememberedOn: Date | null; rememberedNote: string | null };
    select: { provenance: true; rememberedOn: true; rememberedNote: true };
  }): Promise<{
    provenance: string | null;
    rememberedOn: Date | null;
    rememberedNote: string | null;
  }>;
};

/** The Prisma delegate behind each kind. Typed loosely on purpose: all nine share the three columns. */
const delegateOf = (type: ProvenanceEntryType): Delegate =>
  (prisma as unknown as Record<ProvenanceEntryType, Delegate>)[type];

/**
 * Marks an entry of the caller as remembered/recorded, or clears the mark. The three columns
 * are written together so `rememberedOn`/`rememberedNote` can never outlive `remembered`.
 * Returns null when the entry is not the caller's (or does not exist).
 */
export async function setProvenance(
  userId: string,
  type: ProvenanceEntryType,
  id: string,
  input: SetProvenanceInput
): Promise<ProvenanceState | null> {
  const delegate = delegateOf(type);
  if (!(await delegate.findFirst({ where: { id, userId }, select: { id: true } }))) return null;
  const remembered = input.provenance === "remembered";
  // Not a write path of the share loop: provenance is private to the account, never a share fact.
  const row = await delegate.update({
    where: { id },
    data: {
      provenance: input.provenance,
      rememberedOn:
        remembered && input.rememberedOn ? new Date(`${input.rememberedOn}T00:00:00Z`) : null,
      rememberedNote: remembered ? input.rememberedNote || null : null,
    },
    select: { provenance: true, rememberedOn: true, rememberedNote: true },
  });
  return {
    provenance: row.provenance,
    rememberedOn: row.rememberedOn ? row.rememberedOn.toISOString().slice(0, 10) : null,
    rememberedNote: row.rememberedNote,
  };
}
