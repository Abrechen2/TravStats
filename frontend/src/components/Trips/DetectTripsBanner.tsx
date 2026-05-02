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

  return (
    <div
      className="mx-4 mt-4 mb-2 rounded-lg border p-3 flex items-start justify-between gap-3"
      style={{ borderColor: "var(--accent)", background: "var(--surface-elevated)" }}
    >
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm" style={{ color: "var(--text-primary)" }}>
          {t("trips:detectBanner.title", { count: result.proposed.length })}
        </p>
        <p className="text-xs mt-1" style={{ color: "var(--text-muted)" }}>
          {result.proposed
            .slice(0, 3)
            .map((p) => `${p.suggestedName}`)
            .join(" · ")}
          {result.proposed.length > 3 && ` · …`}
        </p>
      </div>
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={handleDismiss}
          disabled={committing}
          className="px-3 py-1.5 rounded-md text-xs font-medium"
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
    </div>
  );
}
