// How the "overlay" domains are drawn — day tours, roadtrips, rail and rentals.
//
// Those four are not drawn by the map components themselves: each dashboard
// tab builds their deck.gl layers and hands them to `MapContainer3D` as
// `extraLayers`. Their look therefore cannot be threaded down as props the way
// the flight and cruise widths are — the panel that edits it lives inside the
// map, the layers that read it are built outside. One store both read
// (`store/overlayAppearanceStore.ts`) is the only shape where the slider and
// the line cannot disagree, the same answer the colour stores give.
//
// Until forgejo#198 (2026-10-04) these four had no entry in the panel at all:
// every width and size was a constant in the layer builders.
//
// Persisted in the shared `mapAppearance.v2` blob next to the other domains'
// fields. Absence means "default" — every existing blob predates these keys.

/** Every overlay-domain appearance value, resolved (no field optional). */
export interface OverlayAppearance {
  /** Multiplier on a day tour's line width (1 = default). */
  tourLineWidth: number;
  /** Multiplier on a roadtrip's line width (1 = default). */
  roadtripLineWidth: number;
  /** Multiplier on a roadtrip station marker (1 = default, 0 = hidden). */
  roadtripStationSize: number;
  /** Multiplier on a train ride's line width (1 = default). */
  railLineWidth: number;
  /** Multiplier on a rail station marker (1 = default, 0 = hidden). */
  railStationSize: number;
  /** Multiplier on a one-way rental's dashed link width (1 = default). */
  rentalLineWidth: number;
  /** Multiplier on a rental's pick-up/return marker (1 = default, 0 = hidden). */
  rentalMarkerSize: number;
  /**
   * Whether a one-way rental draws its dashed pick-up → return link. Off shows
   * the stations alone (tester ask, forgejo#198). Absent = shown, the
   * behaviour every user had before the switch existed.
   */
  rentalShowLine: boolean;
}

export const DEFAULT_OVERLAY_APPEARANCE: OverlayAppearance = {
  tourLineWidth: 1,
  roadtripLineWidth: 1,
  roadtripStationSize: 1,
  railLineWidth: 1,
  railStationSize: 1,
  rentalLineWidth: 1,
  rentalMarkerSize: 1,
  rentalShowLine: true,
};

/** Slider range for every line-width multiplier — the flight/cruise range. */
export const OVERLAY_WIDTH_RANGE = { min: 0.3, max: 2, step: 0.1 } as const;
/** Slider range for every marker-size multiplier — 0 hides the markers. */
export const OVERLAY_SIZE_RANGE = { min: 0, max: 1.6, step: 0.1 } as const;

type NumericKey = Exclude<keyof OverlayAppearance, "rentalShowLine">;

const RANGE_OF: Record<NumericKey, { min: number; max: number }> = {
  tourLineWidth: OVERLAY_WIDTH_RANGE,
  roadtripLineWidth: OVERLAY_WIDTH_RANGE,
  railLineWidth: OVERLAY_WIDTH_RANGE,
  rentalLineWidth: OVERLAY_WIDTH_RANGE,
  roadtripStationSize: OVERLAY_SIZE_RANGE,
  railStationSize: OVERLAY_SIZE_RANGE,
  rentalMarkerSize: OVERLAY_SIZE_RANGE,
};

function numberFrom(raw: unknown, key: NumericKey): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return DEFAULT_OVERLAY_APPEARANCE[key];
  const { min, max } = RANGE_OF[key];
  return Math.min(max, Math.max(min, raw));
}

/**
 * The overlay appearance from a persisted blob. localStorage is external data:
 * a missing, non-numeric or non-finite value falls back to the default, and an
 * out-of-range number (hand-edited, or a future version's wider slider) is
 * clamped into what the slider can show, so the readout never lies.
 */
export function overlayAppearanceFromStored(stored: Record<string, unknown>): OverlayAppearance {
  const numeric = Object.fromEntries(
    (Object.keys(RANGE_OF) as NumericKey[]).map((key) => [key, numberFrom(stored[key], key)])
  ) as Record<NumericKey, number>;
  return {
    ...numeric,
    rentalShowLine:
      typeof stored.rentalShowLine === "boolean"
        ? stored.rentalShowLine
        : DEFAULT_OVERLAY_APPEARANCE.rentalShowLine,
  };
}
