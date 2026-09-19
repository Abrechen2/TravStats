import { useState } from "react";
import type { JSX } from "react";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useHasLlm } from "../../hooks/useHasLlm";
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
  const isSharedDemo = useIsDemoAccount();
  /**
   * Whether this instance HAS a text model, asked before the button is drawn
   * (auditor 3, 2026-09-19). The card offered "Zusammenfassung erstellen" on
   * an instance with none, and the only way to find that out was to press it
   * and read a toast -- the honest sentence existed already, as the 503
   * branch of `generate`, and arrived after the click instead of instead of
   * it.
   *
   * `null` means "not answered yet" and deliberately keeps the button: a
   * cold load spends one request there, and showing "no AI service" for that
   * moment on an instance that has one is the worse of the two errors.
   */
  const hasLlm = useHasLlm();
  const [generating, setGenerating] = useState(false);

  /**
   * The beta gate is gone (main, 2026-09-18: the key left the registry), but
   * the DEMO refusal is not a gate and stays. The shared demo account is
   * offered no generation at all, because generating spends the OPERATOR's
   * Ollama and that account's password is printed on a public login page;
   * `rejectDemo` on `POST /trips/:id/summarize` is the door, this is the
   * button. Taking main's `canGenerate = true` wholesale would have left a
   * control that only ever answers 403.
   *
   * No locked notice here, unlike the settings sections: those describe facts
   * about the account that must stay on screen, whereas this card is nothing
   * but the call to action, and repeating a refusal on all fourteen demo trips
   * is noise. A summary that already exists is still shown below — it is
   * content, not a control.
   */
  const canGenerate = !isSharedDemo && hasLlm !== false;

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
    /**
     * An instance with no model configured gets the sentence, not silence and
     * not a button: "KI-Dienst nicht erreichbar. Ollama richtet der Admin
     * unter Admin → Parser ein." names the thing to do and who does it. The
     * shared demo still gets nothing at all -- that refusal is about the
     * account, it repeats on all fourteen demo trips, and it is noise.
     */
    if (hasLlm === false && !isSharedDemo) {
      return (
        <div
          className="rounded-xl p-4"
          style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
          data-testid="trip-summary-unavailable"
        >
          <div
            className="text-[10px] uppercase tracking-wide flex items-center gap-1.5 mb-1"
            style={{ color: "var(--text-muted)" }}
          >
            <span aria-hidden>✨</span>
            {t("trips:summary.title")}
          </div>
          <div className="text-sm" style={{ color: "var(--text-muted)" }}>
            {t("trips:summary.unavailable")}
          </div>
        </div>
      );
    }

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
