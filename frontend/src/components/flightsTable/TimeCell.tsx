import type { Flight } from "../../types";
import { useTranslation } from "../../hooks/useTranslation";
import { dayShift } from "../../lib/dayShift";

const dateFmt = (iso: string, tz: string, lang: string): string =>
  new Intl.DateTimeFormat(lang === "de" ? "de-DE" : "en-GB", {
    weekday: "short", day: "2-digit", month: "2-digit", year: "2-digit", timeZone: tz,
  }).format(new Date(iso));

const timeFmt = (iso: string, tz: string): string =>
  new Intl.DateTimeFormat("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: tz })
    .format(new Date(iso));

/** One ab/an row pair: weekday + compact date + airport-local time, +N overnight marker. */
export default function TimeCell({ flight }: { flight: Flight }): JSX.Element {
  const { t, i18n } = useTranslation(["flights"]);
  const dateOnly =
    flight.depTimeSemantics === "DATE_ONLY" || flight.depTimeSemantics === "UNKNOWN";
  const depTz = flight.depTimezone || "UTC";
  const arrTz = flight.arrTimezone || "UTC";
  const shift =
    !dateOnly && flight.departureTime && flight.arrivalTime
      ? dayShift(flight.departureTime, flight.arrivalTime, depTz, arrTz)
      : 0;

  const row = (label: string, iso: string | null | undefined, tz: string, marker?: number) => (
    <div className="flex items-baseline gap-2 whitespace-nowrap text-[12.5px]" style={{ fontVariantNumeric: "tabular-nums" }}>
      <span className="w-4 text-[10px]" style={{ color: "var(--text-muted)" }}>{label}</span>
      {iso ? (
        <>
          <span style={{ color: "var(--text-primary)" }}>{dateFmt(iso, tz, i18n.language)}</span>
          {!dateOnly && <span style={{ color: "var(--text-muted)" }}>{timeFmt(iso, tz)}</span>}
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
      {row(t("flights:table.timeDep"), flight.departureTime, depTz)}
      {row(t("flights:table.timeArr"), flight.arrivalTime, arrTz, shift)}
    </div>
  );
}
