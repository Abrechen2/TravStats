import { useEffect, useMemo, useState } from "react";
import type { JSX } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { railApi, type RailLookupQuery } from "../../lib/api/rail";
import { logger } from "../../lib/logger";
import type { RailLookupAnswer, RailLookupProviders } from "../../types/rail";
import { applyLookup, isStationComplete, type RailFormDraft } from "./railFormModel";

interface Props {
  draft: RailFormDraft;
  onApply: (next: RailFormDraft) => void;
  onClearLookup: () => void;
  inputClassName: string;
}

type Match = NonNullable<RailLookupAnswer["match"]>;

type LookupState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "answered"; answer: RailLookupAnswer }
  | { kind: "error" };

const todayIso = (): string => {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** The lookup's query from the form, or null while something it needs is missing. */
export function lookupQueryFrom(draft: RailFormDraft, date: string): RailLookupQuery | null {
  const number = draft.trainNumber.trim();
  if (number === "" || date === "" || !isStationComplete(draft.departure)) return null;
  const category = draft.trainCategory.trim();
  const from =
    draft.departure.stationId !== null
      ? { fromStationId: draft.departure.stationId }
      : { fromLat: draft.departure.lat ?? undefined, fromLon: draft.departure.lon ?? undefined };
  return {
    trainNumber: number,
    ...(/^[A-Za-z]{1,10}$/.test(category) && { category }),
    date,
    ...from,
  };
}

/** Why nothing came back, in the words the user needs. */
export function noMatchReason(answer: RailLookupAnswer): "disabled" | "unavailable" | "noMatch" {
  const outcomes = answer.attempts.map((a) => a.outcome);
  if (outcomes.every((o) => o === "disabled" || o === "notApplicable")) return "disabled";
  if (outcomes.includes("unavailable") && !outcomes.includes("noMatch")) return "unavailable";
  return "noMatch";
}

/** The stop to preselect: the one the user already chose, else the train's last. */
function defaultArrival(match: Match, draft: RailFormDraft): number {
  const last = match.stops.length - 1;
  const { lat, lon } = draft.arrival;
  if (lat === null || lon === null) return last;
  let best = { index: last, d: Number.POSITIVE_INFINITY };
  match.stops.forEach((stop, index) => {
    if (index <= match.boardingIndex) return;
    const d = Math.hypot(stop.lat - lat, stop.lon - lon);
    if (d < best.d) best = { index, d };
  });
  // ~1 km in degrees; farther than that, the chosen station is not a stop.
  return best.d < 0.01 ? best.index : last;
}

/**
 * "Look the train up" (spec 2026-09-25-rail-domain, phase 2): train number,
 * boarding station and day in, the timetable's train out, taken over into the
 * form on the user's word. Transitous first, db-rest for Germany; either can
 * be switched off by the admin.
 *
 * Honest about its limits: the open services know only their current
 * timetable, so a past day rarely finds anything — the panel says so before
 * the user asks, and a miss is never presented as "no such train".
 */
export function RailLookupPanel({
  draft,
  onApply,
  onClearLookup,
  inputClassName,
}: Props): JSX.Element | null {
  const { t } = useTranslation(["rail"]);
  const [providers, setProviders] = useState<RailLookupProviders | null>(null);
  const [date, setDate] = useState(() => draft.departureLocal.slice(0, 10) || todayIso());
  const [state, setState] = useState<LookupState>({ kind: "idle" });
  const [arrivalIndex, setArrivalIndex] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    railApi
      .lookupProviders()
      .then((p) => {
        if (!cancelled) setProviders(p);
      })
      .catch((err: unknown) => logger.warn("RailLookupPanel: providers unavailable", err));
    return () => {
      cancelled = true;
    };
  }, []);

  const query = useMemo(() => lookupQueryFrom(draft, date), [draft, date]);
  const isPast = date !== "" && date < todayIso();

  if (!providers) return null;
  if (!providers.transitous && !providers.dbRest) {
    return <p className="t-caption mb-3">{t("rail:lookup.switchedOff")}</p>;
  }

  const run = async (): Promise<void> => {
    if (!query) return;
    setState({ kind: "loading" });
    try {
      const answer = await railApi.lookup(query);
      setState({ kind: "answered", answer });
      setArrivalIndex(answer.match ? defaultArrival(answer.match, draft) : null);
    } catch (err: unknown) {
      logger.warn("RailLookupPanel: lookup failed", err);
      setState({ kind: "error" });
    }
  };

  const match = state.kind === "answered" ? state.answer.match : null;

  return (
    <div className="mb-4 rounded-md border border-border p-3" data-testid="rail-lookup">
      <p className="text-sm font-medium">{t("rail:lookup.title")}</p>
      <p className="t-caption">{t("rail:lookup.hint")}</p>
      <div className="mt-2 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          {t("rail:lookup.date")}
          <input
            type="date"
            className={`mt-1 ${inputClassName}`}
            style={{ colorScheme: "dark" }}
            value={date}
            onChange={(e): void => setDate(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="rounded-md border border-border px-4 py-3 text-sm disabled:opacity-50"
          disabled={!query || state.kind === "loading"}
          onClick={(): void => void run()}
        >
          {state.kind === "loading" ? t("rail:lookup.searching") : t("rail:lookup.run")}
        </button>
      </div>
      {!query ? <p className="t-caption mt-1">{t("rail:lookup.needs")}</p> : null}
      {isPast ? <p className="t-caption mt-1">{t("rail:lookup.pastDay")}</p> : null}

      {state.kind === "error" ? (
        <p role="alert" className="mt-2 text-sm text-(--danger)">
          {t("rail:lookup.error")}
        </p>
      ) : null}
      {state.kind === "answered" && !match ? (
        <p role="status" className="mt-2 text-sm">
          {t(`rail:lookup.none.${noMatchReason(state.answer)}`)}
        </p>
      ) : null}

      {match && arrivalIndex !== null ? (
        <div className="mt-2 space-y-2" role="status">
          <p className="text-sm">
            {t("rail:lookup.found", {
              train: [match.trainCategory, match.trainNumber].filter(Boolean).join(" "),
              operator: match.operator ?? "—",
              provider: t(`rail:lookup.provider.${match.provider}`),
            })}
          </p>
          <label className="block text-sm">
            {t("rail:lookup.alightAt")}
            <select
              className={`mt-1 ${inputClassName}`}
              value={arrivalIndex}
              onChange={(e): void => setArrivalIndex(Number(e.target.value))}
            >
              {match.stops.map((stop, index) =>
                index > match.boardingIndex ? (
                  <option key={`${stop.name}-${index}`} value={index}>
                    {stop.name}
                    {stop.arrivalLocal ? ` · ${stop.arrivalLocal.slice(11)}` : ""}
                  </option>
                ) : null
              )}
            </select>
          </label>
          <p className="t-caption">
            {match.hasGeometry ? t("rail:lookup.withLine") : t("rail:lookup.withoutLine")}
          </p>
          <button
            type="button"
            className="rounded-md bg-(--accent) px-4 py-2 text-sm font-medium text-(--bg-base)"
            onClick={(): void => {
              onApply(applyLookup(draft, match, arrivalIndex));
              setState({ kind: "idle" });
            }}
          >
            {t("rail:lookup.apply")}
          </button>
        </div>
      ) : null}

      {draft.lookup ? (
        <p className="t-caption mt-2">
          {t("rail:lookup.linked", {
            provider: t(`rail:lookup.provider.${draft.lookup.provider}`),
          })}{" "}
          <button type="button" className="underline" onClick={onClearLookup}>
            {t("rail:lookup.unlink")}
          </button>
        </p>
      ) : null}
      {providers.transitous ? (
        <p className="t-caption mt-2">
          {t("rail:lookup.credit")}{" "}
          <a
            href={providers.transitousSourcesUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="underline"
          >
            Transitous
          </a>
        </p>
      ) : null}
    </div>
  );
}
