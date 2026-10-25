import { useCallback, useEffect, useRef, useState } from "react";
import type { JSX } from "react";
import Button from "../ui/Button";
import { Field, Input } from "../ui/Field";
import { token } from "../ui/tokens";
import { useTranslation } from "../../hooks/useTranslation";
import { logger } from "../../lib/logger";
import {
  dawarichCopyApi,
  dawarichCopyErrorKey,
  type DawarichCopy,
  type DawarichCopyState,
  type DawarichCopyTotals,
} from "../../lib/api/travtrackDawarichCopy";

const NS = "track:dawarichCopy";

/** How often a running copy's state is read again. */
export const DAWARICH_COPY_POLL_MS = 3000;

const RESUMABLE = new Set(["paused", "interrupted", "failed"]);

/**
 * "Dawarich-Verlauf übernehmen" in the TravTrack settings card (TravTrack plan
 * L6): copy the account's own Dawarich history into TravTrack — the whole of
 * it or a chosen span of days — follow it, pause and resume it, and read how
 * complete it is: never just "fertig", but the totals, and for an incomplete
 * copy the hours and days it could not get, per month. Deleting the copy is
 * deleting its import in the list of imports.
 *
 * `canStart` is false while TravTrack is off (or for the demo account): the
 * state stays readable, starting and resuming do not.
 */
