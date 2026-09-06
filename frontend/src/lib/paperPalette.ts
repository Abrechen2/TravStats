import { rgb, tokens } from "../theme/tokens";

/**
 * The one paper colour, for the two documents that are printed.
 *
 * TravStats is dark, with exactly one light surface: paper. The flight
 * certificate carried a six-value palette of its own — a parchment, two inks, a
 * bronze and a stamp red — and the passport is the app's OTHER piece of paper.
 * Two documents, two papers, neither of them the one in the token file. This
 * module is the one the round-2 review asked for (§7.7: "Zwei Dokumente, eine
 * Papierfarbe"), and it is where the passport will read from when it becomes
 * light too.
 *
 * The values are resolved to literal strings rather than `var(--ts-paper)`,
 * deliberately: the certificate is rasterised by html2canvas, and handing a
 * rasteriser real values instead of custom properties removes a whole class of
 * "looks right, exports blank". Single-sourced all the same — they come from
 * the generated token module, not from here.
 */

/** The ink at a given opacity. Keeps a document to ONE ink, at two weights. */
export function inkAlpha(alpha: number): string {
  const [r, g, b] = rgb(tokens.color.paperText);
  return `rgba(${r},${g},${b},${alpha})`;
}

export const PAPER = {
  /** The sheet. */
  sheet: tokens.color.paper,
  /** Everything written on it. */
  ink: tokens.color.paperText,
  /** The same ink, quieter — a label, a rule, a caption. */
  inkSoft: inkAlpha(0.7),
  /** A shadow cast by the sheet, in its own ink rather than in black. */
  shadow: inkAlpha(0.08),
  /** The brand amber in its pressed shade: legible on a light ground. */
  accent: tokens.color.accentPressed,
  /** The hover shade of the same amber. */
  accentHover: tokens.color.accent,
  /** A stamp is not an error, but it is the one red the system has. */
  stamp: tokens.color.bad,
} as const;
