/**
 * Everything the cruise insights read, in one place for the endpoint, the
 * evidence resolvers and the badges (forgejo#257): the sailed cruises with
 * their stops, whether tours may be shown at all, and the tours linked to
 * port calls by `./excursions.ts`'s rule.
 *
 * ## When tours count
 *
 * On the SAME rule the web shows tours by — `useToursVisible`, the instance's
 * beta switch for the `roadtrips` key and nothing else (coordinator ruling
 * 2026-10-09). A user who sees their tours on the tours page sees them linked
 * here, and the "Land und Leute" badge counts what the excursion block shows.
 * The roadtrip DOMAIN toggle is not consulted: tours are not that domain, and
 * the web does not ask it either.
 */

import { getInstanceSettings } from "../../instanceSettingsService";
import { linkTours, loadExcursionTours, type LinkedTour } from "./excursions";
import { loadCruiseInsightData, type CruiseInsightData } from "./rows";

export interface CruiseInsightContext extends CruiseInsightData {
  /** The instance's beta switch — the web's `useToursVisible`. */
  toursVisible: boolean;
  /** Cruise id → the tours linked to its calls. Empty while tours are hidden. */
  linked: Map<string, LinkedTour[]>;
}

/** Does the instance show tours? The server's half of `useToursVisible`. */
export async function toursVisible(): Promise<boolean> {
  return (await getInstanceSettings()).betaFeaturesEnabled;
}

/**
 * The context over cruise rows already in hand. Tours are asked for only
 * when they may be shown AND some port call has a day to match them on.
 */
export async function cruiseInsightContextOf(
  userId: string,
  data: CruiseInsightData
): Promise<CruiseInsightContext> {
  const visible = await toursVisible();
  const days = data.rows.flatMap((r) =>
    r.calls.filter((c) => !c.isAtSea && c.day !== null).map((c) => c.day as string)
  );
  const tours = visible ? await loadExcursionTours(userId, days) : [];
  return { ...data, toursVisible: visible, linked: linkTours(data.rows, tours) };
}

export async function loadCruiseInsightContext(userId: string): Promise<CruiseInsightContext> {
  return cruiseInsightContextOf(userId, await loadCruiseInsightData(userId));
}

/** The linked tours of one cruise — null (not "none") while tours are hidden. */
export function linkedToursOf(ctx: CruiseInsightContext, cruiseId: string): LinkedTour[] | null {
  return ctx.toursVisible ? (ctx.linked.get(cruiseId) ?? []) : null;
}
