import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import Button from "../ui/Button";

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
  // One group, the design-system buttons, the design-system gap. Each button
  // used to style itself, and the two sat flush against each other as two
  // identical amber blocks (tester, 2026-09-26). On a phone they stack at
  // full width instead of squeezing into one line.
  return (
    <div
      role="group"
      aria-label={t("stats:reportActions.label")}
      className="mb-4 grid grid-cols-1 gap-3 sm:flex sm:flex-wrap sm:items-center sm:justify-end"
    >
      <Button variant="primary" onClick={onGenerateCertificate} icon={<span aria-hidden>✈</span>}>
        {t("stats:certificate.generate")}
      </Button>
      <Button variant="secondary" onClick={onYearReport} disabled={yearReportDisabled}>
        {generatingPdf ? t("stats:yearReport.generating") : t("stats:yearReport.btn")}
      </Button>
    </div>
  );
}
