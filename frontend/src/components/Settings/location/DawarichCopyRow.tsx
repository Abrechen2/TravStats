import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { useTranslation } from "../../../hooks/useTranslation";
import { logger } from "../../../lib/logger";
import {
  dawarichCopyApi,
  dawarichCopyErrorKey,
  type DawarichCopy,
  type DawarichCopyState,
  type DawarichCopyTotals,
} from "../../../lib/api/travtrackDawarichCopy";
import { Field, Input } from "../../ui/Field";
import {
  ActionControl,
  ChoiceControl,
  JobStatus,
  SettingItem,
  useGuardedNavigate,
  type JobView,
} from "../../ui/settings";
import { DAWARICH_CONNECTION_PATH } from "./LocationSourceSection";
import { RowFailure, useRowAction } from "./useRowAction";

const NS = "settings:location.history.copy";
const COPY = "track:dawarichCopy";

/** How often a running copy's state is read again. */
export const DAWARICH_COPY_POLL_MS = 3000;
const RESUMABLE = new Set(["paused", "interrupted", "failed"]);

type Span = "whole" | "span";

/**
 * "Aus Dawarich übernehmen": copy the account's OWN Dawarich history into
 * TravTrack — all of it or a span of days — as a background job on its row.
 * Dawarich is only read. It follows the server's state, not the click: running,
 * paused (resumable), failed with the cause Dawarich gave, done, done but
 * incomplete (the hours and days it could not get stay listed), and — when the
 * state cannot be read while it runs — "ich weiß nicht, ob es fertig wurde".
 * Only the account's own connection counts (R8): without it the row says so
 * and jumps to Dienste.
 */
