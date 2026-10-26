/**
 * The cursor of a truncated TravTrack derivation read (TravTrack plan E2):
 * `<resumeAfter>|<emitAfter>`, both TravTrack positions `<tMs>:<seq>` (empty:
 * the window's start). The next read starts after `resumeAfter`; what it reads
 * up to and including `emitAfter` is context — each device's last good fix,
 * so a run the cut deferred is judged with what came before it — and is never
 * handed on twice. Positions only, no coordinate: the cursor may be stored.
 */
import type { LocationObservation } from "../locationProvider/types";

export type Position = { t: number; seq: bigint };

export type DerivationCursor = {
  /** The provider cursor to read on from; undefined: the window's start. */
  resumeAfter: string | undefined;
  /** Points at or before this are context; null: nothing is. */
  emitAfter: Position | null;
};

const POSITION = /^(\d{1,15}):(\d{1,19})$/;

function parsePosition(s: string): Position | null {
  const match = POSITION.exec(s);
  return match ? { t: Number(match[1]), seq: BigInt(match[2]) } : null;
}

export const positionOf = (o: LocationObservation): string => `${o.atMs}:${o.ref}`;

export function parseDerivationCursor(cursor: string | undefined): DerivationCursor {
  if (!cursor) return { resumeAfter: undefined, emitAfter: null };
  const [resume, emit = resume] = cursor.split("|", 2);
  return { resumeAfter: resume || undefined, emitAfter: parsePosition(emit) };
}

export const formatDerivationCursor = (resumeAfter: string | undefined, emitAfter: string) =>
  `${resumeAfter ?? ""}|${emitAfter}`;

/** At or before `emitAfter`: context the previous read already handed on or masked. */
export function isContext(o: LocationObservation, emitAfter: Position | null): boolean {
  if (!emitAfter) return false;
  if (o.atMs !== emitAfter.t) return o.atMs < emitAfter.t;
  return BigInt(o.ref) <= emitAfter.seq;
}
