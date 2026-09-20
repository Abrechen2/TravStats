// The four newer card bodies: a trip group, a Sonder-Flug, a lodging and a
// place.
//
// Split out of `PinnedCard.tsx` when the merge with the globe's pin work
// brought the lodging and place shapes in from the other side — the card file
// was six lines under the 800-line limit, which is a trap for whoever touches
// it next rather than a size that passes. The shell, the heading and the four
// ORIGINAL bodies (route, airport, port, cruise) stay there; these four are
// the ones a reader looks up by name.

import type { JSX } from "react";
import { resolveCountryCode } from "../../../lib/countryFlag";
import { LODGING_COLOR } from "../../../lib/lodgingColor";
import { PLACE_COLOR } from "../../../lib/placeColor";
import { rgbCss } from "../../../lib/flightColor";
import type { GeoJSONFeature } from "../../../types";
import type {
  LodgingCardDatum,
  PlaceCardDatum,
  SpecialFlightCardDatum,
  TripCardDatum,
} from "./pinnedTypes";
import { getArcStats, latestStayFacts } from "./cardStats";
import {
  Actions,
  Grid,
  Hero,
  Place,
  Row,
  SubHeading,
  formatDate,
  formatKmNumber,
  type TFn,
} from "./cardChrome";
import { CardFlights } from "./CardFlights";

export interface BodyCommonProps {
  locale: string;
  t: TFn;
}

// ─── Trip body ────────────────────────────────────────────────────

/**
 * A selection that spans more than one airport pair — the flat map's trip
 * grouping. It reports the same three facts a route does (how far, when, with
 * whom) and lists the flights; the route heading would be a lie here, so the
 * heading counts instead.
 */
export function TripBody({
  data,
  flights,
  locale,
  t,
  onTripDetails,
}: {
  data: TripCardDatum;
  flights: readonly GeoJSONFeature[];
  onTripDetails?: () => void;
} & BodyCommonProps): JSX.Element {
  const stats = getArcStats(flights, data.flightIds);
  const colorRgb = `rgb(${data.color[0]},${data.color[1]},${data.color[2]})`;
  return (
    <>
      <Hero color={colorRgb}>
        {t("map:globe.pinned.totalKm", {
          count: data.flightIds.length,
          km: formatKmNumber(stats.totalKm),
        })}
      </Hero>
      <Grid>
        {stats.lastFlightDate && (
          <Row
            label={t("map:globe.pinned.lastFlight")}
            value={formatDate(stats.lastFlightDate, locale)}
          />
        )}
        {stats.topAirline && (
          <Row label={t("map:globe.pinned.topAirline")} value={stats.topAirline} />
        )}
        {stats.topAircraft && (
          <Row label={t("map:globe.pinned.topAircraft")} value={stats.topAircraft} />
        )}
      </Grid>
      <CardFlights flights={flights} flightIds={data.flightIds} locale={locale} t={t} />
      <Actions
        primary={
          onTripDetails
            ? { label: t("map:globe.pinned.details"), onClick: onTripDetails }
            : undefined
        }
      />
    </>
  );
}

// ─── Sonder-Flug body ─────────────────────────────────────────────

export function SpecialFlightBody({
  data,
  locale,
  t,
  onFlightOpen,
  onFlightEdit,
}: {
  data: SpecialFlightCardDatum;
  onFlightOpen?: (flightId: string) => void;
  onFlightEdit?: (flightId: string) => void;
} & BodyCommonProps): JSX.Element {
  const colorRgb = `rgb(${data.color[0]},${data.color[1]},${data.color[2]})`;
  return (
    <>
      <Hero color={colorRgb}>{data.routeLabel}</Hero>
      <Grid>
        {data.aircraft && <Row label={t("map:globe.pinned.topAircraft")} value={data.aircraft} />}
        {data.eventLabel && <Row label={t("map:globe.pinned.event")} value={data.eventLabel} />}
        {data.departureTime && (
          <Row
            label={t("map:globe.pinned.lastFlight")}
            value={formatDate(data.departureTime, locale)}
          />
        )}
      </Grid>
      <Actions
        primary={
          onFlightOpen
            ? {
                label: t("map:globe.pinned.openFlight"),
                onClick: () => onFlightOpen(data.flightId),
              }
            : undefined
        }
        secondary={
          onFlightEdit
            ? { label: t("common:buttons.edit"), onClick: () => onFlightEdit(data.flightId) }
            : undefined
        }
      />
    </>
  );
}

