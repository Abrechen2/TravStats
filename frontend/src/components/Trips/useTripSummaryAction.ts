import { useState } from "react";
import { tripsApi } from "../../lib/api";
import { useToastStore } from "../../store/toastStore";
import { useIsDemoAccount } from "../../hooks/useIsDemoAccount";
import { useHasLlm } from "../../hooks/useHasLlm";
import type { useTranslation } from "../../hooks/useTranslation";
import type { Trip } from "../../types";
import { reportPageError } from "../../store/pageErrorStore";

/** The two languages the server can write; anything else falls back to German. */
export function summaryLanguageOf(uiLanguage: string): "de" | "en" {
  return uiLanguage.toLowerCase().startsWith("en") ? "en" : "de";
}

/**
 * Creating (or re-creating) a trip's AI summary, as an action the head's
 * "Mehr" menu offers. It used to be a card in the overview's side column; the
 * card now only shows a summary that exists.
 *
 * `available` is false for the shared demo account (generating spends the
 * operator's model and that account's password is public; `rejectDemo` on
 * `POST /trips/:id/summarize` is the door, this is the entry) and where the
 * instance has no text model or an admin switched it off. `useHasLlm` answers
 * `null` while the first request is out, and that keeps the entry: showing
 * "no model" for that moment on an instance that has one is the worse error.
 */
export function useTripSummaryAction(
  trip: Trip,
  language: string,
  t: ReturnType<typeof useTranslation>["t"],
  onChanged: () => void
): { available: boolean; generating: boolean; generate: () => Promise<void> } {
  const addToast = useToastStore((s) => s.addToast);
  const isSharedDemo = useIsDemoAccount();
  const hasLlm = useHasLlm();
  const [generating, setGenerating] = useState(false);
  const available = !isSharedDemo && hasLlm !== false && hasLlm !== "disabled";

  const generate = async (): Promise<void> => {
    setGenerating(true);
    try {
      await tripsApi.summarize(trip.id, summaryLanguageOf(language));
      addToast("success", t("trips:summary.generated"));
      onChanged();
    } catch (err: unknown) {
      const response =
        typeof err === "object" && err !== null && "response" in err
          ? (err as { response?: { status?: number; data?: { code?: string } } }).response
          : undefined;
      const status = response?.status ?? 0;
      // A switch flipped after this tab learned the capabilities: the server
      // says LLM_DISABLED, and "unreachable" would be the wrong sentence.
      const message =
        response?.data?.code === "LLM_DISABLED"
          ? t("trips:summary.disabled")
          : response?.data?.code === "LLM_CLOUD_NOT_CONSENTED"
            ? t("trips:summary.cloudNotConsented")
            : status === 503
              ? t("trips:summary.unavailable")
              : t("trips:summary.error");
      reportPageError(message);
    } finally {
      setGenerating(false);
    }
  };

  return { available, generating, generate };
}
