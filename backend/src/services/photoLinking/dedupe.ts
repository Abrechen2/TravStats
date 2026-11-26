import type { PhotoSourceKind } from "../photoSource";

/** Two captures within this many ms are the same shutter press. */
export const SAME_CAPTURE_MS = 2000;

export interface DedupeItem {
  provider: PhotoSourceKind;
  /** Capture instant in ms, or null when unknown (never matched). */
  takenMs: number | null;
  width?: number | null;
  height?: number | null;
}

/**
 * PhotoPrism holds every photo; Immich only the phone's — the same pictures, a subset
 * (owner, 2026-11-26). An Immich item that PhotoPrism also has is dropped, so a photo never
 * shows twice. "Also has" = captured within {@link SAME_CAPTURE_MS} and, where both sides
 * know their size, the same dimensions (rotation-insensitive). An item with no capture
 * instant is kept: without it nothing can be said.
 */
export function dropImmichDuplicates<T extends DedupeItem>(items: readonly T[]): T[] {
  const prism = items.filter((i) => i.provider === "photoprism" && i.takenMs !== null);
  const sameSize = (a: DedupeItem, b: DedupeItem): boolean => {
    if (!a.width || !a.height || !b.width || !b.height) return true;
    const [a1, a2] = [a.width, a.height].sort((x, y) => x - y);
    const [b1, b2] = [b.width, b.height].sort((x, y) => x - y);
    return a1 === b1 && a2 === b2;
  };
  return items.filter(
    (i) =>
      i.provider !== "immich" ||
      i.takenMs === null ||
      !prism.some((p) => Math.abs(p.takenMs! - i.takenMs!) <= SAME_CAPTURE_MS && sameSize(p, i))
  );
}
