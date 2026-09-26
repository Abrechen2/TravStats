import { useState } from "react";
import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { JobLostError } from "../../lib/api/jobs";
import {
  isOpenDataDisabled,
  openDataApi,
  WEATHER_SERVICE_FAILURES,
  type EntryWeatherOutcome,
} from "../../lib/api/openData";
import { logger } from "../../lib/logger";
import { useSettingsStore } from "../../store/settingsStore";
import { useToastStore } from "../../store/toastStore";
import type { TripJournalEntry } from "../../types";

const BUTTON =
  "px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors hover:border-(--accent) hover:text-(--accent) disabled:opacity-50";

/**
 * The actions above a trip's timeline: a new journal entry, and — where the
 * instance allows open data and an entry still lacks it — the day's weather
 * for every entry at once (2026-09-24). A new entry gets its weather on save;
 * this is for the ones written before.
 *
 * No "add stop" button since 2026-09-21. A stop and a place were the same
 * thing said twice — the places domain owns "somewhere I was", with a
 * catalogue, coordinates, visits and its own map layer, and this button
 * offered a second, thinner way to record the same fact inside one trip
 * (Alex, 2026-09-20). Existing stops still render and still open their
 * editor; only the way to make NEW ones here is gone.
 */
/**
 * The fill's outcome per entry, said as counts: how many got weather, how
 * many the weather service could not answer for (their stored state is
 * kept), how many have no place, how many are too recent. "Nothing to fill"
 * only when nothing else is true.
 */
export function summarizeFill(
  filled: number,
  outcomes: readonly EntryWeatherOutcome[]
): { kind: "success" | "info" | "error"; parts: Array<[string, number]> } {
  const count = (test: (o: EntryWeatherOutcome) => boolean): number => outcomes.filter(test).length;
  const failed = count((o) => WEATHER_SERVICE_FAILURES.has(o.outcome));
  const noPlace = count((o) => o.outcome === "noLocation");
  const notYet = count((o) => o.outcome === "futureOrToday" || o.outcome === "noData");
  const parts: Array<[string, number]> = [
    ...(filled > 0 ? ([["openData:weather.filled", filled]] as Array<[string, number]>) : []),
    ...(failed > 0 ? ([["openData:weather.fillFailed", failed]] as Array<[string, number]>) : []),
    ...(noPlace > 0
      ? ([["openData:weather.fillNoPlace", noPlace]] as Array<[string, number]>)
      : []),
    ...(notYet > 0 ? ([["openData:weather.fillNotYet", notYet]] as Array<[string, number]>) : []),
  ];
  const kind = failed > 0 ? (filled > 0 ? "info" : "error") : filled > 0 ? "success" : "info";
  return { kind, parts: parts.length > 0 ? parts : [["openData:weather.nothing", 0]] };
}

export default function TimelineActions({
  tripId,
  entries,
  onAddJournal,
  onChanged,
}: {
  tripId: string;
  entries: readonly TripJournalEntry[];
  onAddJournal: () => void;
  onChanged: () => void;
}): JSX.Element {
  const { t } = useTranslation(["trips", "openData"]);
  const addToast = useToastStore((s) => s.addToast);
  const openData = useSettingsStore((s) => s.openDataEnabled) === true;
  const [filling, setFilling] = useState(false);
  const missing = entries.some((e) => e.observedWeather == null);

  const fillWeather = async (): Promise<void> => {
    setFilling(true);
    try {
      // A server job: one weather lookup per entry, in sequence, used to run
      // inside a single request the browser dropped after ten seconds.
      const { filled, outcomes } = await openDataApi.fillJournalWeather(tripId);
      const summary = summarizeFill(filled, outcomes);
      addToast(summary.kind, summary.parts.map(([key, count]) => t(key, { count })).join(" "));
      if (filled > 0) onChanged();
    } catch (err) {
      logger.warn("Filling the journal weather failed", err);
      addToast(
        "error",
        t(
          err instanceof JobLostError
            ? "openData:weather.outcomeUnknown"
            : isOpenDataDisabled(err)
              ? "openData:weather.disabled"
              : "openData:weather.failed"
        )
      );
    } finally {
      setFilling(false);
    }
  };

  const style = { borderColor: "var(--color-border)", color: "var(--text-muted)" };
  return (
    <div className="mb-4 flex gap-2 flex-wrap">
      <button type="button" onClick={onAddJournal} className={BUTTON} style={style}>
        {t("trips:detail.timeline.addJournal")}
      </button>
      {openData && missing && (
        <button
          type="button"
          onClick={() => void fillWeather()}
          disabled={filling}
          className={BUTTON}
          style={style}
        >
          {filling ? t("openData:weather.filling") : t("openData:weather.fill")}
        </button>
      )}
    </div>
  );
}
