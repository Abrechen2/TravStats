import type { JSX } from "react";
import Sparkline from "./Sparkline";
import TrendDelta from "../TrendDelta";
import EvidenceTrigger from "../EvidenceTrigger";
import type { EvidenceKind } from "../../../shared/evidence";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";

export interface ScorecardTileVM {
  key: string;
  label: string;
  value: string;
  takeaway: string;
  points: number[];
  current: number;
  previous: number;
  /**
   * Set when the two numbers do NOT cover the same span, and says so. The pill
   * is otherwise bare — an arrow and a percentage with nothing naming what it
   * was measured against — which is exactly how "-78 %" came to read as a
   * collapse in travel when it was four months that had not happened yet.
   */
  compareLabel?: string;
  /** Present when this tile's number is a served evidence measure — every scorecard tile currently is (Task 9). */
  evidence?: { kind: EvidenceKind; key: string; scope: EvidenceScopeParams };
}

// Hero KPI tile: big value + one-line takeaway (HIG), label-free sparkline
// (HIG sneak-peek), and a delta vs. the previous window (Few: current values
// need history).
export default function ScorecardTile({
  label,
  value,
  takeaway,
  points,
  current,
  previous,
  compareLabel,
  evidence,
}: ScorecardTileVM): JSX.Element {
  const className = "rounded-lg border p-5 shadow-md flex flex-col gap-2";
  const style = { background: "var(--bg-elevated)", borderColor: "var(--color-border)" };
  const body = (
    <>
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-medium" style={{ color: "var(--text-muted)" }}>
          {label}
        </span>
        <TrendDelta current={current} previous={previous} compareLabel={compareLabel} />
      </div>
      <span className="text-4xl font-bold tabular-nums" style={{ color: "var(--accent)" }}>
        {value}
      </span>
      <div className="mt-1">
        <Sparkline points={points} filled />
      </div>
      <span className="text-xs" style={{ color: "var(--text-muted)" }}>
        {takeaway}
      </span>
    </>
  );

  if (evidence) {
    return (
      <EvidenceTrigger
        kind={evidence.kind}
        evidenceKey={evidence.key}
        scope={evidence.scope}
        renderedValue={current}
        label={label}
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
