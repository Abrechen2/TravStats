import type { CSSProperties, JSX, ReactNode } from "react";
import EvidenceTrigger from "./EvidenceTrigger";
import type { EvidenceScopeParams } from "../evidence/useEvidence";

interface EvidenceNumberProps {
  evidenceKey: string;
  /** The population the sentence around this number is talking about. */
  scope?: EvidenceScopeParams;
  renderedValue: number | null;
  /** Names the number on its own — the sentence around it is not read out with it. */
  label: string;
  children: ReactNode;
}

/**
 * A number INSIDE a sentence, turned into a trigger without turning the
 * sentence into one.
 *
 * Five served measures were reachable only by URL because they render as a
 * figure in another card's description — the award nights in "23 nights you
 * paid nothing for", the wishlist count, the cities. Making the whole
 * description clickable would claim the sentence is the measure; making the
 * number clickable says exactly what it is.
 *
 * `display: inline` and `width: auto` override `EvidenceTrigger`'s own reset,
 * which widens a button to 100 % — correct for a tile, and a line break in the
 * middle of a sentence here. `color: inherit` keeps the number the colour of
 * the prose it sits in; the dotted underline is what says it can be opened, so
 * a reader who cannot tell the shade apart still has the affordance.
 */
const INLINE_STYLE: CSSProperties = {
  display: "inline",
  width: "auto",
  color: "inherit",
  textAlign: "inherit",
};

export default function EvidenceNumber({
  evidenceKey,
  scope,
  renderedValue,
  label,
  children,
}: EvidenceNumberProps): JSX.Element {
  return (
    <EvidenceTrigger
      kind="metric"
      evidenceKey={evidenceKey}
      scope={scope}
      renderedValue={renderedValue}
      label={label}
      className="underline decoration-dotted underline-offset-2 hover:decoration-solid"
      style={INLINE_STYLE}
    >
      {children}
    </EvidenceTrigger>
  );
}
