import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { useTranslation } from "../../hooks/useTranslation";
import { tripSuggestionsApi } from "../../lib/api/tripSuggestions";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";
import { useToastStore } from "../../store/toastStore";
import type {
  TripSuggestion,
  TripSuggestionEdits,
  TripSuggestionList,
} from "../../types/tripSuggestion";
import Button from "../ui/Button";
import EmptyState from "../ui/EmptyState";

import TripSuggestionCard from "./TripSuggestionCard";
import { isStale, suggestedTripName, tripSuggestionErrorKey } from "./tripSuggestionCopy";

const NS = "dataQuality:inbox.tripSuggestions";

/**
 * "Reise-Vorschläge" — the Posteingang tab for the cross-domain trip engine
 * (owner decision 2026-09-26).
 *
 * The server proposes, the user answers, and the server does the whole answer
 * in one transaction. So this tab has one job beyond drawing cards: to say
 * what happened. A failed load is a failure state with a retry, never an empty
 * inbox (zeros over a failed load read as "nothing to do"); a failed accept
 * keeps the card and says why — "changed meanwhile" reloads the list, a
 * network error does not pretend anything was saved.
 */
export default function TripSuggestionsTab({
  onCount,
}: {
  /** The number for the tab label; only ever a measured one. */
  onCount?: (count: number) => void;
} = {}): JSX.Element {
  const { t } = useTranslation(["dataQuality", "common"]);
  const language = useSettingsStore((s) => s.display.language);
  const addToast = useToastStore((state) => state.addToast);

  const [list, setList] = useState<TripSuggestionList | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [busyIds, setBusyIds] = useState<ReadonlySet<string>>(new Set());

  const markBusy = useCallback((id: string, busy: boolean): void => {
    setBusyIds((current) => {
      const next = new Set(current);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const load = useCallback(async () => {
    try {
      const data = await tripSuggestionsApi.list();
      setList(data);
      setLoadFailed(false);
      onCount?.(data.total);
    } catch (error) {
      logger.error("Failed to load trip suggestions:", error);
      setLoadFailed(true);
    }
  }, [onCount]);

  useEffect(() => {
    void load();
  }, [load]);

  const nameOf = (s: TripSuggestion): string => suggestedTripName(s, language, t);

  const accept = async (s: TripSuggestion, edits: TripSuggestionEdits): Promise<void> => {
    markBusy(s.id, true);
    try {
      await tripSuggestionsApi.accept(s.id, edits);
      addToast("success", t(`${NS}.messages.accepted.${s.kind}`));
      await load();
    } catch (error) {
      logger.error("Failed to accept trip suggestion:", error);
      addToast("error", t(tripSuggestionErrorKey(error, `${NS}.errors.acceptFailed`)));
      if (isStale(error)) await load();
    } finally {
      markBusy(s.id, false);
    }
  };

  const dismiss = async (s: TripSuggestion): Promise<void> => {
    markBusy(s.id, true);
    try {
      await tripSuggestionsApi.dismiss(s.id);
      addToast("success", t(`${NS}.messages.dismissed`));
      await load();
    } catch (error) {
      logger.error("Failed to dismiss trip suggestion:", error);
      addToast("error", t(tripSuggestionErrorKey(error, `${NS}.errors.dismissFailed`)));
      if (isStale(error)) await load();
    } finally {
      markBusy(s.id, false);
    }
  };

  if (loadFailed) {
    return (
      <EmptyState
        kind="degraded"
        title={t(`${NS}.errors.loadFailed`)}
        description={t(`${NS}.errors.loadFailedHint`)}
        action={<Button onClick={() => void load()}>{t(`${NS}.actions.retry`)}</Button>}
      />
    );
  }
  if (list === null) {
    return <p className="t-caption">{t("common:loading.default")}</p>;
  }

  return (
    <div>
      <p className="t-caption mb-4">{t(`${NS}.description`)}</p>

      {list.home === "missing" && (
        <p role="status" className="t-caption mb-4" style={{ color: "var(--ts-warn)" }}>
          {t(`${NS}.home.missing`)}{" "}
          <Link to="/settings?section=homeAirport">{t(`${NS}.home.link`)}</Link>
        </p>
      )}
      {list.home === "estimated" && <p className="t-caption mb-4">{t(`${NS}.home.estimated`)}</p>}
      {list.total > list.suggestions.length && (
        <p className="t-caption mb-4">
          {t(`${NS}.capped`, { shown: list.suggestions.length, total: list.total })}
        </p>
      )}
      {list.truncated && <p className="t-caption mb-4">{t(`${NS}.truncated`)}</p>}

      {list.suggestions.length === 0 ? (
        <EmptyState
          kind="pending"
          title={t(`${NS}.empty.title`)}
          description={t(`${NS}.empty.description`)}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {list.suggestions.map((s) => (
            <TripSuggestionCard
              key={s.id}
              suggestion={s}
              name={nameOf(s)}
              busy={busyIds.has(s.id)}
              onAccept={(edits) => void accept(s, edits)}
              onDismiss={() => void dismiss(s)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
