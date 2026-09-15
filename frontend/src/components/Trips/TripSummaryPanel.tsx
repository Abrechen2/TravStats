import { useState } from "react";
import type { JSX } from "react";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useBetaFeatures } from "../../hooks/useBetaFeatures";
import { useTranslation } from "../../hooks/useTranslation";
import type { Trip } from "../../types";

/**
 * The LLM trip-summary card on the trip detail page.
 *
 * Gated behind the instance-level beta flag (`tripAiSummary` — see
 * `config/betaFeatures.ts`): the summaries are buggy and the Trips area as a
 * whole is unfinished, so the generate CTA must not be advertised on
 * production. An ALREADY generated summary is still shown when the gate is
 * closed — it is content the user created, and hiding it would look like data
 * loss — but the (re)generate button that would call the LLM again is not.
 *
 * The gate is cosmetic. `POST /trips/:id/summarize` stays reachable for any
 * authenticated user; this component simply stops offering it.
 */
/** The two languages the server can write; anything else falls back to German. */
export function summaryLanguageOf(uiLanguage: string): "de" | "en" {
  return uiLanguage.toLowerCase().startsWith("en") ? "en" : "de";
}

export function TripSummaryPanel({
  trip,
  t,
  language,
  onChanged,
}: {
  trip: Trip;
  t: ReturnType<typeof useTranslation>["t"];
  /** The reader's UI language (`i18n.language`); the summary is written in it. */
  language: string;
  onChanged: () => void;
}): JSX.Element | null {
  const addToast = useToastStore((s) => s.addToast);
  const { isFeatureVisible } = useBetaFeatures();
  const [generating, setGenerating] = useState(false);

  const canGenerate = isFeatureVisible("tripAiSummary");

  const generate = async (): Promise<void> => {
    setGenerating(true);
    try {
      await tripsApi.summarize(trip.id, summaryLanguageOf(language));
      addToast("success", t("trips:summary.generated"));
      onChanged();
    } catch (err: unknown) {
      const status =
        typeof err === "object" && err !== null && "response" in err
          ? ((err as { response?: { status?: number } }).response?.status ?? 0)
          : 0;
      addToast("error", status === 503 ? t("trips:summary.unavailable") : t("trips:summary.error"));
    } finally {
      setGenerating(false);
    }
  };

  if (!trip.summary) {
    // Nothing to show and nothing to offer — render no card at all rather
    // than an empty placeholder.
    if (!canGenerate) return null;

    return (
      <div
        className="rounded-xl p-4 flex items-center gap-3"
        style={{
          background: "linear-gradient(135deg, rgba(240,169,71,0.06), rgba(74,166,176,0.04))",
          border: "1px dashed var(--color-border)",
        }}
      >
        <div className="text-2xl shrink-0" aria-hidden>
          ✨
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium" style={{ color: "var(--text-primary)" }}>
            {t("trips:summary.title")}
          </div>
          <div className="text-xs mt-0.5" style={{ color: "var(--text-muted)" }}>
            {t("trips:summary.cta")}
          </div>
        </div>
        <button
          type="button"
          onClick={() => void generate()}
          disabled={generating}
          className="px-3 py-1.5 rounded-md text-xs font-medium border disabled:opacity-50"
          style={{ borderColor: "var(--accent)", color: "var(--accent)" }}
        >
          {generating ? t("trips:summary.generating") : t("trips:summary.generateButton")}
        </button>
      </div>
    );
  }

  return (
    <div
      className="rounded-xl p-4"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      <div className="flex items-center justify-between mb-2">
        <div
          className="text-[10px] uppercase tracking-wide flex items-center gap-1.5"
          style={{ color: "var(--text-muted)" }}
        >
          <span aria-hidden>✨</span>
          {t("trips:summary.title")}
        </div>
        {canGenerate && (
          <button
            type="button"
            onClick={() => void generate()}
            disabled={generating}
            className="text-[11px] underline disabled:opacity-50"
            style={{ color: "var(--text-muted)" }}
          >
            {generating ? t("trips:summary.generating") : t("trips:summary.regenerate")}
          </button>
        )}
      </div>
      <div className="text-sm whitespace-pre-wrap leading-relaxed">{trip.summary}</div>
    </div>
  );
}

export default TripSummaryPanel;
