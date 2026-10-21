// The rows a route card prints from `getJourneyRouteFigures` — first/last,
// durations, delay and the rental figures. A figure that abstained is a row
// that is not drawn: the card never prints 0 for "unknown".

import type { JSX } from "react";
import { formatAmount } from "../../../../lib/units";
import { Row, formatDuration, type TFn } from "../cardChrome";
import type { CurrencyFigure, JourneyRouteFigures } from "./journeyRouteFigures";
import type { MapJourney } from "./journeyTypes";
import { journeySpanDay } from "./journeyCardParts";

/** "−3 min", "+12 min", or "pünktlich" for an average that rounds to 0. */
export function delayText(averageMin: number, t: TFn): string {
  const minutes = Math.round(averageMin);
  if (minutes === 0) return t("map:journey.onTime");
  return t("map:journey.delayValue", {
    minutes: `${minutes > 0 ? "+" : "−"}${Math.abs(minutes)}`,
  });
}

/** "40 € · 35 US$" — one amount per currency, never their sum. */
export function perCurrencyText(figures: readonly CurrencyFigure[], language: string): string {
  return figures.map((f) => formatAmount(f.amount, f.currency, { language })).join(" · ");
}

function sample(count: number, domain: MapJourney["domain"], t: TFn): string {
  return t(domain === "rental" ? "map:journey.sampleRentals" : "map:journey.sampleRides", {
    count,
  });
}

function DatedRow({
  label,
  journey,
}: {
  label: string;
  journey: MapJourney | null;
}): JSX.Element | null {
  if (!journey) return null;
  const day = journeySpanDay(journey);
  return day ? <Row label={label} value={day} /> : null;
}

function DurationRows({
  figures,
  byId,
  domain,
  t,
}: {
  figures: JourneyRouteFigures;
  byId: ReadonlyMap<string, MapJourney>;
  domain: MapJourney["domain"];
  t: TFn;
}): JSX.Element | null {
  const d = figures.duration;
  if (!d) return null;
  const ranked = (minutes: number, id: string): string => {
    const j = byId.get(id);
    const day = j ? journeySpanDay(j) : "";
    return [formatDuration(minutes, t), day].filter(Boolean).join(" · ");
  };
  return (
    <>
      <Row
        label={t(d.measured === 1 ? "map:journey.fact.duration" : "map:journey.avgDuration")}
        value={
          d.measured === 1
            ? formatDuration(d.averageMin, t)
            : `${formatDuration(d.averageMin, t)} (${sample(d.measured, domain, t)})`
        }
      />
      {d.fastest && d.slowest && d.fastest.minutes !== d.slowest.minutes && (
        <>
          <Row
            label={t("map:journey.fastest")}
            value={ranked(d.fastest.minutes, d.fastest.journeyId)}
          />
          <Row
            label={t("map:journey.slowest")}
            value={ranked(d.slowest.minutes, d.slowest.journeyId)}
          />
        </>
      )}
    </>
  );
}

function RentalRows({
  figures,
  language,
  t,
}: {
  figures: NonNullable<JourneyRouteFigures["rental"]>;
  language: string;
  t: TFn;
}): JSX.Element {
  return (
    <>
      {figures.averageDays !== null && (
        <Row
          label={t(
            figures.daysMeasured === 1 ? "map:journey.fact.rentalDays" : "map:journey.avgRentalDays"
          )}
          value={figures.averageDays.toLocaleString(language)}
        />
      )}
      {figures.kmPerDay !== null && (
        <Row
          label={t("map:journey.kmPerDay")}
          value={`${Math.round(figures.kmPerDay).toLocaleString(language)} km`}
        />
      )}
      {figures.costPerDay.length > 0 && (
        <Row
          label={t("map:journey.costPerDay")}
          value={perCurrencyText(figures.costPerDay, language)}
        />
      )}
      {figures.costPerKm.length > 0 && (
        <Row
          label={t("map:journey.costPerKm")}
          value={perCurrencyText(figures.costPerKm, language)}
        />
      )}
    </>
  );
}

/** Every derivable figure of a route, in the card's metadata grid. */
export function RouteFigureRows({
  figures,
  journeys,
  domain,
  language,
  t,
}: {
  figures: JourneyRouteFigures;
  journeys: readonly MapJourney[];
  domain: MapJourney["domain"];
  language: string;
  t: TFn;
}): JSX.Element {
  const byId = new Map(journeys.map((j) => [j.id, j]));
  return (
    <>
      <DatedRow label={t("map:journey.first")} journey={figures.first} />
      <DurationRows figures={figures} byId={byId} domain={domain} t={t} />
      {figures.delay && (
        <Row
          label={t("map:journey.avgDelay")}
          value={`${delayText(figures.delay.averageMin, t)} (${sample(figures.delay.measured, domain, t)})`}
        />
      )}
      {figures.rental && <RentalRows figures={figures.rental} language={language} t={t} />}
    </>
  );
}
