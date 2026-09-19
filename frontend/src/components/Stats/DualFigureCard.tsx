import type { CSSProperties, JSX, ReactNode } from "react";
import EvidenceTrigger from "./EvidenceTrigger";
import { STAT_CARD_CLASS, STAT_CARD_STYLE, STAT_VALUE_CLASS, type StatValueSize } from "./StatCard";
import type { EvidenceKind } from "../../shared/evidence";
import type { EvidenceScopeParams } from "../evidence/useEvidence";

export interface DualFigure {
  kind: EvidenceKind;
  evidenceKey: string;
  /** The population THIS figure shows — the same one the section's label claims. */
  scope?: EvidenceScopeParams;
  /** The figure in the measure's own unit, for the panel's "recomputed" check. */
  renderedValue: number | null;
  /** What the figure says on screen — "12E", "3", … Formatting belongs to the caller. */
  display: ReactNode;
  /** Names THIS figure — the whole point of splitting the card, so it is required. */
  label: string;
}

interface DualFigureCardProps {
  title: string;
  first: DualFigure;
  second: DualFigure;
  /** Drawn between the two figures on a wide screen. Plain text, never a button. */
  separator?: string;
  description: ReactNode;
  footnote?: ReactNode;
  valueSize?: StatValueSize;
  /** CSS colour for both figures. Defaults to the brand accent, as `StatCard` does. */
  accent?: string;
}

/**
 * ONE card showing TWO figures, each opening its own evidence panel.
 *
 * Four cards used to render a pair of served numbers as a single string —
 * "12E / 8W", "3 / 5" — and a `StatCard` opens ONE panel, so eight registered,
 * resolver-backed measures had no trigger anywhere on screen. The owner's
 * ruling of 2026-09-19 was to split them: the card stays one card, the
 * INTERACTION becomes two.
 *
 * Two details carry the design:
 *
 *  - The separator is `aria-hidden` and drawn only from `sm` up. Below that the
 *    figures stack, and a slash on a line of its own between two stacked
 *    numbers reads as a fraction rather than a pair. Stacked, each figure gets
 *    its own caption instead — "3" over "Fully covered trips" is unambiguous
 *    where a bare "3" over "5" is not.
 *  - Each trigger sets `display: inline-flex` and `width: auto`.
 *    `EvidenceTrigger` deliberately leaves `display` to its caller and its own
 *    reset widens a button to 100 %, which is right for a whole-card trigger
 *    and wrong for two figures that must sit side by side.
 */
const FIGURE_STYLE: CSSProperties = { display: "inline-flex", width: "auto" };

function Figure({
  figure,
  valueSize,
  accent,
}: {
  figure: DualFigure;
  valueSize: StatValueSize;
  accent: string;
}): JSX.Element {
  return (
    <span className="flex flex-col items-start">
      <EvidenceTrigger
        kind={figure.kind}
        evidenceKey={figure.evidenceKey}
        scope={figure.scope}
        renderedValue={figure.renderedValue}
        label={figure.label}
        className={`font-bold ${STAT_VALUE_CLASS[valueSize]}`}
        style={{ ...FIGURE_STYLE, color: accent }}
      >
        {figure.display}
      </EvidenceTrigger>
      {/*
        `aria-hidden`, because the button already carries this exact string as
        its `aria-label` at every width. Without it a screen reader announces
        each figure's name twice below `sm` — the caption exists for the EYE,
        which loses the pairing when the slash disappears.
      */}
      <span aria-hidden="true" className="text-xs sm:hidden" style={{ color: "var(--text-muted)" }}>
        {figure.label}
      </span>
    </span>
  );
}

export default function DualFigureCard({
  title,
  first,
  second,
  separator = "/",
  description,
  footnote,
  valueSize = "sm",
  accent = "var(--accent)",
}: DualFigureCardProps): JSX.Element {
  return (
    <div className={STAT_CARD_CLASS} style={STAT_CARD_STYLE}>
      <h3 className="mb-2 text-sm font-medium" style={{ color: "var(--text-muted)" }}>
        {title}
      </h3>
      <div
        data-testid="dual-figure-row"
        className="mb-1 flex flex-col items-start gap-1 sm:flex-row sm:items-baseline sm:gap-2"
      >
        <Figure figure={first} valueSize={valueSize} accent={accent} />
        <span
          aria-hidden="true"
          className={`hidden font-bold sm:inline ${STAT_VALUE_CLASS[valueSize]}`}
          style={{ color: "var(--text-muted)" }}
        >
          {separator}
        </span>
        <Figure figure={second} valueSize={valueSize} accent={accent} />
      </div>
      <p className="text-sm opacity-75">{description}</p>
      {footnote && <p className="mt-2 text-xs opacity-60">{footnote}</p>}
    </div>
  );
}
