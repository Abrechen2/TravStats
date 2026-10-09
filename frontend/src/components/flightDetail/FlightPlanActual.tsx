import type { JSX, ReactNode } from "react";
import { useTranslation } from "../../hooks/useTranslation";
import { minutesText } from "../../lib/flights/minutesText";
import { formatLocalClock, formatTimeValueShown } from "../../lib/displayFormat";
import {
  flightPlanActual,
  type Deviation,
  type EndComparison,
} from "../../lib/flights/planVsActual";
import { clockOf, readsAsUtc, type TimeValue } from "../../shared/time";
import type { Flight } from "../../types";
import YourTimeHint from "../time/YourTimeHint";

type Translate = (key: string, options?: Record<string, unknown>) => string;

/**
 * The deviation spelled out. Colour is never the only signal (forgejo#216):
 * the sign, the word "später"/"früher" and "unbekannt" carry the meaning, and
 * the tone only repeats it.
 */
export function deviationText(deviation: Deviation, t: Translate): string {
  if (deviation.kind === "unknown") return t("flights:planActual.unknown");
  if (deviation.minutes === 0) return t("flights:planActual.onTime");
  const duration = minutesText(deviation.minutes, t);
  return deviation.minutes > 0
    ? t("flights:planActual.later", { duration })
    : t("flights:planActual.earlier", { duration });
}

function dayShiftText(shift: number | null, t: Translate): string | null {
  if (shift === null || shift === 0) return null;
  return shift > 0
    ? t("flights:planActual.dayShiftLater", { count: shift })
    : t("flights:planActual.dayShiftEarlier", { count: -shift });
}

function arrivalDayText(offset: number | null, t: Translate): string | null {
  if (offset === null || offset === 0) return null;
  return offset > 0
    ? t("flights:planActual.arrivalLaterDay", { count: offset })
    : t("flights:planActual.arrivalEarlierDay", { count: -offset });
}

/** The airport's zone as the value carries it; "UTC" with a reason where none is known. */
function zoneText(value: TimeValue, t: Translate): string {
  // A time recorded without a zone (`UNKNOWN` semantics): the AIRPORT's zone
  // may well be known — it is the time that has none (review M5).
  if (value.precision === "unknown") return t("flights:planActual.zoneNotRecorded");
  if (readsAsUtc(value)) return t("flights:planActual.zoneUnknown");
  if (!value.zone) return `UTC${value.offset}`;
  return value.precision === "minute" ? `${value.zone} · UTC${value.offset}` : value.zone;
}

function TimeCell({
  label,
  value,
  emptyText,
  note,
  testId,
}: {
  label: string;
  value: TimeValue | null;
  emptyText: string;
  note: string | null;
  testId: string;
}): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const clock = value ? clockOf(value) : null;
  return (
    <div className="flex min-w-0 flex-col" style={{ gap: 2 }} data-testid={testId}>
      <dt className="t-caption">{label}</dt>
      <dd className="flex min-w-0 flex-col" style={{ gap: 2 }}>
        {value ? (
          <>
            <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ts-text-bright)" }}>
              {/* Cut to its precision: a month-precise value shows no day (review M5). */}
              {formatTimeValueShown(value, { dateOnly: true })}
              {clock ? (
                <span style={{ fontFamily: "var(--ts-font-mono)", marginLeft: 6 }}>
                  {formatLocalClock(clock)}
                </span>
              ) : (
                <span className="t-caption" style={{ marginLeft: 6 }}>
                  {t("flights:planActual.clockUnknown")}
                </span>
              )}
            </span>
            <span className="t-caption break-words">{zoneText(value, t)}</span>
            {note ? (
              <span className="t-caption" style={{ fontWeight: 600 }}>
                {note}
              </span>
            ) : null}
            <YourTimeHint value={value} />
          </>
        ) : (
          <span className="t-caption" style={{ fontStyle: "italic" }}>
            {emptyText}
          </span>
        )}
      </dd>
    </div>
  );
}

function DeviationCell({
  deviation,
  testId,
}: {
  deviation: Deviation;
  testId: string;
}): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const tone =
    deviation.kind === "minutes" && deviation.minutes > 0
      ? "var(--ts-warn)"
      : "var(--ts-text-bright)";
  return (
    <div className="flex min-w-0 flex-col" style={{ gap: 2 }} data-testid={testId}>
      <dt className="t-caption">{t("flights:planActual.deviation")}</dt>
      <dd className="flex flex-col" style={{ gap: 2 }}>
        <span style={{ fontSize: 14, fontWeight: 600, color: tone }}>
          {deviationText(deviation, t)}
        </span>
        {deviation.kind === "unknown" ? (
          <span className="t-caption">
            {t(`flights:planActual.unknownReason.${deviation.reason}`)}
          </span>
        ) : null}
      </dd>
    </div>
  );
}

function EndRow({
  title,
  end,
  plannedNote,
  actualNote,
  testId,
}: {
  title: string;
  end: EndComparison;
  plannedNote: string | null;
  actualNote: string | null;
  testId: string;
}): ReactNode {
  const { t } = useTranslation(["flights"]);
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-sm)" }} data-testid={testId}>
      <h3 className="t-label-mono">{title}</h3>
      <dl
        className="grid grid-cols-1 sm:grid-cols-3"
        style={{ gap: "var(--ts-space-md) var(--ts-space-xl)" }}
      >
        <TimeCell
          label={t("flights:planActual.planned")}
          value={end.planned}
          emptyText={t("flights:planActual.plannedMissing")}
          note={plannedNote}
          testId={`${testId}-planned`}
        />
        <TimeCell
          label={t("flights:planActual.actual")}
          value={end.actual}
          emptyText={t("flights:planActual.unknown")}
          note={actualNote}
          testId={`${testId}-actual`}
        />
        <DeviationCell deviation={end.deviation} testId={`${testId}-deviation`} />
      </dl>
    </div>
  );
}

/**
 * Plan and record side by side for each end of a flight (forgejo#216): the
 * airport's local date and clock, its zone, the deviation in words, and a day
 * change named out loud. Everything shown comes from `TimeValue.local` as the
 * server wrote it; the deviation is measured on `utc` (lib/flights/planVsActual).
 */
export default function FlightPlanActual({ flight }: { flight: Flight }): JSX.Element {
  const { t } = useTranslation(["flights"]);
  const view = flightPlanActual(flight);
  const dayShiftNote = (end: EndComparison): string | null => dayShiftText(end.actualDayShift, t);
  const join = (...parts: Array<string | null>): string | null =>
    parts.filter(Boolean).join(" · ") || null;
  return (
    <div className="flex flex-col" style={{ gap: "var(--ts-space-lg)" }}>
      <EndRow
        title={t("flights:planActual.departure")}
        end={view.departure}
        plannedNote={null}
        actualNote={dayShiftNote(view.departure)}
        testId="plan-actual-departure"
      />
      <EndRow
        title={t("flights:planActual.arrival")}
        end={view.arrival}
        plannedNote={arrivalDayText(view.plannedArrivalDayOffset, t)}
        actualNote={join(
          arrivalDayText(view.actualArrivalDayOffset, t),
          dayShiftNote(view.arrival)
        )}
        testId="plan-actual-arrival"
      />
    </div>
  );
}
