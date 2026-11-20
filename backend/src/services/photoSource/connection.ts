/**
 * The connection of one photo source for a caller — the single switch the
 * trip routes use, so a route never names a resolver of its own.
 */
import type { ImmichConnection } from "../immich/types";
import { getImmichConnection } from "../immich/immichResolver";
import { getPhotoprismConnection } from "../photoprism/photoprismResolver";
import type { PhotoSourceKind } from "./types";

export async function getPhotoSourceConnection(
  kind: PhotoSourceKind,
  userId: string
): Promise<ImmichConnection | null> {
  return kind === "photoprism" ? getPhotoprismConnection(userId) : getImmichConnection(userId);
}

/** Narrow a stored/untrusted provider string; anything unknown is Immich (the column default). */
export function toPhotoSourceKind(value: unknown): PhotoSourceKind {
  return value === "photoprism" ? "photoprism" : "immich";
}
