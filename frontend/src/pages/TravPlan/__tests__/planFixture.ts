import type { PlanView } from "../../../lib/api/travplan";
export function planFixture(tripId = "trip-one", revision = 1): PlanView {
  return {
    id: "plan-" + tripId,
    tripId,
    name: "Journey " + tripId,
    revision,
    state: {
      version: 1,
      destination: "Lisbon",
      startDay: "2026-11-01",
      endDay: "2026-11-03",
      timezone: "Europe/Lisbon",
      latitude: null,
      longitude: null,
      travelers: 1,
      pace: "balanced",
      budget: 1000,
      currency: "EUR",
      freeDays: [],
      openNights: [],
      status: "planning",
      handoverRevision: null,
      ai: { enabled: false, policy: "local_only" },
      packingProfile: { washing: "unknown", luggage: "unknown" },
      items: [],
      ideas: [],
      bookings: [],
      transfers: [],
      packing: [],
      tasks: [],
      costs: [],
      decisions: [],
      forecast: null,
    },
    findings: [],
    budget: {
      currency: "EUR",
      booked: 0,
      estimates: 0,
      paid: 0,
      due: 0,
      total: 0,
      remaining: 1000,
      unknown: 0,
      otherCurrencies: [],
    },
  };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
