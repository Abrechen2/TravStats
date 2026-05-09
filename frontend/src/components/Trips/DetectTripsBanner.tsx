import { useEffect, useState } from "react";
import { tripsApi } from "../../lib/api";
import type { DetectTripsResult } from "../../lib/api/trips";
import { useToastStore } from "../../store/toastStore";
import { useTranslation } from "../../hooks/useTranslation";

interface Props {
  /** Called after a successful link to refresh the trip list. */
  onChange: () => void;
}

/**
 * Lazy banner that runs `/trips/detect?dryRun=true` once on mount and
 * surfaces any proposals to the user with a single "Link All" action.
 * Renders nothing when there's nothing to propose.
 */
export default function DetectTripsBanner({ onChange }: Props): JSX.Element | null {
  const { t } = useTranslation(["trips", "common"]);
  const addToast = useToastStore((s) => s.addToast);
  const [result, setResult] = useState<DetectTripsResult | null>(null);
  const [committing, setCommitting] = useState(false);

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

  const handleCommit = async (): Promise<void> => {
    setCommitting(true);
    try {
      const r = await tripsApi.detect({ dryRun: false });
      const linked = r.created.reduce((sum, c) => sum + c.flightIds.length, 0);
      addToast(
        "success",
        t("trips:detectBanner.success", {
          trips: r.created.length,
          flights: linked,
          orphans: r.orphansRemoved,
        })
      );
      setResult({ proposed: [], created: r.created, orphansRemoved: r.orphansRemoved });
      onChange();
    } catch {
      addToast("error", t("trips:detectBanner.error"));
    } finally {
      setCommitting(false);
    }
  };

  const handleDismiss = (): void => setResult(null);

  // Heuristic-source breakdown for the secondary line.
  const sourceCounts = result.proposed.reduce(
    (acc, p) => {
      acc[p.source] = (acc[p.source] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>
  );
  const sourceLabels = Object.entries(sourceCounts)
    .map(([src, n]) => `${formatSourceName(src)} (${n})`)
    .join(" · ");

  return (
    <div
      className="rounded-xl border p-3.5 flex items-center gap-3 mb-5"
      style={{
        borderColor: "var(--accent)",
        background:
          "linear-gradient(90deg, rgba(240,169,71,0.08), rgba(240,169,71,0.02))",
      }}
    >
      <div
        className="w-9 h-9 rounded-lg flex items-center justify-center text-base shrink-0"
        style={{ background: "var(--accent-soft, rgba(240,169,71,0.1))", color: "var(--accent)" }}
      >
        ✨
      </div>
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm" style={{ color: "var(--text-primary)" }}>
          {t("trips:detectBanner.title", { count: result.proposed.length })}
        </p>
        <p className="text-xs mt-0.5 truncate" style={{ color: "var(--text-muted)" }}>
          {sourceLabels}
        </p>
      </div>
      <button
        onClick={handleDismiss}
        disabled={committing}
        className="px-3 py-1.5 rounded-md text-xs"
        style={{ color: "var(--text-muted)" }}
      >
        {t("common:close")}
      </button>
      <button
        onClick={handleCommit}
        disabled={committing}
        className="px-3 py-1.5 rounded-md text-xs font-medium border transition-colors hover:bg-[var(--accent)] hover:text-white disabled:opacity-50"
        style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
      >
        {committing ? t("common:loading") : t("trips:detectBanner.linkAll")}
      </button>
    </div>
  );
}

function formatSourceName(src: string): string {
  switch (src) {
    case "pnr":
      return "PNR-Cluster";
    case "home_loop":
      return "Home-Loop";
    case "continuity":
      return "Continuity";
    default:
      return src;
  }
}
