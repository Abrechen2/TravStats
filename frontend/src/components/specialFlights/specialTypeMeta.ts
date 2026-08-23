/**
 * Metadata for the 8 values of Flight.specialType.
 *
 * The icon + colour scheme is shared between:
 *   - FlightsTablePage filter chips
 *   - Row badges in the flight list
 *   - Map layer / legend
 *
 * Colours are expressed as RGB triplets so deck.gl can consume them
 * directly; CSS-facing callers convert via `rgb()` when rendering.
 * Stay in sync with the backend Zod enum in backend/src/schemas/flight.ts.
 */

export type SpecialType =
  "sightseeing" | "eclipse" | "rocket_launch" | "zerog" | "aurora" | "training" | "ferry" | "test";

export const SPECIAL_TYPES: readonly SpecialType[] = [
  "sightseeing",
  "eclipse",
  "rocket_launch",
  "zerog",
  "aurora",
  "training",
  "ferry",
  "test",
] as const;

interface SpecialTypeMeta {
  icon: string;
  /** RGB triplet for deck.gl layers. */
  rgb: [number, number, number];
}

export const SPECIAL_TYPE_META: Record<SpecialType, SpecialTypeMeta> = {
  // Sightseeing — sky-blue loop (🔁)
  sightseeing: { icon: "🔁", rgb: [56, 182, 255] },
  // Eclipse — lunar grey + blue (🔭)
  eclipse: { icon: "🔭", rgb: [148, 163, 184] },
  // Rocket launch — ignition orange (🚀)
  rocket_launch: { icon: "🚀", rgb: [249, 115, 22] },
  // ZeroG — violet for the parabola curve. Icon matches the TypePicker
  // card so the same 🌀 appears on picker, row badge, filter chip, and
  // map legend for a consistent visual identity across the app.
  zerog: { icon: "🌀", rgb: [168, 85, 247] },
  // Aurora — green (🌌)
  aurora: { icon: "🌌", rgb: [34, 197, 94] },
  // Training / school flight — muted teal (🎓)
  training: { icon: "🎓", rgb: [20, 184, 166] },
  // Ferry / repositioning — purple arrow (➡)
  ferry: { icon: "➡", rgb: [139, 92, 246] },
  // Test / check flight — yellow wrench (🔧)
  test: { icon: "🔧", rgb: [234, 179, 8] },
};

export function rgbToCss(rgb: readonly [number, number, number], alpha = 1): string {
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

/**
 * What the flights list is filtered down to: everything, only ordinary
 * flights, every special one, or one particular kind. It lived in the chip-row
 * component that used to sit above the table; the filter is a control in the
 * list's filter panel now, and the chip row is gone.
 */
export type SpecialTypeFilter = "all" | "standard" | "special" | SpecialType;
