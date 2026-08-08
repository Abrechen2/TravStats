import type { Flight } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { dayShift } from "../../lib/dayShift";

const dateFmt = (iso: string, tz: string, lang: string): string =>
  new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", {
    weekday: "short", day: "2-digit", month: "2-digit", year: "2-digit", timeZone: tz,
  })
    .format(new Date(iso))
    // de-DE renders "Mo., 09.11.26" — the mockup wants the bare "Mo 09.11.26".
    .replace(".,", "");

const timeFmt = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: tz })
    .format(new Date(iso));

type DelayState = "late" | "early" | "onTime";

/** Minute-resolution comparison; seconds never appear on screen. */
const delayState = (scheduled: string, actual: string): DelayState => {
  const diff =
    Math.floor(new Date(actual).getTime() / 60000) -
    Math.floor(new Date(scheduled).getTime() / 60000);
  if (diff > 0) return "late";
  if (diff < 0) return "early";
  return "onTime";
};

const DELAY_COLOR: Record<DelayState, string> = {
  late: "var(--danger)",
  early: "var(--success)",
  onTime: "var(--text-muted)",
};

/** One ab/an row pair: weekday + compact date + airport-local time, +N overnight marker. */
export default function TimeCell({ flight }: { flight: Flight }): JSX.Element {
  const { t, i18n } = useTranslation(["flights"]);
  const isDateOnly = (s: Flight["depTimeSemantics"]) => s === "DATE_ONLY" || s === "UNKNOWN";
  const depDateOnly = isDateOnly(flight.depTimeSemantics);
  const arrDateOnly = isDateOnly(flight.arrTimeSemantics);
  const depTz = flight.depTimezone || "UTC";
  const arrTz = flight.arrTimezone || "UTC";
  const shift =
    !depDateOnly && !arrDateOnly && flight.departureTime && flight.arrivalTime
      ? dayShift(flight.departureTime, flight.arrivalTime, depTz, arrTz)
      : 0;

  const row = (
    label: string,
    iso: string | null | undefined,
    tz: string,
    showTime: boolean,
    tzKnown: boolean,
    actualIso?: string | null,
    marker?: number,
  ) => (
    <div className="flex items-baseline gap-2 whitespace-nowrap text-[12.5px]" style={{ fontVariantNumeric: "tabular-nums" }}>
      <span className="w-4 text-[10px]" style={{ color: "var(--text-muted)" }}>{label}</span>
      {iso ? (
        <>
          <span style={{ color: "var(--text-primary)" }}>{dateFmt(iso, tz, i18n.language)}</span>
          {showTime && <span style={{ color: "var(--text-muted)" }}>{timeFmt(iso, tz)}</span>}
          {/* The recorded time, beside the planned one rather than replacing
              it — the point is the difference between the two. Formatted in
              the SAME airport timezone, or the comparison would read as a
              delay of whole hours. */}
          {showTime && actualIso && (
            <span
              data-delay={delayState(iso, actualIso)}
              className="font-semibold"
              style={{ color: DELAY_COLOR[delayState(iso, actualIso)] }}
              title={t("flights:actualTimes.label")}
            >
              {timeFmt(actualIso, tz)}
            </span>
          )}
          {/* Without an airport timezone the clock above is UTC. Rendering it
              bare made it indistinguishable from a real local time, so a
              missing catalogue entry read as a confident wrong answer. */}
          {showTime && !tzKnown && (
            <span
              className="text-[9px] font-semibold tracking-wide"
              style={{ color: "var(--text-muted)", opacity: 0.8 }}
              title={t("flights:table.timeUtcFallback")}
            >
              UTC
            </span>
          )}
          {marker !== undefined && marker >= 1 && (
            <span className="text-[10px] font-semibold" style={{ color: "var(--accent)" }}>+{marker}</span>
          )}
        </>
      ) : (
        <span style={{ color: "var(--text-muted)" }}>—</span>
      )}
    </div>
  );

  return (
    <div className="flex flex-col gap-0.5">
      {row(
        t("flights:table.timeDep"),
        flight.departureTime,
        depTz,
        !depDateOnly,
        !!flight.depTimezone,
        flight.actualDeparture,
      )}
      {row(
        t("flights:table.timeArr"),
        flight.arrivalTime,
        arrTz,
        !arrDateOnly,
        !!flight.arrTimezone,
        flight.actualArrival,
        shift,
      )}
    </div>
  );
}