export default function TravTrackDawarichCopy({
  canStart,
  onChanged,
}: {
  canStart: boolean;
  /** The stored positions or the list of imports changed. */
  onChanged: () => void;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  const [state, setState] = useState<DawarichCopyState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [whole, setWhole] = useState(true);
  const [fromDay, setFromDay] = useState("");
  const [untilDay, setUntilDay] = useState("");
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const wasRunning = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await dawarichCopyApi.get();
      setState(next);
      setLoadError(null);
      const runningNow = next.copy?.status === "running";
      if (wasRunning.current && !runningNow) onChanged();
      wasRunning.current = runningNow;
    } catch (err) {
      logger.warn("TravTrack Dawarich copy: could not load", err);
      setLoadError(dawarichCopyErrorKey(err));
    }
  }, [onChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  const running = state?.copy?.status === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(() => void load(), DAWARICH_COPY_POLL_MS);
    return () => clearTimeout(timer);
  }, [running, state, load]);

  const act = async (work: () => Promise<unknown>) => {
    setBusy(true);
    setRefusal(null);
    try {
      await work();
      await load();
    } catch (err) {
      logger.warn("TravTrack Dawarich copy: refused", err);
      setRefusal(dawarichCopyErrorKey(err));
    } finally {
      setBusy(false);
    }
  };

  const describe = (n: DawarichCopyTotals) =>
    [
      t(`${NS}.report.read`, { count: n.read }),
      t(`${NS}.report.stored`, { count: n.stored }),
      n.duplicate > 0 && t(`${NS}.report.duplicate`, { count: n.duplicate }),
      n.dropped.privacy_zone > 0 && t(`${NS}.report.zone`, { count: n.dropped.privacy_zone }),
      n.dropped.deleted_range > 0 && t(`${NS}.report.deleted`, { count: n.dropped.deleted_range }),
      n.dropped.invalid + n.dropped.null_island > 0 &&
        t(`${NS}.report.invalid`, { count: n.dropped.invalid + n.dropped.null_island }),
    ]
      .filter(Boolean)
      .join(" · ");

  const statusLine = (copy: DawarichCopy) => {
    const range = t(`${NS}.range`, { from: copy.fromDay, until: copy.untilDay });
    if (copy.status === "running") {
      return `${t(`${NS}.status.running`, { done: copy.daysDone, total: copy.daysTotal })} · ${range}`;
    }
    if (RESUMABLE.has(copy.status)) {
      const why = copy.lastErrorKind ? t(`${NS}.reason.${copy.lastErrorKind}`) : "";
      return [t(`${NS}.status.${copy.status}`, { day: copy.nextDay }), why, range]
        .filter(Boolean)
        .join(" · ");
    }
    return `${t(`${NS}.status.${copy.status}`)} · ${range}`;
  };

  const rangeValid = whole || (fromDay !== "" && untilDay !== "" && fromDay <= untilDay);
  const copy = state?.copy ?? null;
  const canResume = canStart && copy !== null && RESUMABLE.has(copy.status);
  const incomplete = copy?.months.filter(
    (m) => m.truncatedHours.length > 0 || m.unreachableDays.length > 0
  );

  return (
    <>
      <h3 className="t-card-title" style={{ marginTop: "var(--ts-space-lg)" }}>
        {t(`${NS}.title`)}
      </h3>
      <p className="t-caption">{t(`${NS}.intro`)}</p>
      {state?.connection === "none" && <p className="t-body">{t(`${NS}.connection.none`)}</p>}
      {state?.connection === "shared" && <p className="t-body">{t(`${NS}.connection.shared`)}</p>}

      {copy && (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-xs)" }}>
          <p className="t-body" role="status">
            {statusLine(copy)}
          </p>
          <p className="t-body">{describe(copy.totals)}</p>
          {incomplete && incomplete.length > 0 && (
            <ul className="t-caption" aria-label={t(`${NS}.gaps.title`)}>
              {incomplete.map((m) => (
                <li key={m.month}>
                  {m.month}
                  {m.truncatedHours.length > 0 &&
                    ` · ${t(`${NS}.gaps.hours`, {
                      count: m.truncatedHours.length,
                      list: m.truncatedHours.join(", "),
                    })}`}
                  {m.unreachableDays.length > 0 &&
                    ` · ${t(`${NS}.gaps.days`, {
                      count: m.unreachableDays.length,
                      list: m.unreachableDays.join(", "),
                    })}`}
                </li>
              ))}
            </ul>
          )}
          <div className="flex" style={{ gap: "var(--ts-space-sm)" }}>
            {running && (
              <Button disabled={busy} onClick={() => void act(() => dawarichCopyApi.stop())}>
                {t(`${NS}.stop`)}
              </Button>
            )}
            {canResume && state?.connection === "own" && (
              <Button disabled={busy} onClick={() => void act(() => dawarichCopyApi.resume())}>
                {t(`${NS}.resume`)}
              </Button>
            )}
          </div>
        </div>
      )}

      {canStart && state?.connection === "own" && !running && (
        <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }}>
          <label className="t-body">
            <input type="radio" checked={whole} onChange={() => setWhole(true)} />{" "}
            {t(`${NS}.whole`)}
          </label>
          <label className="t-body">
            <input type="radio" checked={!whole} onChange={() => setWhole(false)} />{" "}
            {t(`${NS}.span`)}
          </label>
          {!whole && (
            <div className="flex" style={{ gap: "var(--ts-space-md)" }}>
              <Field label={t(`${NS}.from`)} htmlFor="travtrack-dawarich-from">
                <Input
                  id="travtrack-dawarich-from"
                  type="date"
                  value={fromDay}
                  onChange={(e) => setFromDay(e.target.value)}
                />
              </Field>
              <Field label={t(`${NS}.until`)} htmlFor="travtrack-dawarich-until">
                <Input
                  id="travtrack-dawarich-until"
                  type="date"
                  value={untilDay}
                  onChange={(e) => setUntilDay(e.target.value)}
                />
              </Field>
            </div>
          )}
          <div>
            <Button
              disabled={busy || !rangeValid}
              onClick={() =>
                void act(() => dawarichCopyApi.start(whole ? null : { fromDay, untilDay }))
              }
            >
              {t(`${NS}.start`)}
            </Button>
          </div>
        </div>
      )}

      {loadError && (
        <p className="t-body" role="alert" style={{ color: token("bad") }}>
          {t(loadError)}
        </p>
      )}
      {refusal && (
        <p className="t-body" role="alert" style={{ color: token("bad") }}>
          {t(refusal)}
        </p>
      )}
    </>
  );
}
