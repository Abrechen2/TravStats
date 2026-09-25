import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { tourIndexApi, type TourSummary } from "../../lib/api/tourIndex";
import { roadtripsApi } from "../../lib/api/roadtrips";
import { useToastStore } from "../../store/toastStore";

/**
 * The rule's decisions, shown once for the owner to correct (design
 * 2026-09-24 §3.4, owner ruling "automatisch einordnen, einmal als Liste
 * zeigen, pro Eintrag umstellbar").
 *
 * The 2.7 migration classified every existing tour section as a day tour or
 * a roadtrip and flagged each one. A row leaves this list the moment the
 * reader keeps it or moves it — both clear the flag on the server — so the
 * notice shrinks as it is worked through and is gone for good afterwards.
 * Shown on both pages, because a misfiled row is found on the page it does
 * NOT belong on.
 */
export default function KindReviewNotice({
  onChanged,
}: {
  /** Called after a row moved, so the page re-reads its own list. */
  onChanged: () => void;
}): JSX.Element | null {
  const { t } = useTranslation(["roadtrips"]);
  const addToast = useToastStore((s) => s.addToast);
  const [rows, setRows] = useState<TourSummary[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const all = await tourIndexApi.list();
      setRows(all.filter((r) => r.kindAssignedAutomatically));
    } catch {
      // Silent on purpose: this is a review aid beside the real list. The
      // list itself reports its own load failure; a second banner saying
      // the same thing about the same request would be noise.
      setRows([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (row: TourSummary, action: "keep" | "switch"): Promise<void> => {
    setBusy(row.id);
    try {
      if (action === "keep") await roadtripsApi.confirmKind(row.id);
      else
        await roadtripsApi.switchKind(row.id, {
          kind: row.kind === "tour" ? "roadtrip" : "tour",
        });
      setRows((prev) => prev.filter((r) => r.id !== row.id));
      if (action === "switch") onChanged();
    } catch {
      addToast("error", t("roadtrips:review.error"));
    } finally {
      setBusy(null);
    }
  };

  if (rows.length === 0) return null;

  return (
    <section
      className="mb-4 rounded-lg border p-3 text-sm"
      style={{ borderColor: "var(--domain-roadtrip)", background: "var(--domain-roadtrip-soft)" }}
      aria-labelledby="kind-review-title"
    >
      <h2 id="kind-review-title" className="font-medium">
        {t("roadtrips:review.title", { count: rows.length })}
      </h2>
      <p className="mt-1 text-(--text-muted)">{t("roadtrips:review.intro")}</p>
      <ul className="mt-3 space-y-2">
        {rows.map((row) => (
          <li key={row.id} className="flex flex-wrap items-center gap-2">
            <span className="min-w-40 flex-1">
              <span className="font-medium">{row.name}</span>{" "}
              <span className="text-xs text-(--text-muted)">
                {t(`roadtrips:review.isNow.${row.kind}`)}
              </span>
            </span>
            <button
              type="button"
              disabled={busy === row.id}
              onClick={() => void act(row, "keep")}
              className="rounded-sm border border-(--color-border) px-2 py-1 text-xs disabled:opacity-40"
            >
              {t("roadtrips:review.keep")}
            </button>
            <button
              type="button"
              disabled={busy === row.id}
              onClick={() => void act(row, "switch")}
              className="rounded-sm border border-(--color-border) px-2 py-1 text-xs disabled:opacity-40"
            >
              {t(`roadtrips:review.moveTo.${row.kind === "tour" ? "roadtrip" : "tour"}`)}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
