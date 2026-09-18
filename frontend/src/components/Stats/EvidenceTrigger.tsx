import type { CSSProperties, JSX, ReactNode } from "react";
import { useEvidenceOpen } from "../evidence/useEvidence";
import type { EvidenceScopeParams } from "../evidence/useEvidence";
import type { EvidenceKind } from "../../shared/evidence";

interface EvidenceTriggerProps {
  kind: EvidenceKind;
  evidenceKey: string;
  /** The population THIS tile shows — omit only for the rare measure that is always `allTime` AND never appears anywhere else. */
  scope?: EvidenceScopeParams;
  /** The figure this tile currently displays, in the measure's own unit — feeds the panel's "recomputed" check. */
  renderedValue: number | null;
  /** Names the number for assistive tech; the tile's own visible label is almost always the right string to pass. */
  label: string;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/**
 * Turns a served number into a real `<button>` that opens the evidence
 * panel — keyboard-operable, `aria-haspopup="dialog"` — WITHOUT touching the
 * tile's own layout. Tailwind's preflight zeroes every element's border and
 * background, so a `<button>` carrying the exact className a `<div>` tile
 * already used renders identically; `display` is deliberately left to the
 * caller's OWN className (`flex ...` for a ranking row, the card's default
 * `inline-block` widened by `width: 100%` for a grid tile) rather than
 * forced here, since a hard `display: block` would fight a row that needs
 * `flex` to lay its columns out.
 *
 * Uses `useEvidenceOpen()`, never the full `useEvidence()` — every tile on a
 * page would otherwise run its own fetch effect against the shared
 * `?evidence=` param (see `useEvidence.ts`).
 *
 * A tile whose measure is NOT served (`servedIn: 2`, or no ranking resolver
 * at all — `continent`, tail-number aircraft) must not use this component:
 * GitHub #330 was exactly a card drawing a pointer cursor over nothing
 * clickable.
 */
const BUTTON_RESET: CSSProperties = {
  width: "100%",
  textAlign: "left",
  cursor: "pointer",
};

export default function EvidenceTrigger({
  kind,
  evidenceKey,
  scope,
  renderedValue,
  label,
  children,
  className,
  style,
}: EvidenceTriggerProps): JSX.Element {
  const { open } = useEvidenceOpen();
  return (
    <button
      type="button"
      onClick={() => open(kind, evidenceKey, { scope, renderedValue })}
      aria-haspopup="dialog"
      aria-label={label}
      className={className}
      style={{ ...BUTTON_RESET, ...style }}
    >
      {children}
    </button>
  );
}
