/**
 * Text clean-ups an extraction may ask for before it reads (`preprocess`).
 * Matching never sees them: the matcher reads the document as it came.
 *
 * Each step is a plain, total string operation, applied in the order the
 * template lists them.
 */
import type { PreprocessStep } from "./extractionRules";

const ZERO_WIDTH = new RegExp(
  `[${[0x200b, 0x200c, 0x200d, 0x2060, 0xfeff].map((c) => String.fromCharCode(c)).join("")}]`,
  "g"
);
/** A link target a mail client renders inline: `<https://…>`, `<mailto:…>`. */
const LINK = /<(?:https?|mailto):[^>\n]*>/gi;

const mapLines = (text: string, step: (line: string) => string): string =>
  text.split("\n").map(step).join("\n");

const STEPS: Record<PreprocessStep, (text: string) => string> = {
  stripCarriageReturns: (text) => text.replace(/\r/g, ""),
  stripZeroWidth: (text) => text.replace(ZERO_WIDTH, ""),
  // Replaced by a space, so the words on either side stay apart.
  stripLinks: (text) => text.replace(LINK, " "),
  collapseSpaces: (text) => text.replace(/[\t ]+/g, " "),
  stripLeadingPipe: (text) => mapLines(text, (line) => line.replace(/^\|\s*/, "")),
  trimLines: (text) => mapLines(text, (line) => line.trim()),
  dropBlankLines: (text) =>
    text
      .split("\n")
      .filter((line) => line.trim() !== "")
      .join("\n"),
};

export function preprocessText(text: string, steps: readonly PreprocessStep[] | undefined): string {
  return (steps ?? []).reduce((acc, step) => STEPS[step](acc), text);
}
