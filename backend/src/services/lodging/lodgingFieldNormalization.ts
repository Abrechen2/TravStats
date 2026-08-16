import { BOARD_TYPES } from "../../schemas/lodging";

/**
 * Normalising what a language model hands back, before it reaches the schema.
 *
 * Measured over 640 real hotel confirmations: 61 % state the board, 47 % a
 * per-night rate, 42 % the occupancy. None of the three was ever asked for, so
 * `board` — which the 2.6.0 statistics group prices by — was filled by nothing
 * at all.
 */

export type LodgingBoard = (typeof BOARD_TYPES)[number];

/**
 * A model that has no value for a field is supposed to emit JSON `null`. It
 * frequently emits the four characters `null` instead — measured twice on the
 * owner's Armani confirmation, where `country` came back as the string. The
 * display resolver already refuses those words, which is exactly why nobody
 * saw it: the value was invisible and stored anyway.
 *
 * Matched as the WHOLE trimmed value, never as a substring — "Nullarbor
 * Roadhouse" is a real place.
 */
const NOT_A_VALUE = new Set(["null", "undefined", "nil", "none given", "n/a", "na", "-", "--"]);

export function cleanText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return NOT_A_VALUE.has(trimmed.toLowerCase()) ? null : trimmed;
}

/**
 * Board, as printed. Order is the whole trick: every phrase below contains the
 * word "board", and "Halbpension"/"Vollpension" share a suffix — so the
 * specific phrases have to be tested before the generic ones, and
 * all-inclusive before anything else because it is nobody's substring.
 */
const BOARD_PATTERNS: ReadonlyArray<readonly [RegExp, LodgingBoard]> = [
  [/all[\s_-]?inclusive|alles\s+inklusive|\bai\b/i, "all_inclusive"],
  [/halbpension|half[\s-]?board|demi[\s-]?pension|\bhp\b/i, "half"],
  [/vollpension|full[\s-]?board|\bvp\b/i, "full"],
  [/fr(ü|ue)hst(ü|ue)ck|breakfast|bed\s*(and|&)\s*breakfast|\bb\s*&\s*b\b/i, "breakfast"],
  [/ohne\s+verpflegung|room\s*only|nur\s+(die\s+)?(ü|ue)bernachtung|no\s+meals/i, "none"],
];

export function normalizeBoard(value: unknown): LodgingBoard | null {
  const text = cleanText(value);
  if (text === null) return null;

  // Already the wire value (a re-import, or a model that copied the enum).
  const asEnum = BOARD_TYPES.find((b) => b === text.toLowerCase());
  if (asEnum) return asEnum;

  for (const [pattern, board] of BOARD_PATTERNS) {
    if (pattern.test(text)) return board;
  }
  return null;
}

/** Nobody sleeps in a hotel room with fifty people; beyond this it is a misread. */
const MAX_PLAUSIBLE_GUESTS = 20;

/**
 * Total occupancy of the booking, used to prompt for companions — never to
 * invent one. The confirmation states a COUNT ("Adults 2"), not who came
 * along; the name is the user's to supply.
 *
 * A missing children count means none, but a missing adult count means the
 * document did not say — and a stay for nobody is not a stay, so that stays null.
 */
export function normalizeGuestCount(adults: unknown, children: unknown): number | null {
  const asCount = (value: unknown): number | null =>
    typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : null;

  const adultCount = asCount(adults);
  if (adultCount === null) return null;

  const total = adultCount + (asCount(children) ?? 0);
  if (total <= 0 || total > MAX_PLAUSIBLE_GUESTS) return null;
  return total;
}
