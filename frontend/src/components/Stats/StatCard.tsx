import type { CSSProperties, JSX, ReactNode } from "react";
import EvidenceTrigger from "./EvidenceTrigger";
import type { EvidenceKind } from "../../shared/evidence";
import type { EvidenceScopeParams } from "../evidence/useEvidence";

interface StatCardEvidence {
  kind: EvidenceKind;
  key: string;
  scope?: EvidenceScopeParams;
  renderedValue: number | null;
}

interface StatCardProps {
  title: string;
  value: ReactNode;
  description: ReactNode;
  footnote?: ReactNode;
  valueSize?: StatValueSize;
  /**
   * CSS colour for the big number. Defaults to the brand accent (amber), which
   * is the flight domain's identity. Per-domain screens pass their own token —
   * `var(--domain-lodging)` and friends — so a lodging figure is not dressed in
   * the flight colour.
   */
  accent?: string;
  title2?: never;
  /** Present only when this card's number is a served evidence measure (Task 9) — omitted, the card stays a plain `<div>`, exactly as before. */
  evidence?: StatCardEvidence;
  /**
   * Set where the DESCRIPTION carries a trigger of its own, which only happens
   * on a card that is also `evidence`-wired. Without it the two nest, and a
   * `<button>` inside a `<button>` is both invalid HTML and broken: the inner
   * click bubbles to the card, so the last `open()` to run is the card's and
   * the inline number silently opens the wrong measure. Measured on the places
   * tab, where `placeWishlistCount` opened `placesVisitedCount` instead.
   */
  descriptionHasOwnTrigger?: boolean;
}

export type StatValueSize = "sm" | "md" | "lg";

export const STAT_VALUE_CLASS: Record<StatValueSize, string> = {
  sm: "text-2xl",
  md: "text-3xl",
  lg: "text-4xl",
};

/**
 * The card SHELL, exported because `DualFigureCard` draws the same card around
 * two triggers instead of one. Two literals would be two chances to drift, and
 * a split card that no longer matches the cards beside it reads as a bug in the
 * data rather than in the layout.
 */
export const STAT_CARD_CLASS = "rounded-lg border p-6 shadow-md";

export const STAT_CARD_STYLE: CSSProperties = {
  background: "var(--bg-elevated)",
  borderColor: "var(--color-border)",
  color: "var(--text-primary)",
};

// Unified stat card for the AdvancedStats screen. Replaces a sprawl of
// per-card `from-X to-Y` Tailwind gradients (BRAND.md §7 anti-pattern).
// All cards share the dark elevated surface; the big number uses the
// brand accent so flight-domain stats reinforce the amber identity.
export default function StatCard({
  title,
  value,
  description,
  footnote,
  valueSize = "lg",
  accent = "var(--accent)",
  evidence,
  descriptionHasOwnTrigger = false,
}: StatCardProps): JSX.Element {
  const className = STAT_CARD_CLASS;
  const style = STAT_CARD_STYLE;
  const heading = (
    <>
      <h3 className="mb-2 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      <p className={`mb-1 font-bold ${STAT_VALUE_CLASS[valueSize]}`} style={{ color: accent }}>
        {value}
      </p>
    </>
  );
  const prose = (
    <>
      <p className="text-sm opacity-75">{description}</p>
      {footnote && <p className="mt-2 text-xs opacity-60">{footnote}</p>}
    </>
  );

  if (evidence) {
    const trigger = (
      <EvidenceTrigger
        kind={evidence.kind}
        evidenceKey={evidence.key}
        scope={evidence.scope}
        renderedValue={evidence.renderedValue}
        label={title}
        className={descriptionHasOwnTrigger ? "block" : className}
        style={descriptionHasOwnTrigger ? undefined : style}
      >
        {heading}
        {!descriptionHasOwnTrigger && prose}
      </EvidenceTrigger>
    );
    // Preflight leaves the inner button borderless and transparent, so the
    // card looks the same either way; what shrinks is the hit area, down to
    // the figure the card is named after — which is what the description
    // having its own trigger means.
    return descriptionHasOwnTrigger ? (
      <div className={className} style={style}>
        {trigger}
        {prose}
      </div>
    ) : (
      trigger
    );
  }

  return (
    <div className={className} style={style}>
      {heading}
      {prose}
    </div>
  );
}
