import type { ShareLinkField, WrappedView } from "../../schemas/shareLinks";
import { loadWrapped } from "../stats/wrappedLoad";

/**
 * The public view of a year in review (forgejo#281). The story is the owner's
 * own `GET /stats/wrapped` for that year — `loadWrapped` is its one home — cut
 * down to the chosen fields. Null when the year has nothing in it any more:
 * a link to an empty story answers like a link that does not exist.
 */
export async function buildWrappedView(
  userId: string,
  year: number,
  fields: ReadonlySet<ShareLinkField<"wrapped">>,
  ownerFirstName: string | null
): Promise<WrappedView | null> {
  const wrapped = await loadWrapped(userId, year);
  if (!wrapped || !wrapped.availableYears.includes(year)) return null;
  const view: WrappedView = { year };
  if (fields.has("owner")) view.owner = ownerFirstName;
  if (fields.has("totals")) {
    view.totals = {
      flights: wrapped.flights,
      distanceKm: wrapped.distanceKm,
      earthFactor: wrapped.earthFactor,
      newCountries: wrapped.newCountries,
      cruises: wrapped.cruises,
      railRides: wrapped.railRides,
      railKm: wrapped.railKm,
    };
  }
  if (fields.has("topAirline")) {
    view.topAirline = wrapped.topAirline
      ? {
          name: wrapped.topAirline.name,
          code: wrapped.topAirline.code,
          flights: wrapped.topAirline.flights,
        }
      : null;
  }
  if (fields.has("topRoute")) {
    view.topRoute = wrapped.topRoute
      ? { from: wrapped.topRoute.from, to: wrapped.topRoute.to, flights: wrapped.topRoute.flights }
      : null;
  }
  return view;
}
