import type { JSX, ReactNode } from "react";

import EvidenceTrigger from "../EvidenceTrigger";
import type { EvidenceScopeParams } from "../../evidence/useEvidence";

/**
 * A count in a table cell that opens the entries behind it — the evidence
 * panel's pattern (`EvidenceTrigger`), inline. Used only for keys a resolver
 * serves (`services/evidence/metricEvidenceFlightInsights.ts`,
 * `…CruiseInsights.ts`); a zero opens the same panel, which then says so.
 */
export default function EvidenceCount({
  evidenceKey,
  scope,
  value,
  label,
  children,
}: {
  evidenceKey: string;
  scope: EvidenceScopeParams;
  value: number;
  label: string;
  children?: ReactNode;
}): JSX.Element {
  return (
    <EvidenceTrigger
      kind="metric"
      evidenceKey={evidenceKey}
      scope={scope}
      renderedValue={value}
      label={label}
      className="inline underline decoration-dotted underline-offset-2"
      style={{ width: "auto", textAlign: "inherit" }}
    >
      {children ?? value}
    </EvidenceTrigger>
  );
}
