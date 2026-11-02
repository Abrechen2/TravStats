import { describe, it, expect, afterEach } from "vitest";
import {
  GuestRouteRefused,
  getGuestSession,
  guestHttp,
  guestPath,
  isGuestMode,
  setGuestSession,
} from "../guestHttp";

const session = { planId: "plan-1", tripId: "trip-1" };

afterEach(() => setGuestSession(null));

describe("guest mode routing", () => {
  it("maps the plan's own paths to the guest door", () => {
    expect(guestPath("/trips/trip-1/plan", session)).toBe("/guest/plans/plan-1");
    expect(guestPath("/trips/trip-1/plan/mutations", session)).toBe(
      "/guest/plans/plan-1/mutations"
    );
    expect(guestPath("/trips/trip-1/plan/stations/s/climate", session)).toBe(
      "/guest/plans/plan-1/stations/s/climate"
    );
    expect(guestPath("/trips/trip-1/plan/documents", session)).toBe(
      "/guest/plans/plan-1/documents"
    );
    expect(guestPath("/travplan/locations", session)).toBe("/guest/plans/plan-1/locations");
    expect(guestPath("/travplan/places", session)).toBe("/guest/plans/plan-1/places");
  });

  it("maps nothing else: another trip's plan, the logbook and the account stay out of reach", () => {
    for (const url of [
      "/trips/other/plan",
      "/trips/trip-1",
      "/trips/trip-1/documents",
      "/trips/trip-1/planning",
      "/travplan/plans",
      "/flights",
      "/auth/me",
    ])
      expect(guestPath(url, session), url).toBeNull();
  });

  it("refuses a request the guest door has no path for before it leaves the browser", async () => {
    setGuestSession(session);
    expect(isGuestMode()).toBe(true);
    await expect(guestHttp.get("/flights")).rejects.toBeInstanceOf(GuestRouteRefused);
    setGuestSession(null);
    expect(getGuestSession()).toBeNull();
    await expect(guestHttp.get("/trips/trip-1/plan")).rejects.toBeInstanceOf(GuestRouteRefused);
  });
});
