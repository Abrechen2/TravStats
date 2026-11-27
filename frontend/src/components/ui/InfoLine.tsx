import type { CSSProperties, JSX, ReactNode } from "react";
import Toggletip from "./Toggletip";

export interface InfoLineProps {
  /** The one line everyone reads: what this is or does, in plain words (≤ ~90 characters). */
  text: ReactNode;
  /** The rest, for whoever asks: shown behind an ⓘ toggletip, never inline. */
  more?: ReactNode;
  /** What the help is about, so the trigger is not the tenth anonymous "Hilfe". */
  subject?: string;
  className?: string;
  style?: CSSProperties;
  "data-testid"?: string;
}

/**
 * Inline help in one line, the detail behind an ⓘ (owner, 2026-11-26: "nobody
 * reads the big text blocks").
 *
 * Before this, an explanation that a rule asked for — why a figure is missing,
 * how something is counted, what leaves the server — was met with a paragraph
 * under the control. Forty of them on one settings page read as a wall nobody
 * reads, so the sentence that mattered was lost with the rest. The rule now:
 * the line says the essential thing; anything longer goes into `more`.
 *
 * Not for warnings, confirmations or error reasons: those stay visible in full
 * ("Fehler immer sichtbar") and are shortened, not hidden.
 */
export default function InfoLine({
  text,
  more,
  subject,
  className = "t-caption",
  style,
  "data-testid": testId,
}: InfoLineProps): JSX.Element {
  return (
    <p className={className} style={style} data-testid={testId}>
      {text}
      {more ? (
        <>
          {" "}
          <Toggletip content={more} subject={subject} className="align-middle" />
        </>
      ) : null}
    </p>
  );
}
