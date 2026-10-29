import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { JSX } from "react";
import Button from "../ui/Button";
import { Field, Input, Select } from "../ui/Field";
import { alpha, token } from "../ui/tokens";
import { useTranslation } from "../../hooks/useTranslation";
import { useConfirmDialog } from "../../hooks/useConfirmDialog";
import { formatTime } from "../../lib/displayFormat";
import { downloadBlob } from "../../lib/export";
import { logger } from "../../lib/logger";
import { trackErrorKey } from "../../lib/api/travtrack";
import {
  travTrackDiagnosticsApi,
  type DiagnosticsDay,
  type DiagnosticsGap,
} from "../../lib/api/travtrackDiagnostics";

const NS = "track:settings.diagnostics";
const HOUR = 3_600_000;

/** Stored points and logged fixes per hour of the day read. */
export function hourBars(day: DiagnosticsDay): { at: string; points: number; fixes: number }[] {
  const from = Date.parse(day.from);
  const hours = Math.max(1, Math.ceil((Date.parse(day.until) - from) / HOUR));
  // Each bar is a real hour from the day's start, labelled by its own instant:
  // a day with a clock change has 23 or 25 of them.
  const bars = Array.from({ length: hours }, (_, i) => ({
    at: new Date(from + i * HOUR).toISOString(),
    points: 0,
    fixes: 0,
  }));
  const at = (iso: string) => Math.floor((Date.parse(iso) - from) / HOUR);
  for (const p of day.pointsPerMinute) {
    const i = at(p.t);
    if (bars[i]) bars[i] = { ...bars[i], points: bars[i].points + p.n };
  }
  for (const f of day.fixesPerMinute) {
    const i = at(f.t);
    if (bars[i]) bars[i] = { ...bars[i], fixes: bars[i].fixes + f.received };
  }
  return bars;
}

/**
 * The phone's diagnostics log in Settings → TravTrack (spec
 * 2026-10-29-travtrack-diagnostics): one device's day, its point-free
 * stretches and the cause the log supports for each, the raw log as a file,
 * and delete. The cause is never stronger than the log: a stretch the phone
 * said nothing about reads "unexplained", not "the app ran".
 */
