/**
 * Everything the cruise insights read, in one place for the endpoint, the
 * evidence resolvers and the badges (forgejo#257): the sailed cruises with
 * their stops, whether the reader sees tours at all, and the tours linked to
 * port calls by `./excursions.ts`'s rule.
 */

import { loadVisibleDomains } from "../../domainVisibility";
import { linkTours, loadExcursionTours, type LinkedTour } from "./excursions";
import { loadCruiseInsightData, type CruiseInsightData } from "./rows";

export interface CruiseInsightContext extends CruiseInsightData {
  /** Tours sit behind the roadtrip/tour beta switch (`domainVisibility.ts`). */
  toursVisible: boolean;
  /** Cruise id → the tours linked to its calls. Empty while tours are hidden. */
  linked: Map<string, LinkedTour[]>;
}

export async function loadCruiseInsightContext(userId: string): Promise<CruiseInsightContext> {
  const [data, visible] = await Promise.all([
    loadCruiseInsightData(userId),
    loadVisibleDomains(userId),
  ]);
  const toursVisible = visible.includes("roadtrip");
  const days = data.rows.flatMap((r) =>
    r.calls.filter((c) => !c.isAtSea && c.day !== null).map((c) => c.day as string)
  );
  const tours = toursVisible ? await loadExcursionTours(userId, days) : [];
  return { ...data, toursVisible, linked: linkTours(data.rows, tours) };
}

/** The linked tours of one cruise — null (not "none") while tours are hidden. */
export function linkedToursOf(ctx: CruiseInsightContext, cruiseId: string): LinkedTour[] | null {
  return ctx.toursVisible ? (ctx.linked.get(cruiseId) ?? []) : null;
}
