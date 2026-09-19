/**
 * A mark, and the one invariant it has to keep: its offsets cut its own value
 * out of the text that gets SAVED.
 *
 * The annotation view broke that twice over, in ways nothing could see
 * (beta audit follow-up, 2026-09-19):
 *
 *  1. It measured `start`/`end` against the text on screen and then saved
 *     `filterEmailText(original)` regardless. With the filter switched off
 *     the two are different documents, so every offset was shifted and the
 *     deriver read label context from the wrong place — silently, because a
 *     wrong label still produces a plausible-looking template.
 *  2. It trimmed the selected TEXT without moving the offsets with it, so a
 *     selection that caught a leading newline stored a value the offsets did
 *     not point at. `labelContextOf` then looked back from the whitespace and
 *     found the previous line's label for a value that had one of its own.
 *
 * Both are the same defect: two representations of one mark, allowed to
 * disagree. `markFromSelection` is where they are made to agree, and the
 * annotate route refuses a payload where they do not.
 */

export interface TextMark {
  start: number;
  end: number;
  text: string;
  label: string;
  flightIndex?: number;
}

/**
 * The mark for a raw browser selection over `displayText`.
 *
 * Returns null when the selection holds nothing but whitespace — there is no
 * value to store, and a zero-length mark would anchor a pattern to nothing.
 */
export function markFromSelection(
  displayText: string,
  selection: { start: number; end: number; label: string; flightIndex?: number }
): TextMark | null {
  const raw = displayText.slice(selection.start, selection.end);
  const text = raw.trim();
  if (text.length === 0) return null;
  const start = selection.start + (raw.length - raw.trimStart().length);
  return {
    start,
    end: start + text.length,
    text,
    label: selection.label,
    ...(selection.flightIndex !== undefined ? { flightIndex: selection.flightIndex } : {}),
  };
}

/** Does every mark still cut its own value out of `fullText`? */
export function marksAlign(fullText: string, marks: readonly TextMark[]): boolean {
  return marks.every((mark) => fullText.slice(mark.start, mark.end) === mark.text);
}
