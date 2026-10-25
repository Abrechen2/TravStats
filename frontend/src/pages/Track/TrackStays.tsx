import { useCallback, useEffect, useState } from "react";
import type { JSX } from "react";
import { Link } from "react-router-dom";
import Button from "../../components/ui/Button";
import { token } from "../../components/ui/tokens";
import { useTranslation } from "../../hooks/useTranslation";
import { useTodayZone } from "../../hooks/useTodayZone";
import { trackErrorKey } from "../../lib/api/travtrack";
import {
  travTrackViewsApi,
  type TravTrackStay,
  type TravTrackStayState,
} from "../../lib/api/travtrackViews";
import { formatDate, formatTime } from "../../lib/displayFormat";
import { logger } from "../../lib/logger";
import { todayIn } from "../../shared/time/clock";
import { pillStyle, panelStyle } from "./map/trackMapStyle";

const STATES: TravTrackStayState[] = ["pending", "accepted", "rejected"];
const PAGE = 50;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The inbox card of a stay still to be answered (the same link the day's timeline carries). */
export const stayInboxHref = (id: string): string =>
  `/pending-updates?view=list&item=${encodeURIComponent(`dawarich:${id}`)}`;

type Filter = { states: TravTrackStayState[]; fromDay: string; toDay: string };

type State =
  | { kind: "loading"; stays: TravTrackStay[] }
  | { kind: "loaded"; stays: TravTrackStay[]; next: string | null }
  | { kind: "failed"; stays: TravTrackStay[]; key: string; next: string | null };

/**
 * `/track/stays` — Aufenthalte (board „Track-Karte", TravTrack plan T5.3): the
 * stays TravTrack (or Dawarich) found, open, confirmed and declined, newest
 * first, a page at a time. An open one links to its inbox card, where it is
 * answered; a confirmed one to the place or trip it became. A stay inside a
 * privacy zone carries no position and so no map link — the zone is never
 * shown, the stay row stays.
 */
export default function TrackStays(): JSX.Element {
  const { t } = useTranslation(["track"]);
  const today = todayIn(useTodayZone());
  const [draft, setDraft] = useState<Filter>({ states: [...STATES], fromDay: "", toDay: "" });
  const [filter, setFilter] = useState<Filter>(draft);
  const [state, setState] = useState<State>({ kind: "loading", stays: [] });

  const load = useCallback(async (f: Filter, cursor: string | null, before: TravTrackStay[]) => {
    setState({ kind: "loading", stays: before });
    try {
      const span = f.fromDay && f.toDay ? { fromDay: f.fromDay, toDay: f.toDay } : {};
      const page = await travTrackViewsApi.stays({
        states: f.states,
        ...span,
        ...(cursor ? { cursor } : {}),
        limit: PAGE,
      });
      setState({ kind: "loaded", stays: [...before, ...page.stays], next: page.nextCursor });
    } catch (err: unknown) {
      logger.warn("TravTrack stays could not be loaded", err);
      setState({ kind: "failed", stays: before, key: trackErrorKey(err), next: cursor });
    }
  }, []);

  useEffect(() => {
    void load(filter, null, []);
  }, [filter, load]);

  const toggle = (s: TravTrackStayState) =>
    setDraft((d) => ({
      ...d,
      states: d.states.includes(s) ? d.states.filter((x) => x !== s) : [...d.states, s],
    }));
  const spanValid =
    (draft.fromDay === "" && draft.toDay === "") ||
    (DAY.test(draft.fromDay) && DAY.test(draft.toDay));
  const canApply = draft.states.length > 0 && spanValid && draft.fromDay <= draft.toDay;
  const next = state.kind === "loading" ? null : state.next;

  return (
    <section data-testid="track-stays" className="flex flex-col gap-3">
      <h2 className="t-card-title">{t("track:stays.title")}</h2>
      <p className="t-caption">{t("track:stays.intro")}</p>
      <form
        className="flex flex-wrap items-end gap-3"
        style={panelStyle}
        onSubmit={(e) => {
          e.preventDefault();
          if (canApply) setFilter(draft);
        }}
      >
        <fieldset className="flex flex-wrap gap-2">
          <legend className="t-caption">{t("track:stays.filter.status")}</legend>
          {STATES.map((s) => (
            <button
              key={s}
              type="button"
              aria-pressed={draft.states.includes(s)}
              onClick={() => toggle(s)}
              style={pillStyle(draft.states.includes(s))}
            >
              {t(`track:stays.state.${s}`)}
            </button>
          ))}
        </fieldset>
        <label className="flex flex-col gap-1 t-caption">
          {t("track:stays.filter.from")}
          <input
            type="date"
            value={draft.fromDay}
            max={today}
            onChange={(e) => setDraft((d) => ({ ...d, fromDay: e.target.value }))}
            style={pillStyle(false)}
          />
        </label>
        <label className="flex flex-col gap-1 t-caption">
          {t("track:stays.filter.to")}
          <input
            type="date"
            value={draft.toDay}
            max={today}
            onChange={(e) => setDraft((d) => ({ ...d, toDay: e.target.value }))}
            style={pillStyle(false)}
          />
        </label>
        <Button type="submit" disabled={!canApply}>
          {t("track:stays.filter.apply")}
        </Button>
        {!canApply && (
          <span className="t-caption" style={{ color: token("warn") }}>
            {t(
              draft.states.length === 0
                ? "track:stays.filter.noStatus"
                : "track:stays.filter.badSpan"
            )}
          </span>
        )}
      </form>

      {state.kind === "failed" && (
        <p className="t-body" role="alert" style={{ color: token("bad") }}>
          {t(state.key)}{" "}
          <button
            type="button"
            className="underline"
            onClick={() => void load(filter, state.next, state.stays)}
          >
            {t("track:map.retry")}
          </button>
        </p>
      )}
      {state.kind === "loaded" && state.stays.length === 0 && (
        <p className="t-body" data-testid="track-stays-empty">
          {t("track:stays.empty")}
        </p>
      )}
      {state.stays.length > 0 && (
        <ul className="flex flex-col gap-2" data-testid="track-stays-list">
          {state.stays.map((stay) => (
            <StayRow key={stay.id} stay={stay} />
          ))}
        </ul>
      )}
      {state.kind === "loading" && <p className="t-caption">{t("track:stays.loading")}</p>}
      {next && state.kind === "loaded" && (
        <Button onClick={() => void load(filter, next, state.stays)}>
          {t("track:stays.more")}
        </Button>
      )}
    </section>
  );
}

function StayRow({ stay }: { stay: TravTrackStay }): JSX.Element {
  const { t } = useTranslation(["track"]);
  const start = Date.parse(stay.startAt);
  const end = Date.parse(stay.endAt);
  const opts = { timeZone: stay.zone };
  const when = t("track:stays.when", {
    date: formatDate(start, opts),
    from: formatTime(start, opts),
    to: formatTime(end, opts),
  });
  const colour =
    stay.status === "pending"
      ? token("warn")
      : stay.status === "accepted"
        ? token("good")
        : token("muted");
  return (
    <li
      className="flex flex-wrap items-center gap-3"
      style={{ ...panelStyle, padding: 12 }}
      data-testid={`track-stay-${stay.id}`}
    >
      <span className="flex flex-col" style={{ flex: "1 1 220px" }}>
        <span style={{ fontWeight: 600 }}>
          {stay.place?.name ?? stay.name ?? t("track:stays.unnamed")}
        </span>
        <span className="t-caption tabular-nums">{when}</span>
        {stay.position === null && (
          <span className="t-caption" data-testid="track-stay-zone">
            {t("track:stays.inZone")}
          </span>
        )}
      </span>
      <span className="t-caption" style={{ color: colour, fontWeight: 600 }}>
        {t(`track:stays.state.${stay.status}`)}
      </span>
      <span className="flex flex-wrap gap-3">
        {stay.status === "pending" && (
          <Link to={stayInboxHref(stay.id)}>{t("track:stays.review")}</Link>
        )}
        {stay.status === "accepted" && stay.place && (
          <Link to={`/places/${stay.place.id}`}>{t("track:stays.openPlace")}</Link>
        )}
        {stay.status === "accepted" && stay.tripId && (
          <Link to={`/trips/${stay.tripId}`}>{t("track:stays.openTrip")}</Link>
        )}
        {stay.position !== null && <Link to={`/track/${stay.day}`}>{t("track:stays.onMap")}</Link>}
      </span>
    </li>
  );
}
