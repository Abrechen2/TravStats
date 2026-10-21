// The card bodies for journey routes, their stations, tours and trip stops
// (forgejo#323) — the flight route card's three tiers (heading → hero stat →
// metadata grid, then the list and the actions) for every other domain.
//
// Kept beside `PinnedCard.tsx` rather than inside it: that file is the
// shell, and at 557 lines it has room for four `case`s, not four bodies.

import type { JSX } from "react";
import { useNavigate } from "react-router-dom";
import { FlagImg } from "../../../../lib/countryFlag";
import { tokens } from "../../../../theme/tokens";
import {
  Actions,
  Grid,
  Hero,
  Row,
  SubHeading,
  formatDate,
  formatDuration,
  formatKm,
  type TFn,
} from "../cardChrome";
import type { MapPinned } from "../pinnedTypes";
import type {
  JourneyRouteCardDatum,
  JourneyStopCardDatum,
  MapJourney,
  TourCardDatum,
  TripStopCardDatum,
} from "./journeyTypes";
import {
  endKey,
  getJourneyRouteStats,
  getJourneyStopStats,
  type JourneyRouteStats,
} from "./journeyStats";
import { tallyLabel } from "./journeyHoverHtml";
import { routeDistanceSourceKeys } from "./journeyProvenance";
import { getJourneyRouteFigures } from "./journeyRouteFigures";
import { RouteFigureRows } from "./journeyRouteRows";
import { journeyIconName, rgbCss, tourIconName } from "./journeyIdentity";
import {
  DomainBadge,
  JourneyEndLine,
  JourneyList,
  OperatorRow,
  journeyDay,
  journeyFactText,
  journeySpanDay,
  journeyPath,
} from "./journeyCardParts";

interface BodyProps {
  locale: string;
  t: TFn;
}

/** The kinds this module draws. */
export type JourneyPinnedKind = "journeyRoute" | "journeyStop" | "tour" | "tripStop";

export function isJourneyPinned(
  p: MapPinned
): p is Extract<MapPinned, { kind: JourneyPinnedKind }> {
  return (
    p.kind === "journeyRoute" ||
    p.kind === "journeyStop" ||
    p.kind === "tour" ||
    p.kind === "tripStop"
  );
}

// ─── Heading ──────────────────────────────────────────────────────

/**
 * The heading carries the domain's identity: its badge, and a stripe in its
 * colour down the side — the same stripe the hover tooltip has, so hovering
 * and clicking a line show one design.
 */
export function JourneyHeading({
  pinned,
  t,
}: {
  pinned: Extract<MapPinned, { kind: JourneyPinnedKind }>;
  t: TFn;
}): JSX.Element {
  const stripe = (color: [number, number, number], children: JSX.Element): JSX.Element => (
    <div
      data-testid="journey-heading"
      className="flex items-center gap-2 text-[14px] font-semibold"
      style={{ borderLeft: `3px solid ${rgbCss(color)}`, paddingLeft: 8 }}
    >
      {children}
    </div>
  );
  switch (pinned.kind) {
    case "journeyRoute": {
      const d = pinned.data;
      return stripe(
        d.color,
        <>
          <DomainBadge icon={journeyIconName(d.domain)} color={d.color} />
          <span>{t(`map:journey.domain.${d.domain}`)}</span>
        </>
      );
    }
    case "journeyStop": {
      const d = pinned.data;
      return stripe(
        d.color,
        <>
          <DomainBadge icon={journeyIconName(d.domain)} color={d.color} />
          {d.stop.country && <FlagImg country={d.stop.country} height={18} />}
          <span>{d.stop.name}</span>
        </>
      );
    }
    case "tour": {
      const d = pinned.data;
      return stripe(
        d.color,
        <>
          <DomainBadge icon={tourIconName(d.kind, d.mode)} color={d.color} />
          <span>{d.name}</span>
        </>
      );
    }
    case "tripStop":
      return stripe(pinned.data.color, <span>{pinned.data.title}</span>);
  }
}

// ─── Shared grid ──────────────────────────────────────────────────

