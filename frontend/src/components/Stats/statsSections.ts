import type { DomainKey } from "../../shared/domains";
import type { SectionOption } from "./SectionVisibilityMenu";

type Translate = (key: string) => string;

/**
 * The blocks of each statistics tab, in the order they are drawn.
 *
 * A list rather than keys scattered through the page: the menu and the page
 * have to agree, and a key typed in two places is a key that will disagree in
 * one of them. A block added here but not wrapped simply offers a switch that
 * does nothing, which is why the two live next to each other.
 *
 * Until 2026-09-16 only the flight tab had a list. The request that started the
 * menu was a tester with no prices on a cost block (2026-08-29) — and stays and
 * cruises have cost blocks too, which nobody could hide.
 *
 * A label is the heading the reader sees above the block where there is one, so
 * the switch and the thing it hides carry the same words.
 */
export const FLIGHT_SECTIONS = (t: Translate): SectionOption[] => [
  { key: "overview", label: t("stats:sections.overview") },
  { key: "charts", label: t("stats:sections.charts") },
  { key: "calendar", label: t("stats:calendar.title") },
  { key: "distance", label: t("stats:sections.distance") },
  { key: "breakdown", label: t("stats:sections.breakdown") },
  { key: "records", label: t("stats:sections.records") },
  { key: "punctuality", label: t("stats:sections.punctuality") },
  { key: "fun", label: t("stats:sections.fun") },
  { key: "business", label: t("stats:sections.business") },
  { key: "unique", label: t("stats:sections.unique") },
  { key: "airports", label: t("stats:sections.airports") },
  { key: "seats", label: t("stats:sections.seats") },
  { key: "airlines", label: t("stats:sections.airlines") },
  { key: "aircraft", label: t("stats:sections.aircraft") },
  { key: "countries", label: t("stats:sections.countries") },
];

export const OVERVIEW_SECTIONS = (t: Translate): SectionOption[] => [
  { key: "kpis", label: t("stats:overview.kpisLabel") },
  { key: "activity", label: t("stats:overview.activityLabel") },
  // Not the heatmap's own title: that one carries the year as a placeholder.
  { key: "heatmap", label: t("stats:sections.heatmap") },
  { key: "perDomain", label: t("stats:overview.perDomainLabel") },
  { key: "travelAccount", label: t("stats:travelAccount.title") },
];

export const CRUISE_SECTIONS = (t: Translate): SectionOption[] => [
  { key: "kpis", label: t("stats:sections.keyFigures") },
  { key: "regions", label: t("stats:cruiseSection.regionsHeading") },
  { key: "depth", label: t("stats:sections.cruiseDepth") },
  { key: "tags", label: t("stats:sections.cruiseTags") },
  { key: "flags", label: t("stats:sections.cruiseFlags") },
  { key: "rhythm", label: t("cruise:stats.rhythm.title") },
  { key: "money", label: t("cruise:stats.money.title") },
  { key: "fun", label: t("cruise:stats.fun.title") },
];

export const LODGING_SECTIONS = (t: Translate): SectionOption[] => [
  { key: "kpis", label: t("stats:sections.keyFigures") },
  // The currency breakdown hides with the money block: someone who records no
  // prices wants both gone, and a breakdown of nothing is the same noise.
  { key: "money", label: t("lodging:stats.money.title") },
  { key: "quality", label: t("lodging:stats.quality.title") },
  { key: "geo", label: t("lodging:stats.geo.title") },
  { key: "rhythm", label: t("lodging:stats.rhythm.title") },
  { key: "loyalty", label: t("lodging:stats.loyalty.title") },
  { key: "records", label: t("lodging:stats.records.title") },
];

export const POI_SECTIONS = (t: Translate): SectionOption[] => [
  { key: "kpis", label: t("stats:sections.keyFigures") },
  { key: "rankings", label: t("stats:sections.rankings") },
  { key: "checklists", label: t("places:stats.checklists") },
  { key: "rhythm", label: t("places:stats.rhythm.title") },
  { key: "quality", label: t("places:stats.quality.title") },
  { key: "fun", label: t("places:stats.fun.title") },
];

export const ROADTRIP_SECTIONS = (t: Translate): SectionOption[] => [
  { key: "kpis", label: t("stats:sections.keyFigures") },
  { key: "records", label: t("roadtrips:stats.recordsLabel") },
  { key: "vehicles", label: t("roadtrips:stats.vehicles") },
];

export const RAIL_SECTIONS = (t: Translate): SectionOption[] => [
  { key: "kpis", label: t("rail:stats.sections.kpis") },
  { key: "rankings", label: t("rail:stats.sections.rankings") },
  { key: "delays", label: t("rail:stats.sections.delays") },
  { key: "records", label: t("rail:stats.sections.records") },
  { key: "years", label: t("rail:stats.sections.years") },
];

const BY_TAB: Record<DomainKey | "all", (t: Translate) => SectionOption[]> = {
  all: OVERVIEW_SECTIONS,
  flight: FLIGHT_SECTIONS,
  cruise: CRUISE_SECTIONS,
  lodging: LODGING_SECTIONS,
  poi: POI_SECTIONS,
  roadtrip: ROADTRIP_SECTIONS,
  rail: RAIL_SECTIONS,
};

/** The menu's options for a tab. */
export function statsSectionsFor(tab: DomainKey | "all", t: Translate): SectionOption[] {
  return BY_TAB[tab](t);
}
