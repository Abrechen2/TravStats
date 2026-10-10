/**
 * The edit and delete routes that honour a version precondition (forgejo#141):
 * `If-Match: "<version>"` or a `baseVersion` body field, answered with 409
 * VERSION_CONFLICT when the record moved on.
 *
 * One list, read by two places that must agree: `routes/syncPreconditions.ts`
 * mounts the check on these paths, and `services/openapi/syncConflicts.ts`
 * documents the header and the 409 on exactly these operations. Until
 * 2026-10-02 the routes kept the list and the feed's description restated it
 * in prose, which had already fallen behind (rentals and expenses were
 * guarded nowhere and named nowhere).
 */

export interface SyncGuardedRoute {
  /** The sync entity whose version the route checks (`entities.ts`). */
  readonly entity: string;
  /** The Express path parameter that holds the record's id. */
  readonly idParam: string;
  /** Express paths under `/api/v1`, `:param` style. */
  readonly paths: readonly string[];
  /** The method that edits; DELETE on the same paths is guarded too. */
  readonly edit: "put" | "patch";
}

/** Every PATCH/PUT named here, and DELETE on the same paths, gets the check. */
export const SYNC_GUARDED_ROUTES: readonly SyncGuardedRoute[] = [
  { entity: "flight", idParam: "id", paths: ["/flights/:id"], edit: "put" },
  { entity: "rail_journey", idParam: "id", paths: ["/rail/:id"], edit: "patch" },
  { entity: "bus_journey", idParam: "id", paths: ["/bus/:id"], edit: "patch" },
  { entity: "cruise", idParam: "id", paths: ["/cruises/:id"], edit: "patch" },
  { entity: "lodging", idParam: "id", paths: ["/lodging/:id"], edit: "patch" },
  {
    entity: "lodging_stay",
    idParam: "stayId",
    paths: ["/lodging/:id/stays/:stayId"],
    edit: "patch",
  },
  { entity: "trip", idParam: "id", paths: ["/trips/:id"], edit: "patch" },
  { entity: "trip_stop", idParam: "stopId", paths: ["/trips/:id/stops/:stopId"], edit: "patch" },
  {
    entity: "trip_journal_entry",
    idParam: "entryId",
    paths: ["/trips/:id/journal/:entryId"],
    edit: "patch",
  },
  { entity: "place", idParam: "id", paths: ["/places/:id"], edit: "patch" },
  { entity: "place_visit", idParam: "visitId", paths: ["/places/visits/:visitId"], edit: "patch" },
  {
    entity: "trip_route",
    idParam: "routeId",
    paths: ["/trips/:id/routes/:routeId", "/tours/:routeId"],
    edit: "patch",
  },
  { entity: "rental_booking", idParam: "id", paths: ["/rentals/:id"], edit: "patch" },
  {
    entity: "trip_expense",
    idParam: "expenseId",
    paths: [
      "/trips/:id/expenses/:expenseId",
      "/roadtrips/:id/expenses/:expenseId",
      "/tours/:routeId/expenses/:expenseId",
    ],
    edit: "patch",
  },
];