function DistanceRow({
  stats,
  t,
  locale,
}: { stats: JourneyRouteStats } & BodyProps): JSX.Element | null {
  if (stats.travelled === 0) return null;
  const known =
    stats.measuredCount > 0 ? formatKm(stats.knownKm, locale) : t("map:journey.distanceNone");
  const unknown =
    stats.unknownCount > 0 ? t("map:journey.distanceUnknown", { count: stats.unknownCount }) : null;
  // What the figure measures — "Luftlinie", "Seeweg (Schätzung)" — as the
  // detail pages say it; a straight line must not read as the way travelled.
  const sources = routeDistanceSourceKeys(stats.list).map((key) => t(key));
  return (
    <>
      <Row label={t("map:journey.distance")} value={known} />
      {sources.length > 0 && stats.measuredCount > 0 && (
        <div
          data-testid="journey-distance-source"
          className="text-right text-[10px]"
          style={{ color: tokens.color.faint }}
        >
          {sources.join(" · ")}
        </div>
      )}
      {unknown && (
        <div className="text-right text-[10px]" style={{ color: tokens.color.faint }}>
          {unknown}
        </div>
      )}
    </>
  );
}

/** What the domain's facts line is about — a train, a coach line, a ship, a car. */
const FACT_LABEL: Record<MapJourney["domain"], string> = {
  flight: "flight",
  rail: "train",
  bus: "line",
  ferry: "vessel",
  rental: "vehicle",
};

function LatestRows({
  latest,
  t,
}: { latest: JourneyRouteStats["latest"] } & BodyProps): JSX.Element | null {
  if (!latest) return null;
  const j = latest.journey;
  const facts = journeyFactText(j, t);
  return (
    <>
      {j.departure && (
        <Row
          label={t(latest.upcoming ? "map:journey.next" : "map:journey.last")}
          value={journeySpanDay(j)}
        />
      )}
      {facts.length > 0 && (
        <Row label={t(`map:journey.fact.${FACT_LABEL[j.domain]}`)} value={facts.join(" · ")} />
      )}
      {j.facts.seat && <Row label={t("map:journey.fact.seat")} value={j.facts.seat} />}
      {/* What happened is in the route figures; a journey still ahead shows its own. */}
      {latest.upcoming && j.facts.rentalDays != null && (
        <Row label={t("map:journey.fact.rentalDays")} value={String(j.facts.rentalDays)} />
      )}
      {latest.upcoming && j.facts.durationMin != null && (
        <Row
          label={t("map:journey.fact.duration")}
          value={formatDuration(j.facts.durationMin, t)}
        />
      )}
    </>
  );
}

function OpenAction({
  latest,
  t,
}: {
  latest: JourneyRouteStats["latest"];
  t: TFn;
}): JSX.Element | null {
  const navigate = useNavigate();
  if (!latest) return null;
  const target: MapJourney = latest.journey;
  return (
    <Actions
      primary={{
        label: t(latest.upcoming ? "map:journey.openNext" : "map:journey.openLatest"),
        onClick: () => navigate(journeyPath(target)),
      }}
    />
  );
}

function heroText(stats: JourneyRouteStats, d: { domain: MapJourney["domain"] }, t: TFn): string {
  return tallyLabel(d.domain, stats.travelled, stats.planned, t) || t("map:journey.nothingYet");
}

// ─── Route ────────────────────────────────────────────────────────

export function JourneyRouteBody({
  data,
  locale,
  t,
}: { data: JourneyRouteCardDatum } & BodyProps): JSX.Element {
  const stats = getJourneyRouteStats(data.journeys);
  const figures = getJourneyRouteFigures(data.journeys);
  return (
    <>
      <div className="mb-2.5 space-y-1.5">
        <JourneyEndLine end={data.dep} locale={locale} />
        <JourneyEndLine end={data.arr} locale={locale} />
      </div>
      <Hero color={rgbCss(data.color)}>{heroText(stats, data, t)}</Hero>
      <Grid>
        <DistanceRow stats={stats} t={t} locale={locale} />
        <RouteFigureRows
          figures={figures}
          journeys={data.journeys}
          domain={data.domain}
          language={locale}
          t={t}
        />
        <LatestRows latest={stats.latest} t={t} locale={locale} />
        {stats.topOperator && (
          <OperatorRow domain={data.domain} name={stats.topOperator} color={data.color} t={t} />
        )}
      </Grid>
      <JourneyList journeys={stats.list} t={t} />
      <OpenAction latest={stats.latest} t={t} />
    </>
  );
}

// ─── Station / terminal / port / branch ───────────────────────────

