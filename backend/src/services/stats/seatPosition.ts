/**
 * Window, middle or aisle — from the seat letter AND the cabin it is in
 * (forgejo#256), abstaining wherever the letter alone does not decide.
 *
 * The old table read the last letter as if every aircraft were laid out
 * 3-3 or 3-4-3: F was a window and H a middle seat everywhere. On a 3-4-3
 * wide-body F is a middle seat, on 3-3-3 an aisle; H is a middle seat on
 * 3-3-3 and an aisle on 3-4-3 and 2-4-2. Without the cabin's layout those
 * letters are not knowable, so they are `unknown` — never a guess.
 *
 * What holds across every layout this app meets:
 *
 * | letter | narrow-body (3-3, 2-3, 2-2) | wide-body (3-3-3, 3-4-3, 2-4-2, 2-3-2) |
 * |---|---|---|
 * | A | window | window |
 * | B | middle | middle (only a 3-seat outer block has it) |
 * | C, D | aisle | aisle |
 * | E | middle | middle (the centre block) |
 * | F | window | — (aisle on 3-3-3 and 2-3-2, middle on 3-4-3 and 2-4-2) |
 * | G | — | aisle |
 * | H | — | — (middle on 3-3-3, aisle on 3-4-3 and 2-4-2) |
 * | J | — | middle (the H-J-K block of 3-4-3) |
 * | K | — | window |
 *
 * A premium cabin (business, first) has its own layouts (1-2-1, 2-2-2,
 * staggered): there only A and K are windows and C, D, G aisles, plus F as a
 * narrow-body window — everything else abstains. An aircraft type the app
 * cannot place as narrow- or wide-body uses only the letters both columns
 * agree on; letters G to K exist on wide-bodies alone, so they decide that.
 */

export type SeatPosition = "window" | "middle" | "aisle" | "unknown";
type Body = "narrow" | "wide" | null;

const NARROW =
  /\b(A?31[89]|A?32[01]|A2[01]N|A22[0-3]|BCS|7[13]7|B?73[0-9X]|B?3[89]M|B?75[0-9]|B?717|MD-?8|MD-?9|E-?(JET|1[79]0|1[79]5|19[05]|2)|EMB|ERJ|CRJ|CR[279]|ATR|DH8|DASH|Q[234]00|SAAB|F(OKKER)? ?(70|100)|AVRO|RJ[1-9]|SSJ|SU95)/i;
const WIDE =
  /\b(A?30[0-9]|A?310|A?33[0-9]|A?34[0-9]|A?35[0-9K]|A?38[0-9]|B?74[0-9]|B?76[0-9]|B?77[0-9WL]|B?78[0-9]|DC-?10|MD-?11|IL-?96|L-?1011)/i;

/** Narrow- or wide-body from the stored aircraft type; null when it cannot say. */
export function bodyOf(aircraft: string | null | undefined): Body {
  const name = (aircraft ?? "").replace(/\b(AIRBUS|BOEING)\b/gi, "").trim();
  if (!name) return null;
  if (WIDE.test(name)) return "wide";
  if (NARROW.test(name)) return "narrow";
  return null;
}

const WIDE_ONLY = new Set(["G", "H", "J", "K"]);

export function seatPositionOf(
  letter: string,
  aircraft: string | null | undefined,
  seatClass: string | null | undefined
): SeatPosition {
  const body: Body = WIDE_ONLY.has(letter) ? "wide" : bodyOf(aircraft);
  const premium = seatClass === "business" || seatClass === "first";
  if (letter === "A" || letter === "K") return "window";
  if (letter === "C" || letter === "D") return "aisle";
  if (letter === "G") return body === "wide" ? "aisle" : "unknown";
  if (letter === "F") return body === "narrow" ? "window" : "unknown";
  if (premium) return "unknown";
  if (letter === "B" || letter === "E") return "middle";
  if (letter === "J") return "middle";
  return "unknown";
}
