import { useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { apiErrorMachineCode } from "../../../lib/apiError";
import { logger } from "../../../lib/logger";
import { dawarichStaysApi } from "../../../lib/api/dawarichStays";
import StopEvidenceBadge from "../../dawarich/StopEvidenceBadge";
import { stopEvidenceView } from "../../../lib/stopEvidenceView";
import { formatLocalClock, formatLocalDate } from "../../../lib/displayFormat";
import type { SmartSuggestion } from "../../../lib/api/smartLists";

const COARSE =
  "pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:min-w-(--ts-size-touch-min)";

/** Why a confirm or a "not me" was refused, as a locale key. */
const ANSWER_ERRORS: Record<string, string> = {
  DAWARICH_ALREADY_RESOLVED: "places:smartList.answerErrors.resolved",
  SUGGESTION_NOT_FOUND: "places:smartList.answerErrors.gone",
  EVIDENCE_INVALIDATED: "places:smartList.answerErrors.gone",
  SUGGESTION_ACCEPT_IN_PROGRESS: "places:smartList.answerErrors.inProgress",
  HISTORY_CHANGED: "places:smartList.answerErrors.inProgress",
  TRAVTRACK_DISABLED: "places:smartList.answerErrors.disabled",
  DAWARICH_INVALID_INTERVAL: "places:smartList.answerErrors.interval",
};

/** Confirm one suggestion as it stands: the visit at its place, on its own wall-clock times. */
export async function acceptSuggestion(suggestion: SmartSuggestion): Promise<void> {
  await dawarichStaysApi.accept(suggestion.id, {
    name: suggestion.name ?? "",
    placeId: suggestion.placeId,
    tripId: null,
    lat: suggestion.lat,
    lon: suggestion.lon,
    startAt: { local: suggestion.startLocal },
    endAt: { local: suggestion.endLocal },
  });
}

/** The locale key of a refused answer. */
export function answerErrorKey(err: unknown): string {
  return ANSWER_ERRORS[apiErrorMachineCode(err) ?? ""] ?? "places:smartList.answerErrors.failed";
}

/**
 * One "were you here?" suggestion, the SAME row the stay inbox lists: answering it here answers it
 * there (both call the stays API for this id). `intro` is the question; the reason — source, date,
 * arrival, dwell, distance — is always on the line.
 */
export function SuggestionRow({
  suggestion,
  title,
  onAnswered,
}: {
  suggestion: SmartSuggestion;
  /** The outlet's name, where the row is not already on the place's own page. */
  title?: string;
  onAnswered: () => void;
}): JSX.Element {
  const { t } = useTranslation(["places", "common"]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const date = formatLocalDate(suggestion.startLocal);
  const time = formatLocalClock(suggestion.startLocal);

  const answer = async (confirm: boolean): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      if (confirm) await acceptSuggestion(suggestion);
      else await dawarichStaysApi.reject(suggestion.id);
      onAnswered();
    } catch (err: unknown) {
      logger.error({ err }, "SuggestionRow: the answer was refused");
      const code = apiErrorMachineCode(err);
      setError(ANSWER_ERRORS[code ?? ""] ?? "places:smartList.answerErrors.failed");
      // The row is no longer a question when it was answered or its history went away.
      if (code === "DAWARICH_ALREADY_RESOLVED" || code === "SUGGESTION_NOT_FOUND") onAnswered();
    } finally {
      setBusy(false);
    }
  };

  return (
    <li
      className="rounded-xl px-4 py-3"
      style={{ background: "var(--bg-surface)", border: "1px solid var(--color-border)" }}
    >
      {title && (
        <p className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
          {title}
        </p>
      )}
      <p className="text-sm" style={{ color: "var(--text-primary)" }}>
        {t("places:smartList.question", { date, time })}
      </p>
      <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
        {t("places:smartList.reason", {
          minutes: suggestion.durationMinutes,
          distance: suggestion.distanceM ?? "?",
        })}
        {suggestion.strength === "name" && ` · ${t("places:smartList.weaker")}`}
      </p>
      <StopEvidenceBadge
        view={stopEvidenceView({
          visit: {
            distanceM: suggestion.distanceM,
            durationMs: suggestion.durationMinutes * 60_000,
            // The venue lookup named this suggestion; its name is shown above, not here.
            venue: { name: suggestion.name ?? "–" },
          },
        })}
      />
      {suggestion.lists.length > 0 && (
        <p className="mt-1 text-xs" style={{ color: "var(--text-muted)" }}>
          {t("places:smartList.fitsList", {
            lists: suggestion.lists.map((l) => l.listName).join(", "),
          })}
        </p>
      )}
      {error && (
        <p role="alert" className="mt-2 text-sm" style={{ color: "var(--danger)" }}>
          {t(error)}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer(true)}
          className={`btn-primary disabled:opacity-50 ${COARSE}`}
        >
          {t("places:smartList.confirm")}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer(false)}
          className={`rounded-lg px-4 py-2 text-sm disabled:opacity-50 ${COARSE}`}
          style={{ border: "1px solid var(--color-border)", color: "var(--text-secondary)" }}
        >
          {t("places:smartList.notMe")}
        </button>
      </div>
    </li>
  );
}