export function JourneyStopBody({
  data,
  locale,
  t,
}: { data: JourneyStopCardDatum } & BodyProps): JSX.Element {
  const stats = getJourneyStopStats(data.journeys, endKey(data.stop));
  return (
    <>
      <SubHeading>{t(`map:journey.stop.${data.domain}`)}</SubHeading>
      <Hero color={rgbCss(data.color)}>{heroText(stats, data, t)}</Hero>
      <Grid>
        <DistanceRow stats={stats} t={t} locale={locale} />
        {stats.topRoute && (
          <Row
            label={t("map:journey.topRoute")}
            value={`→ ${stats.topRoute.name} · ${stats.topRoute.count}×`}
          />
        )}
        {stats.latest?.journey.departure && (
          <Row
            label={t(stats.latest.upcoming ? "map:journey.next" : "map:journey.last")}
            value={journeyDay(stats.latest.journey)}
          />
        )}
        {stats.topOperator && (
          <OperatorRow domain={data.domain} name={stats.topOperator} color={data.color} t={t} />
        )}
      </Grid>
      <JourneyList journeys={stats.list} t={t} />
      {/* A same-station rental has no line to click — its branch IS its card,
          so it carries the way into the rental too. */}
      <OpenAction latest={stats.latest} t={t} />
    </>
  );
}

// ─── Tour / roadtrip ──────────────────────────────────────────────

export function TourBody({ data, locale, t }: { data: TourCardDatum } & BodyProps): JSX.Element {
  const navigate = useNavigate();
  const when =
    data.startDate && data.endDate && data.endDate !== data.startDate
      ? `${formatDate(data.startDate, locale)} – ${formatDate(data.endDate, locale)}`
      : data.startDate
        ? formatDate(data.startDate, locale)
        : null;
  const path = data.kind === "roadtrip" ? `/roadtrips/${data.id}` : `/tours/${data.id}`;
  return (
    <>
      <SubHeading>
        {t(`map:journey.tourKind.${data.kind}`)}
        {data.tripName ? ` · ${data.tripName}` : ""}
      </SubHeading>
      <Hero color={rgbCss(data.color)}>
        {data.distanceKm !== null
          ? formatKm(data.distanceKm, locale)
          : t("map:journey.distanceNone")}
      </Hero>
      <Grid>
        {data.mode && data.kind === "tour" && (
          <Row label={t("map:journey.fact.mode")} value={t(`trips:tours.mode.${data.mode}`)} />
        )}
        {data.ascentM !== null && (
          <Row label={t("map:journey.fact.ascent")} value={`${Math.round(data.ascentM)} m`} />
        )}
        {data.stopCount !== null && (
          <Row label={t("map:journey.fact.stops")} value={String(data.stopCount)} />
        )}
        {when && <Row label={t("map:journey.fact.when")} value={when} />}
      </Grid>
      <Actions
        primary={{
          label: t(data.kind === "roadtrip" ? "map:journey.openRoadtrip" : "map:journey.openTour"),
          onClick: () => navigate(path),
        }}
      />
    </>
  );
}

// ─── Trip stop ────────────────────────────────────────────────────

export function TripStopBody({
  data,
  locale,
  t,
}: { data: TripStopCardDatum } & BodyProps): JSX.Element {
  const when =
    data.startDate && data.endDate && data.endDate !== data.startDate
      ? `${formatDate(data.startDate, locale)} – ${formatDate(data.endDate, locale)}`
      : data.startDate
        ? formatDate(data.startDate, locale)
        : null;
  return (
    <Grid>
      {when ? (
        <Row label={t("map:journey.fact.when")} value={when} />
      ) : (
        <div className="text-[11px]" style={{ color: tokens.color.faint }}>
          —
        </div>
      )}
    </Grid>
  );
}

/** The body for any journey kind — the one call `PinnedCard` makes. */
export function JourneyBody({
  pinned,
  locale,
  t,
}: { pinned: Extract<MapPinned, { kind: JourneyPinnedKind }> } & BodyProps): JSX.Element {
  switch (pinned.kind) {
    case "journeyRoute":
      return <JourneyRouteBody data={pinned.data} locale={locale} t={t} />;
    case "journeyStop":
      return <JourneyStopBody data={pinned.data} locale={locale} t={t} />;
    case "tour":
      return <TourBody data={pinned.data} locale={locale} t={t} />;
    case "tripStop":
      return <TripStopBody data={pinned.data} locale={locale} t={t} />;
  }
}
