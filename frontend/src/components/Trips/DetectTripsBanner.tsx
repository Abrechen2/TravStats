import { useEffect, useState } from "react";
import { tripsApi } from "../../lib/api";
import type { DetectTripsResult } from "../../lib/api/trips";
import { useTranslation } from "../../hooks/useTranslation";
import DetectReviewModal from "./DetectReviewModal";

interface Props {
  /** Called after a successful link to refresh the trip list. */
  onChange: () => void;
}

/**
 * Lazy banner that runs `/trips/detect?dryRun=true` once on mount and
 * surfaces any proposals to the user. Opens DetectReviewModal so the
 * user can accept/reject each proposal individually instead of the
 * old "link all or nothing" flow.
 */
export default function DetectTripsBanner({ onChange }: Props): JSX.Element | null {
  const { t } = useTranslation(["trips", "common"]);
  const [result, setResult] = useState<DetectTripsResult | null>(null);
  const [reviewOpen, setReviewOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    tripsApi
      .detect({ dryRun: true })
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch(() => {
        // Silent: detection is opportunistic, never blocks the page.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!result || result.proposed.length === 0) return null;

  const handleDismiss = (): void => setResult(null);
  const handleReviewCommitted = (): void => {
    setReviewOpen(false);
    setResult(null);
    onChange();
  };

  // Heuristic-source breakdown for the secondary line.
  const sourceCounts = result.proposed.reduce(
    (acc, p) => {
      acc[p.source] = (acc[p.source] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const sourceLabels = Object.entries(sourceCounts)
    .map(([src, n]) => `${t(`trips:detectBanner.sources.${formatSourceName(src)}`)} (${n})`)
    .join(" · ");

  return (
    <>
      <div
        className="rounded-xl border p-3 sm:p-3.5 flex items-center gap-3 mb-4 sm:mb-5"
        style={{
          borderColor: "var(--accent)",
          background: "linear-gradient(90deg, rgba(240,169,71,0.08), rgba(240,169,71,0.02))",
        }}
      >
        <div
          className="hidden sm:flex w-9 h-9 rounded-lg items-center justify-center text-base shrink-0"
          style={{ background: "var(--accent-soft, rgba(240,169,71,0.1))", color: "var(--accent)" }}
        >
          ✨
        </div>
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm" style={{ color: "var(--text-primary)" }}>
            {t("trips:detectBanner.title", { count: result.proposed.length })}
          </p>
          {/* How they were found — a detail a phone can leave to the review. */}
          <p
            className="hidden sm:block text-xs mt-0.5 truncate"
            style={{ color: "var(--text-muted)" }}
          >
            {sourceLabels}
          </p>
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t("common:buttons.close")}
          className="flex items-center justify-center rounded-md text-xs sm:px-3 sm:py-1.5"
          style={{ color: "var(--text-muted)", minWidth: 32, minHeight: 32 }}
        >
          <span className="hidden sm:inline">{t("common:buttons.close")}</span>
          <span className="sm:hidden" aria-hidden="true">
            ✕
          </span>
        </button>
        <button
          type="button"
          onClick={() => setReviewOpen(true)}
          className="px-3 py-1.5 rounded-md text-xs font-medium border transition-colors hover:bg-(--accent) hover:text-(--bg-base)"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          {t("trips:detectBanner.review")}
        </button>
      </div>
      {reviewOpen && (
        <DetectReviewModal
          proposals={result.proposed}
          onClose={() => setReviewOpen(false)}
          onCommitted={handleReviewCommitted}
        />
      )}
    </>
  );
}

/**
 * The i18n key of a detection source. The banner used to print the
 * implementation names — "PNR-Cluster · Home-Loop · Continuity" — on a
 * German page (CT106 audit B11).
 */
function formatSourceName(src: string): string {
  switch (src) {
    case "pnr":
      return "pnr";
    case "home_loop":
      return "homeLoop";
    case "continuity":
      return "continuity";
    default:
      return "other";
  }
}