export default function TravTrackDiagnostics({
  today,
  canDelete,
}: {
  today: string;
  canDelete: boolean;
}): JSX.Element {
  const { t } = useTranslation(["track"]);
  const { confirmDelete, confirmDialog } = useConfirmDialog();
  const [date, setDate] = useState(today);
  const [deviceId, setDeviceId] = useState<string | undefined>(undefined);
  const [day, setDay] = useState<DiagnosticsDay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Each read carries its number: an answer to an older date or device that
  // arrives late must not show its causes under the newer choice.
  const latest = useRef(0);
  const load = useCallback(async () => {
    const mine = ++latest.current;
    try {
      const read = await travTrackDiagnosticsApi.day(date, deviceId);
      if (mine !== latest.current) return;
      setDay(read);
      setError(null);
    } catch (err) {
      if (mine !== latest.current) return;
      logger.warn("TravTrack diagnostics: day not loaded", err);
      setDay(null);
      setError(t(trackErrorKey(err)));
    }
  }, [date, deviceId, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const bars = useMemo(() => (day ? hourBars(day) : []), [day]);
  const peak = Math.max(1, ...bars.map((b) => Math.max(b.points, b.fixes)));
  const time = (iso: string) => (day ? formatTime(iso, { timeZone: day.zone }) : "");

  const download = async () => {
    if (!day) return;
    setBusy(true);
    try {
      const blob = await travTrackDiagnosticsApi.exportBlob(
        day.from,
        day.until,
        day.deviceId ?? undefined
      );
      downloadBlob(blob, `travtrack-diagnostics-${day.date}.json`);
    } catch (err) {
      logger.warn("TravTrack diagnostics: export failed", err);
      setError(t(trackErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!(await confirmDelete(t(`${NS}.deleteConfirm`)))) return;
    setBusy(true);
    try {
      await travTrackDiagnosticsApi.deleteAll();
      await load();
    } catch (err) {
      logger.warn("TravTrack diagnostics: delete failed", err);
      setError(t(trackErrorKey(err)));
    } finally {
      setBusy(false);
    }
  };

  const evidence = (gap: DiagnosticsGap): string => {
    const e = gap.evidence;
    const parts: string[] = [];
    if (e.fixesReceived > 0) {
      parts.push(t(`${NS}.evidence.fixes`, { received: e.fixesReceived, kept: e.fixesKept }));
    }
    const dropped = Object.entries(e.dropped)
      .filter(([, n]) => n > 0)
      .map(([reason, n]) => `${t(`${NS}.dropReason.${reason}`, { defaultValue: reason })} ${n}`);
    if (dropped.length > 0) parts.push(t(`${NS}.evidence.dropped`, { list: dropped.join(", ") }));
    for (const u of e.uploads) {
      parts.push(
        t(`${NS}.evidence.upload`, {
          status: u.status === null ? "?" : u.status === 0 ? t(`${NS}.evidence.network`) : u.status,
        })
      );
    }
    if (e.reportedReason) {
      parts.push(t(`${NS}.reported.${e.reportedReason}`, { defaultValue: e.reportedReason }));
    }
    if (e.permission && e.permission !== "always") {
      parts.push(t(`${NS}.evidence.permission`, { status: e.permission }));
    }
    return parts.join(" · ");
  };

  return (
    <div
      className="flex flex-col"
      style={{ gap: "var(--ts-space-sm)" }}
      data-testid="travtrack-diagnostics"
    >
      <h3 className="t-card-title" style={{ marginTop: "var(--ts-space-lg)" }}>
        {t(`${NS}.title`)}
      </h3>
      <p className="t-caption">{t(`${NS}.intro`)}</p>

      <div className="flex flex-wrap items-end" style={{ gap: "var(--ts-space-sm)" }}>
        <Field label={t(`${NS}.day`)} htmlFor="travtrack-diag-day">
          <Input
            id="travtrack-diag-day"
            type="date"
            value={date}
            max={today}
            onChange={(e) => {
              if (!e.target.value) return;
              // Another day may hold another phone: start from that day's busiest.
              setDeviceId(undefined);
              setDate(e.target.value);
            }}
          />
        </Field>
        {day &&
          (day.devices.length > 1 ||
            (day.deviceId !== null && !day.devices.some((d) => d.deviceId === day.deviceId))) && (
            <Field label={t(`${NS}.device`)} htmlFor="travtrack-diag-device">
              <Select
                id="travtrack-diag-device"
                value={day.deviceId ?? ""}
                onChange={(e) => setDeviceId(e.target.value)}
              >
                {day.devices.map((d) => (
                  <option key={d.deviceId} value={d.deviceId}>
                    {d.label ?? d.model ?? d.deviceId}
                  </option>
                ))}
              </Select>
            </Field>
          )}
        <Button disabled={busy || !day?.hasLog} onClick={() => void download()}>
          {t(`${NS}.download`)}
        </Button>
        {canDelete && (
          <Button disabled={busy} onClick={() => void remove()}>
            {t(`${NS}.delete`)}
          </Button>
        )}
      </div>

      {error && (
        <p className="t-body" role="alert" style={{ color: token("bad") }}>
          {error}
        </p>
      )}

      {day && !day.hasLog && (
        <p className="t-body" role="status" data-testid="travtrack-diag-nolog">
          {t(`${NS}.noLog`)}
        </p>
      )}

      {day && bars.length > 0 && (day.hasLog || day.pointsPerMinute.length > 0) && (
        <>
          <div
            role="img"
            aria-label={t(`${NS}.barsLabel`)}
            className="flex items-end"
            style={{ gap: 2, height: 64 }}
          >
            {bars.map((b) => (
              <div
                key={b.at}
                className="flex items-end"
                style={{ flex: 1, gap: 1, height: "100%" }}
                title={t(`${NS}.barTitle`, { time: time(b.at), points: b.points, fixes: b.fixes })}
              >
                <div
                  style={{
                    flex: 1,
                    height: `${(b.points / peak) * 100}%`,
                    background: "var(--area-track)",
                  }}
                />
                <div
                  style={{
                    flex: 1,
                    height: `${(b.fixes / peak) * 100}%`,
                    background: alpha(token("muted"), 60),
                  }}
                />
              </div>
            ))}
          </div>
          <p className="t-caption">{t(`${NS}.legend`)}</p>
        </>
      )}

      {day && day.gaps.length > 0 && (
        <ul
          className="flex flex-col"
          style={{ gap: "var(--ts-space-xs)" }}
          data-testid="travtrack-diag-gaps"
        >
          {day.gaps.map((gap) => (
            <li key={`${gap.from}-${gap.cause}`} className="t-body">
              <strong>
                {time(gap.from)}–{time(gap.to)} · {t(`${NS}.minutes`, { count: gap.minutes })}
              </strong>{" "}
              {t(`${NS}.cause.${gap.cause}`)}
              {evidence(gap) && (
                <span className="t-caption" style={{ display: "block" }}>
                  {evidence(gap)}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {day && day.hasLog && day.gaps.length === 0 && <p className="t-body">{t(`${NS}.noGaps`)}</p>}
      {day?.eventsTruncated && <p className="t-caption">{t(`${NS}.truncated`)}</p>}
      {confirmDialog}
    </div>
  );
}
