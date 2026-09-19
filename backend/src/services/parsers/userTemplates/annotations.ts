/**
 * What an annotation IS, and the one piece of reading every deriver needs:
 * the label the sender printed beside the value the user marked.
 *
 * Extracted from `deriver.ts` in forgejo#124 phase 6, because the lodging
 * deriver needs exactly the same reading and a second copy of it is how the
 * two `continents.ts` copies drifted ("carried a 'keep both in sync' comment
 * and had already drifted").
 */

export interface AnnotationSelection {
  start: number;
  end: number;
  text: string;
  label: string;
  /** Flight domain only: which of several flights in one mail this belongs to. */
  flightIndex?: number;
}

export function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** How far back a label may sit. A label further away than this is not one. */
const CONTEXT_BEFORE = 80;

export interface LabelContext {
  /** The sender's own wording for this field, trimmed. */
  label: string;
  /**
   * True when the value begins its own line, so the label is the line ABOVE
   * it. That is the case the phase 4 engine reads by walking (`readStacked`)
   * rather than by regex.
   */
  stacked: boolean;
}

/**
 * The label belonging to the value at `offset`, and whether it stands above
 * the value or beside it.
 *
 * Returns null when there is no text before the value at all — a value with
 * no label has nothing to anchor a pattern to, and an unanchored capture
 * matches the first thing of that shape anywhere in the document.
 */
export function labelContextOf(fullText: string, offset: number): LabelContext | null {
  const before = fullText.slice(Math.max(0, offset - CONTEXT_BEFORE), offset);
  const currentLine = before.slice(before.lastIndexOf("\n") + 1);

  if (currentLine.trim().length > 0) {
    return { label: currentLine.trim(), stacked: false };
  }

  const previous = before
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .pop();
  if (!previous) return null;
  return { label: previous.trim(), stacked: true };
}