export default function DawarichCopyRow({
  canStart,
  onChanged,
}: {
  canStart: boolean;
  /** A copy ended: stored positions and the list of imports changed. */
  onChanged: () => void;
}): JSX.Element {
  const { t } = useTranslation(["settings", "track"]);
  const navigate = useGuardedNavigate();
  const [state, setState] = useState<DawarichCopyState | null>(null);
  const [lost, setLost] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [span, setSpan] = useState<Span>("whole");
  const [fromDay, setFromDay] = useState("");
  const [untilDay, setUntilDay] = useState("");
  const wasRunning = useRef(false);
  const onChangedRef = useRef(onChanged);
  onChangedRef.current = onChanged;
  const action = useRowAction((err) => t(dawarichCopyErrorKey(err)));

  const load = useCallback(async (): Promise<void> => {
    try {
      const next = await dawarichCopyApi.get();
      setState(next);
      setLoadFailed(false);
      setLost(false);
      const runningNow = next.copy?.status === "running";
      if (wasRunning.current && !runningNow) onChangedRef.current();
      wasRunning.current = runningNow;
    } catch (err) {
      logger.warn("TravTrack Dawarich copy: could not load", err);
      if (wasRunning.current) setLost(true);
      else setLoadFailed(true);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const copy = state?.copy ?? null;
  const running = copy?.status === "running";
  // A running copy is read again; so is one whose last read failed meanwhile.
  useEffect(() => {
    if (!running && !lost) return;
    const timer = setTimeout(() => void load(), DAWARICH_COPY_POLL_MS);
    return () => clearTimeout(timer);
  }, [running, lost, state, load]);

  const resumable = copy !== null && RESUMABLE.has(copy.status);
  const own = state?.connection === "own";
  const rangeValid = span === "whole" || (fromDay !== "" && untilDay !== "" && fromDay <= untilDay);

  const describe = (n: DawarichCopyTotals): string =>
    [
      t(`${COPY}.report.read`, { count: n.read }),
      t(`${COPY}.report.stored`, { count: n.stored }),
      n.duplicate > 0 && t(`${COPY}.report.duplicate`, { count: n.duplicate }),
      n.dropped.privacy_zone > 0 && t(`${COPY}.report.zone`, { count: n.dropped.privacy_zone }),
      n.dropped.deleted_range > 0 &&
        t(`${COPY}.report.deleted`, { count: n.dropped.deleted_range }),
      n.dropped.invalid + n.dropped.null_island > 0 &&
        t(`${COPY}.report.invalid`, { count: n.dropped.invalid + n.dropped.null_island }),
    ]
      .filter(Boolean)
      .join(" · ");

  const resume = (): void => void action.run(async () => (await dawarichCopyApi.resume(), load()));
  const jobOf = (c: DawarichCopy): JobView => {
    switch (c.status) {
      case "running":
        return {
          kind: "running",
          what: t(`${NS}.running`),
          done: c.daysDone,
          total: c.daysTotal,
        };
      case "paused":
      case "interrupted":
        return { kind: "paused", at: c.daysDone, total: c.daysTotal, onResume: resume };
      case "failed":
        return {
          kind: "failed",
          reason: c.lastErrorKind
            ? t(`${COPY}.reason.${c.lastErrorKind}`)
            : t(`${COPY}.status.failed`, { day: c.nextDay }),
          onRetry: resume,
        };
      case "complete":
        return { kind: "done", result: t(`${NS}.result`, { stored: c.totals.stored }) };
      case "incomplete":
        return { kind: "done", result: t(`${NS}.resultIncomplete`, { stored: c.totals.stored }) };
      default:
        return { kind: "done", result: t(`${COPY}.status.${c.status}`) };
    }
  };
  const job: JobView | null = lost
    ? { kind: "unknown", onCheck: () => void load() }
    : copy
      ? jobOf(copy)
      : null;
  const incomplete = copy?.months.filter(
    (m) => m.truncatedHours.length > 0 || m.unreachableDays.length > 0
  );

  const start = (): void =>
    void action.run(async () => {
      await dawarichCopyApi.start(span === "whole" ? null : { fromDay, untilDay });
      await load();
    });
  const stop = (): void => void action.run(async () => (await dawarichCopyApi.stop(), load()));

  const dependency =
    state && !own
      ? {
          reason: t(
            state.connection === "shared" ? `${COPY}.connection.shared` : `${NS}.noConnection`
          ),
          jump: {
            label: t("settings:blocks.dep.noOwnDawarich.jump"),
            onJump: () => navigate(DAWARICH_CONNECTION_PATH),
          },
        }
      : undefined;
  const canOffer = canStart && own && !running && !resumable;

  return (
    <SettingItem
      title={t(`${NS}.name`)}
      sub={t(`${NS}.sub`)}
      help={t(`${NS}.help`)}
      locked={canStart ? undefined : { why: "demo", reason: t("settings:blocks.lock.demo") }}
      dependency={dependency}
      job={job ? <JobStatus job={job} /> : undefined}
      control={
        running ? (
          <ActionControl label={t(`${NS}.stop`)} busy={action.busy} onClick={stop} />
        ) : canOffer ? (
          <ActionControl
            label={t(`${NS}.start`)}
            busy={action.busy}
            disabled={!rangeValid}
            onClick={start}
          />
        ) : undefined
      }
    >
      {canOffer ? (
        <div className="flex flex-wrap items-end" style={{ gap: "var(--ts-space-sm)" }}>
          <ChoiceControl
            value={span}
            label={t(`${NS}.name`)}
            options={[
              { value: "whole", label: t(`${NS}.whole`) },
              { value: "span", label: t(`${NS}.span`) },
            ]}
            onChange={setSpan}
          />
          {span === "span" ? (
            <>
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
            </>
          ) : null}
        </div>
      ) : null}
      {copy ? (
        <p className="t-caption" style={{ margin: 0 }}>
          {t(`${COPY}.range`, { from: copy.fromDay, until: copy.untilDay })} ·{" "}
          {describe(copy.totals)}
        </p>
      ) : null}
      {incomplete && incomplete.length > 0 ? (
        <ul className="t-caption" aria-label={t(`${NS}.gaps`)}>
          {incomplete.map((m) => (
            <li key={m.month}>
              {m.month}
              {m.truncatedHours.length > 0 &&
                ` · ${t(`${COPY}.gaps.hours`, {
                  count: m.truncatedHours.length,
                  list: m.truncatedHours.join(", "),
                })}`}
              {m.unreachableDays.length > 0 &&
                ` · ${t(`${COPY}.gaps.days`, {
                  count: m.unreachableDays.length,
                  list: m.unreachableDays.join(", "),
                })}`}
            </li>
          ))}
        </ul>
      ) : null}
      <RowFailure error={loadFailed ? t(`${NS}.loadError`) : null} onRetry={() => void load()} />
      <RowFailure error={action.error} onRetry={action.retry} />
    </SettingItem>
  );
}
