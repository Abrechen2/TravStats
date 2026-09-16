import type { SectionOption } from "./SectionVisibilityMenu";

type Translate = (key: string) => string;

/**
 * The flight tab's blocks, in the order they are drawn.
 *
 * A list rather than keys scattered through the page: the menu and the page
 * have to agree, and a key typed in two places is a key that will disagree in
 * one of them. A block added here but not wrapped simply offers a switch that
 * does nothing, which is why the two live next to each other.
 */
export const FLIGHT_SECTIONS = (t: Translate): SectionOption[] => [
  { key: "overview", label: t("stats:sections.overview") },
  { key: "charts", label: t("stats:sections.charts") },
  { key: "calendar", label: t("stats:calendar.title") },
  { key: "distance", label: t("stats:sections.distance") },
  { key: "breakdown", label: t("stats:sections.breakdown") },
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
