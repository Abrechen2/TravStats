import type { JSX, ReactNode } from "react";
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
  valueSize?: "sm" | "md" | "lg";
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
}

const VALUE_CLASS: Record<NonNullable<StatCardProps["valueSize"]>, string> = {
  sm: "text-2xl",
  md: "text-3xl",
  lg: "text-4xl",
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
}: StatCardProps): JSX.Element {
  const className = "rounded-lg border p-6 shadow-md";
  const style = {
    background: "var(--bg-elevated)",
    borderColor: "var(--color-border)",
    color: "var(--text-primary)",
  };
  const body = (
    <>
      <h3 className="mb-2 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      <p className={`mb-1 font-bold ${VALUE_CLASS[valueSize]}`} style={{ color: accent }}>
        {value}
      </p>
      <p className="text-sm opacity-75">{description}</p>
      {footnote && <p className="mt-2 text-xs opacity-60">{footnote}</p>}
    </>
  );

  if (evidence) {
    return (
      <EvidenceTrigger
        kind={evidence.kind}
        evidenceKey={evidence.key}
        scope={evidence.scope}
        renderedValue={evidence.renderedValue}
        label={title}
        className={className}
        style={style}
      >
        {body}
      </EvidenceTrigger>
    );
  }

  return (
    <div className={className} style={style}>
      {body}
    </div>
  );
}
