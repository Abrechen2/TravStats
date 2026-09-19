import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";

interface FlightReportActionsProps {
  onGenerateCertificate: () => void;
  onYearReport: () => void;
  generatingPdf: boolean;
  yearReportDisabled: boolean;
}

/**
 * Split out of `AdvancedStatsPage.tsx` (Task 9) — that page sits at the
 * file-size ratchet's frozen baseline, and mounting `EvidencePanel` there
 * needed headroom. A plain UI slice with no state of its own, so moving it
 * costs nothing beyond wiring its four props.
 */
export default function FlightReportActions({
  onGenerateCertificate,
  onYearReport,
  generatingPdf,
  yearReportDisabled,
}: FlightReportActionsProps): JSX.Element {
  const { t } = useTranslation(["stats"]);
  return (
    <div className="flex justify-end mb-4">
      <button
        onClick={onGenerateCertificate}
        className="flex items-center gap-2 px-4 py-2 rounded-lg font-semibold text-sm transition-colors"
        style={{
          backgroundColor: "var(--color-primary)",
          color: "#fff",
          border: "none",
          cursor: "pointer",
        }}
      >
        ✈ {t("stats:certificate.generate")}
      </button>
      <button
        onClick={onYearReport}
        disabled={yearReportDisabled}
        className="btn-primary px-4 py-2 text-sm flex items-center gap-2 disabled:opacity-50"
      >
        {generatingPdf ? t("stats:yearReport.generating") : t("stats:yearReport.btn")}
      </button>
    </div>
  );
}
