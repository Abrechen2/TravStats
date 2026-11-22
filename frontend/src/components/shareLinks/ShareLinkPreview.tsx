import type { JSX } from "react";

import { useTranslation } from "../../hooks/useTranslation";
import { useDisplayFormat } from "../../lib/displayFormat";
import type { ShareView } from "../../types/shareLinks";
import ShareLinkItineraryPreview from "./ShareLinkItineraryPreview";

const NS = "sharing:links";

type Row = [label: string, value: string];

/**
 * The public view as the owner previews it (forgejo#281): the same payload
 * the link's page receives, written out as label/value rows — so what is
 * listed here is what a stranger can read, and nothing else.
 */
export default function ShareLinkPreview({ view }: { view: ShareView }): JSX.Element {
  const { t } = useTranslation(["sharing"]);
  const format = useDisplayFormat();
  const label = (kind: string, field: string) => t(`${NS}.fields.${kind}.${field}`);
  const none = t(`${NS}.view.none`);
  const rows: Row[] = [];

  if (view.kind === "trip") {
    const trip = view.trip;
    if (trip.owner !== undefined) rows.push([label("trip", "owner"), trip.owner ?? none]);
    if (trip.name !== undefined) rows.push([label("trip", "name"), trip.name]);
    if (trip.dates) {
      const days = [trip.dates.start, trip.dates.end]
        .map((d) => (d ? format.localDate(d.date) : null))
        .filter(Boolean);
      rows.push([label("trip", "dates"), days.join(" – ") || none]);
    }
    if (trip.totals) {
      const tt = trip.totals;
      rows.push([t(`${NS}.view.flights`), String(tt.flights)]);
      if (tt.flightKm !== null) rows.push([t(`${NS}.view.km`), String(tt.flightKm)]);
      rows.push([t(`${NS}.view.countries`), String(tt.countries)]);
      if (tt.days !== null) rows.push([t(`${NS}.view.days`), String(tt.days)]);
    }
    if (trip.countries) rows.push([label("trip", "countries"), trip.countries.join(", ") || none]);
    if (trip.route) {
      rows.push([
        label("trip", "route"),
        trip.route.map((leg) => `${leg.from ?? "?"} → ${leg.to ?? "?"}`).join(", ") || none,
      ]);
    }
    if (trip.photos) {
      rows.push([label("trip", "photos"), t(`${NS}.view.photos`, { count: trip.photos.count })]);
    }
  } else {
    const w = view.wrapped;
    rows.push([t(`${NS}.view.year`, { year: w.year }), ""]);
    if (w.owner !== undefined) rows.push([label("wrapped", "owner"), w.owner ?? none]);
    if (w.totals) {
      // Null = not shown to this owner / not measured: no row, never "0" or "null".
      if (w.totals.flights !== null) rows.push([t(`${NS}.view.flights`), String(w.totals.flights)]);
      if (w.totals.distanceKm !== null) {
        rows.push([t(`${NS}.view.km`), String(Math.round(w.totals.distanceKm))]);
      }
    }
    if (w.topAirline !== undefined) {
      rows.push([label("wrapped", "topAirline"), w.topAirline?.name ?? none]);
    }
    if (w.topRoute !== undefined) {
      rows.push([
        label("wrapped", "topRoute"),
        w.topRoute ? `${w.topRoute.from} ↔ ${w.topRoute.to}` : none,
      ]);
    }
  }

  const itinerary = view.kind === "trip" ? view.trip.itinerary : undefined;
  return (
    <>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm" data-testid="share-preview">
        {rows.map(([key, value], i) => (
          <div key={`${key}-${i}`} className="contents">
            <dt style={{ color: "var(--ts-muted)" }}>{key}</dt>
            <dd style={{ color: "var(--ts-text)" }}>{value}</dd>
          </div>
        ))}
      </dl>
      {itinerary && <ShareLinkItineraryPreview itinerary={itinerary} />}
    </>
  );
}
