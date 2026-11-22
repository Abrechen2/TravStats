import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { lifeBookApi, type LifeBookScope } from "../../lib/api/lifeBook";
import { tripsApi } from "../../lib/api/trips";
import { jobErrorCode, JobLostError } from "../../lib/api/jobs";
import { downloadBlob } from "../../lib/export";
import { logger } from "../../lib/logger";
import { Icon } from "../ui/Icon";
import { JobStatus, SettingItem } from "../ui/settings";
import type { JobView } from "../ui/settings";

const KNOWN_CODES = new Set([
  "LIFE_BOOK_EMPTY",
  "LIFE_BOOK_TOO_LARGE",
  "LIFE_BOOK_BUSY",
  "LIFE_BOOK_NOT_FOUND",
  "TRIP_NOT_FOUND",
  "rate_limited",
]);

type Mode = "all" | "year" | "trip";
type Phase =
  | { kind: "idle" }
  | { kind: "running"; done?: number; total?: number }
  | { kind: "done"; text: string }
  | { kind: "failed"; reason: string }
  | { kind: "unknown" };

interface TripOption {
  id: string;
  name: string;
}

/**
 * "Lebensbuch": the logbook as ONE offline HTML file for a year, a trip or
 * everything, printable to PDF from the browser. The book's own text follows
 * the language the app is shown in.
 */
export default function LifeBookRow(): JSX.Element {
  const { t, i18n } = useTranslation(["settings"]);
  const [mode, setMode] = useState<Mode>("all");
  const [year, setYear] = useState(() => new Date().getUTCFullYear());
  const [trips, setTrips] = useState<TripOption[] | null>(null);
  const [tripsFailed, setTripsFailed] = useState(false);
  const [tripId, setTripId] = useState("");
  const [phase, setPhase] = useState<Phase>({ kind: "idle" });

  useEffect(() => {
    if (mode !== "trip" || trips !== null) return;
    tripsApi.getEvery().then(
      (all) => {
        setTrips(all.map((x) => ({ id: x.id, name: x.name })));
        setTripsFailed(false);
      },
      (err: unknown) => {
        logger.warn("Could not load the trips for the life book:", err);
        setTripsFailed(true);
      }
    );
  }, [mode, trips]);

  const run = useCallback(async () => {
    const request: LifeBookScope =
      mode === "year"
        ? { scope: "year", year }
        : mode === "trip"
          ? { scope: "trip", tripId }
          : { scope: "all" };
    const lang = i18n.language?.startsWith("en") ? "en" : "de";
    setPhase({ kind: "running" });
    try {
      const result = await lifeBookApi.build(request, lang, (job) =>
        setPhase(
          job.progress
            ? { kind: "running", done: job.progress.done, total: job.progress.total }
            : { kind: "running" }
        )
      );
      downloadBlob(await lifeBookApi.download(result.exportId), result.filename);
      const skipped =
        result.photosSkipped > 0
          ? ` ${t("settings:lifeBook.photosSkipped", { count: result.photosSkipped })}`
          : "";
      if (skipped) logger.warn("Life book written without some photos:", result.photosSkipped);
      setPhase({
        kind: "done",
        text:
          t("settings:lifeBook.done", {
            trips: result.trips,
            entries: result.entries,
            photos: result.photos,
          }) + skipped,
      });
    } catch (err) {
      if (err instanceof JobLostError) {
        setPhase({ kind: "unknown" });
        return;
      }
      const code = jobErrorCode(err);
      logger.warn("Life book failed:", code ?? err);
      setPhase({
        kind: "failed",
        reason: t(`settings:lifeBook.failed.${code && KNOWN_CODES.has(code) ? code : "generic"}`),
      });
    }
  }, [mode, year, tripId, i18n, t]);

  const view: JobView | null =
    phase.kind === "running"
      ? {
          kind: "running",
          what: t("settings:lifeBook.building"),
          done: phase.done,
          total: phase.total,
        }
      : phase.kind === "done"
        ? { kind: "done", result: phase.text }
        : phase.kind === "failed"
          ? { kind: "failed", reason: phase.reason, onRetry: () => void run() }
          : phase.kind === "unknown"
            ? { kind: "unknown", onCheck: () => void run() }
            : null;
  const needsTrip = mode === "trip" && tripId === "";

  return (
    <SettingItem
      title={t("settings:lifeBook.title")}
      sub={t("settings:lifeBook.sub")}
      help={t("settings:lifeBook.help")}
      error={tripsFailed ? t("settings:lifeBook.tripsFailed") : undefined}
      job={view ? <JobStatus job={view} /> : undefined}
      control={
        <button
          type="button"
          onClick={() => void run()}
          disabled={phase.kind === "running" || needsTrip}
          className="btn-secondary inline-flex items-center gap-2"
        >
          <Icon name="download" size={14} />
          {t("settings:lifeBook.button")}
        </button>
      }
    >
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2">
          <span className="label">{t("settings:lifeBook.scope")}</span>
          <select
            value={mode}
            onChange={(e) => setMode(e.target.value as Mode)}
            style={{ minHeight: 44 }}
          >
            <option value="all">{t("settings:lifeBook.scopeAll")}</option>
            <option value="year">{t("settings:lifeBook.scopeYear")}</option>
            <option value="trip">{t("settings:lifeBook.scopeTrip")}</option>
          </select>
        </label>
        {mode === "year" ? (
          <label className="flex items-center gap-2">
            <span className="label">{t("settings:lifeBook.year")}</span>
            <input
              type="number"
              min={1900}
              max={2200}
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              style={{ minHeight: 44, width: "6rem" }}
            />
          </label>
        ) : null}
        {mode === "trip" ? (
          <label className="flex items-center gap-2">
            <span className="label">{t("settings:lifeBook.trip")}</span>
            <select
              value={tripId}
              disabled={trips === null}
              onChange={(e) => setTripId(e.target.value)}
              style={{ minHeight: 44 }}
            >
              <option value="">{t("settings:lifeBook.pickTrip")}</option>
              {(trips ?? []).map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
      <p className="t-caption" style={{ margin: 0 }}>
        {t("settings:lifeBook.note")}
      </p>
    </SettingItem>
  );
}