// ─── Lodging + place bodies ───────────────────────────────────────
//
// Neither needs a `cardStats` aggregator the way the four above do: a pin IS
// the row, already carrying its own derived `stayCount`, `nights` and
// `visitCount` from the server. There is nothing to fold, so there is nothing
// to fold DIFFERENTLY from the list page showing the same numbers.
//
// The ONE derivation is "which stay" — `latestStayFacts`, so the dates, the
// span and the price all name the same stay and the rule lives in one place.

/**
 * A hotel, as both the globe's pin and the activity sidebar's row mean it.
 *
 * `nights` and the stay row answer DIFFERENT questions and are labelled
 * separately on purpose: `Lodging.nights` is the lifetime total this account
 * has slept here, while the stay row is the most recent visit. Collapsing them
 * under one label would be two facts wearing one name.
 */
export function LodgingBody({
  data,
  locale,
  t,
  onLodgingOpen,
}: {
  data: LodgingCardDatum;
  onLodgingOpen?: (lodgingId: string) => void;
} & BodyCommonProps): JSX.Element {
  const stays = data.stayCount ?? 0;
  const nights = data.nights ?? 0;
  const stay = latestStayFacts(data.stays, locale);
  return (
    <>
      {data.type && <SubHeading>{t(`lodging:type.${data.type}`)}</SubHeading>}
      <Place city={data.city} country={resolveCountryCode(data.country)} locale={locale} />
      <Hero color={rgbCss(LODGING_COLOR)}>{t("lodging:field.staysCount", { count: stays })}</Hero>
      <Grid>
        {/* An upcoming booking is labelled as one: the hero counts only stays
            already slept (shared/lodgingCounting.ts), so presenting a future
            date under that count as "the stay" contradicted the number above
            it. */}
        {stay.dateRange && (
          <Row
            label={t(stay.upcoming ? "map:globe.pinned.upcomingStay" : "map:globe.pinned.stay")}
            value={stay.dateRange}
          />
        )}
        {/* Nights are omitted rather than shown as 0 when nothing is recorded:
            a stay whose span is unknown and a same-day stay both come to 0,
            and only one of those means "no nights" (shared/lodgingTiming.ts). */}
        {nights > 0 && (
          <Row
            label={t("map:globe.pinned.nights")}
            value={t("lodging:field.nightsCount", { count: nights })}
          />
        )}
        {stay.price && <Row label={t("map:globe.pinned.price")} value={stay.price} />}
        {data.chain?.name && <Row label={t("lodging:field.chain")} value={data.chain.name} />}
        {data.overallRating != null && (
          <Row label={t("lodging:field.ratingOverall")} value={data.overallRating.toFixed(1)} />
        )}
      </Grid>
      <Actions
        primary={
          onLodgingOpen
            ? { label: t("map:globe.pinned.openLodging"), onClick: () => onLodgingOpen(data.id) }
            : undefined
        }
      />
    </>
  );
}

export function PlaceBody({
  data,
  locale,
  t,
  onPlaceOpen,
}: {
  data: PlaceCardDatum;
  onPlaceOpen?: (placeId: string) => void;
} & BodyCommonProps): JSX.Element {
  return (
    <>
      {data.category && <SubHeading>{t(`places:categories.${data.category}`)}</SubHeading>}
      <Place city={data.city} country={resolveCountryCode(data.country)} locale={locale} />
      {/* A wishlist entry has no visit count to show — it is somewhere the
          user has NOT been, and "0 Besuche" reads as a failure rather than an
          intention (shared/placeCounting.ts draws the same line). */}
      <Hero color={rgbCss(PLACE_COLOR)}>
        {data.visited === false
          ? t("places:list.status.wishlist")
          : t("places:list.visitsCount", { count: data.visitCount ?? 0 })}
      </Hero>
      <Grid>
        {data.lastVisitAt && (
          <Row label={t("map:tooltip.lastVisit")} value={formatDate(data.lastVisitAt, locale)} />
        )}
      </Grid>
      <Actions
        primary={
          onPlaceOpen
            ? { label: t("map:globe.pinned.openPlace"), onClick: () => onPlaceOpen(data.id) }
            : undefined
        }
      />
    </>
  );
}
