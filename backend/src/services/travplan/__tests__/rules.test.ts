import { randomUUID } from "node:crypto";
import { emptyState, bookingSchema } from "../schema";
import { applyOperation, applyProposal } from "../operations";
import { checkPlan, deriveBudget, transferFingerprint } from "../rules";
import type { PlanState } from "../types";
function booking(state: PlanState, kind: "flight" | "hotel", reference: string) {
  const b = bookingSchema.parse({
    id: randomUUID(),
    kind,
    title: kind,
    reference,
    provider: "",
    day: "2026-11-12",
    endDay: kind === "hotel" ? "2026-11-19" : null,
    time: "10:00",
    timezone: "Europe/Berlin",
    arrivalDay: kind === "flight" ? "2026-11-12" : null,
    arrivalTime: kind === "flight" ? "15:20" : null,
    arrivalTimezone: kind === "flight" ? "Atlantic/Madeira" : null,
    amount: kind === "flight" ? 620 : 840,
    paid: kind === "flight" ? 620 : 420,
    currency: "EUR",
    place: kind,
    documentIds: [],
    source: "manual",
    details: {},
  });
  return applyOperation(state, { type: "upsert", collection: "bookings", value: b }, 1);
}
describe("Travel planning invariants", () => {
  it("deduplicates a reimport without adding a second price or anchor", () => {
    let s = booking(emptyState(), "flight", "DEMO");
    s = booking(s, "flight", "demo");
    expect(s.bookings).toHaveLength(1);
    expect(s.items).toHaveLength(1);
    expect(deriveBudget(s).booked).toBe(620);
  });
  it("separates total booked costs and remaining payment", () => {
    let s = booking(booking(emptyState(), "flight", "A"), "hotel", "B");
    s.costs = [
      { id: randomUUID(), title: "Food", kind: "estimate", amount: 350, paid: 0, currency: "EUR" },
    ];
    expect(deriveBudget(s)).toMatchObject({ total: 1810, booked: 1460, paid: 1040, due: 420 });
  });
  it("never treats a missing price or another currency as free", () => {
    const s = emptyState();
    s.costs = [
      {
        id: randomUUID(),
        title: "Unknown",
        kind: "estimate",
        amount: null,
        paid: 0,
        currency: "EUR",
      },
      {
        id: randomUUID(),
        title: "Foreign",
        kind: "estimate",
        amount: 10,
        paid: 0,
        currency: "USD",
      },
    ];
    expect(deriveBudget(s)).toMatchObject({ unknown: 1, otherCurrencies: ["USD"] });
  });
  it("respects an organized transfer until relevant arrival facts change", () => {
    let s = booking(booking(emptyState(), "flight", "A"), "hotel", "B");
    const flight = s.items[0],
      hotel = s.items[1];
    s.transfers = [
      {
        id: randomUUID(),
        fromId: flight.id,
        toId: hotel.id,
        status: "organized",
        mode: "Taxi",
        note: "Arrival hall",
        duration: 40,
        buffer: 60,
        fingerprint: transferFingerprint(s, flight.id, hotel.id),
      },
    ];
    expect(
      checkPlan(s, "2026-11-01").some(
        (f) => f.code === "transferOpen" || f.code === "transferReview"
      )
    ).toBe(false);
    s.bookings[0].arrivalTime = "18:00";
    expect(checkPlan(s, "2026-11-01").some((f) => f.code === "transferReview")).toBe(true);
    expect(s.transfers[0].note).toBe("Arrival hall");
  });
  it("does not reopen an intentionally open transfer", () => {
    let s = booking(booking(emptyState(), "flight", "A"), "hotel", "B");
    s.transfers = [
      {
        id: randomUUID(),
        fromId: s.items[0].id,
        toId: s.items[1].id,
        status: "conscious",
        mode: "",
        note: "",
        duration: null,
        buffer: 0,
        fingerprint: null,
      },
    ];
    s.bookings[0].arrivalTime = "22:00";
    expect(
      checkPlan(s, "2026-11-01").some(
        (f) => f.code === "transferOpen" || f.code === "transferReview"
      )
    ).toBe(false);
  });
  it("protects a booked anchor from ordinary edits and AI proposals", () => {
    const s = booking(emptyState(), "flight", "A");
    expect(() =>
      applyOperation(
        s,
        { type: "upsert", collection: "items", value: { ...s.items[0], time: "11:00" } },
        1
      )
    ).toThrow();
    expect(() =>
      applyProposal(s, [{ id: s.items[0].id, day: "2026-11-13", time: "11:00" }])
    ).toThrow();
  });
  it("assigns an idea atomically and moves the same entry on reassignment", () => {
    let s = emptyState();
    const idea = {
      id: randomUUID(),
      title: "A walk",
      category: "",
      priority: "optional" as const,
      note: "",
      itemId: null,
    };
    s = applyOperation(s, { type: "upsert", collection: "ideas", value: idea }, 1);
    s = applyOperation(
      s,
      { type: "assign_idea", ideaId: idea.id, day: "2026-11-12", time: "10:00", duration: 60 },
      2
    );
    s = applyOperation(
      s,
      { type: "assign_idea", ideaId: idea.id, day: "2026-11-13", time: "12:00", duration: 60 },
      3
    );
    expect(s.items).toHaveLength(1);
    expect(s.items[0].day).toBe("2026-11-13");
    expect(s.ideas[0].itemId).toBe(s.items[0].id);
  });
  it("hands over a revision without confirming any execution", () => {
    const s = booking(emptyState(), "flight", "A"),
      next = applyOperation(s, { type: "handover" }, 4);
    expect(next.status).toBe("ready");
    expect(next.handoverRevision).toBe(5);
    expect(next.items[0].execution).toBe("unconfirmed");
  });
  it("does not invent arrival buffers from a departure time", () => {
    let s = booking(booking(emptyState(), "flight", "A"), "hotel", "B");
    s.bookings[0].arrivalTime = null;
    s.items.push({
      id: randomUUID(),
      title: "Walk",
      kind: "activity",
      day: "2026-11-12",
      time: "10:10",
      duration: 60,
      timezone: null,
      place: "",
      note: "",
      booked: false,
      bookingId: null,
      stationId: null,
      execution: "unconfirmed",
      source: null,
    });
    s.transfers = [
      {
        id: randomUUID(),
        fromId: s.items[0].id,
        toId: s.items[1].id,
        status: "open",
        mode: "",
        note: "",
        buffer: 60,
        duration: 60,
        fingerprint: null,
      },
    ];
    expect(checkPlan(s, "2026-11-01").some((f) => f.code === "arrivalBuffer")).toBe(false);
  });
  it("keeps separate legs sharing one PNR", () => {
    let s = booking(emptyState(), "flight", "SAME");
    const returnLeg = {
      ...s.bookings[0],
      id: randomUUID(),
      day: "2026-11-19",
      originPlace: "FNC",
      place: "FRA",
    };
    s = applyOperation(s, { type: "upsert", collection: "bookings", value: returnLeg }, 2);
    expect(s.bookings).toHaveLength(2);
    expect(s.items).toHaveLength(2);
  });
  it("counts a package price once across flights and stays", () => {
    let s = booking(booking(emptyState(), "flight", "A"), "hotel", "B");
    const group = randomUUID();
    s.bookings = s.bookings.map((b) => ({ ...b, priceGroupId: group, amount: 2000, paid: 500 }));
    expect(deriveBudget(s)).toMatchObject({ total: 2000, paid: 500, due: 1500 });
  });
  it("invalidates destination weather after changing the location", () => {
    const s = emptyState();
    s.forecast = {
      latitude: 1,
      longitude: 2,
      timezone: "UTC",
      source: "https://example.com",
      fetchedAt: new Date().toISOString(),
      days: [],
    };
    expect(applyOperation(s, { type: "settings", values: { latitude: 3 } }, 1).forecast).toBeNull();
  });
  it("detects overlap across known local time zones without treating clocks as equal", () => {
    let s = booking(emptyState(), "flight", "A");
    s = applyOperation(
      s,
      {
        type: "upsert",
        collection: "items",
        value: {
          id: randomUUID(),
          title: "Too early",
          kind: "activity",
          day: "2026-11-12",
          time: "11:00",
          duration: 60,
          timezone: "Atlantic/Madeira",
          place: "",
          note: "",
          booked: false,
          bookingId: null,
          execution: "unconfirmed",
          source: null,
        },
      },
      2
    );
    expect(checkPlan(s, "2026-11-01").some((f) => f.code === "overlap")).toBe(true);
  });
  it("keeps an excluded booking’s record and price without using it as accommodation", () => {
    let s = booking(emptyState(), "hotel", "A");
    s.startDay = "2026-11-12";
    s.endDay = "2026-11-19";
    s = applyOperation(s, { type: "execution", id: s.items[0].id, execution: "cancelled" }, 2);
    expect(s.bookings).toHaveLength(1);
    expect(deriveBudget(s).booked).toBe(840);
    expect(checkPlan(s, "2026-11-01").some((f) => f.code === "nightGap")).toBe(true);
  });
  it("keeps an unknown committed remainder unknown and includes a known deposit as a cost floor", () => {
    let s = booking(emptyState(), "hotel", "A");
    s.bookings[0].amount = null;
    s.bookings[0].paid = 100;
    s.budget = 1000;
    expect(deriveBudget(s)).toMatchObject({
      total: 100,
      paid: 100,
      due: null,
      remaining: null,
      unknown: 1,
    });
  });
});

describe("nightGap on a route plan", () => {
  const base = {
    ...emptyState(),
    shape: "route" as const,
    startDay: "2027-05-08",
    endDay: "2027-05-12",
  };
  const st = (title: string, nights: number, night: PlanState["stations"][number]["night"]) => ({
    id: randomUUID(),
    title,
    place: { name: title, lat: 0, lon: 0, country: null, zone: null, ref: null },
    nights,
    pinnedDay: null,
    night,
    note: "",
  });
  const stage = (from: string, to: string, overnight = false) => ({
    id: randomUUID(),
    fromStationId: from,
    toStationId: to,
    mode: overnight ? ("ferry" as const) : ("drive" as const),
    departDay: null,
    departTime: null,
    durationMinutes: null,
    distanceKm: null,
    metricsSource: null,
    fallbackReason: null,
    bookingId: null,
    overnight,
    note: "",
  });
  const connected = (stations: ReturnType<typeof st>[]) => ({
    ...base,
    stations,
    stages: stations.slice(1).map((s, i) => stage(stations[i].id, s.id)),
  });
  it("nightGap counts station nights on a route plan", () => {
    const covered = connected([st("A", 2, { kind: "spontaneous" }), st("B", 2, { kind: "pitch" })]);
    expect(checkPlan(covered, "2027-05-01").some((f) => f.code === "nightGap")).toBe(false);
    const gap = connected([st("A", 2, { kind: "spontaneous" }), st("B", 1, { kind: "pitch" })]);
    const finding = checkPlan(gap, "2027-05-01").find((f) => f.code === "nightGap");
    expect(finding?.params).toMatchObject({ count: 1, days: "2027-05-11" });
  });
  it("a leg without a stage leaves the nights unknown: stageMissing speaks, not nightGap", () => {
    const state = {
      ...base,
      stations: [st("A", 2, { kind: "spontaneous" }), st("B", 1, { kind: "pitch" })],
    };
    const codes = checkPlan(state, "2027-05-01").map((f) => f.code);
    expect(codes).toContain("stageMissing");
    expect(codes).not.toContain("nightGap");
  });
  it("an idea night with no candidate still covers its nights (nightUndecided speaks, not nightGap)", () => {
    const state = connected([
      st("A", 2, { kind: "idea", candidates: [] }),
      st("B", 2, { kind: "pitch" }),
    ]);
    expect(checkPlan(state, "2027-05-01").some((f) => f.code === "nightGap")).toBe(false);
  });
  it("an overnight ferry stage covers the night between two zero-night stations", () => {
    const a = st("A", 2, { kind: "spontaneous" }),
      ferryFrom = st("Port", 0, { kind: "onboard" }),
      c = st("C", 0, { kind: "spontaneous" });
    const mk = (overnight: boolean) => ({
      ...base,
      endDay: "2027-05-11",
      stations: [a, ferryFrom, c],
      stages: [stage(a.id, ferryFrom.id, false), stage(ferryFrom.id, c.id, overnight)],
    });
    expect(checkPlan(mk(true), "2027-05-01").some((f) => f.code === "nightGap")).toBe(false);
    const gap = checkPlan(mk(false), "2027-05-01").find((f) => f.code === "nightGap");
    expect(gap?.params).toMatchObject({ count: 1, days: "2027-05-10" });
  });
});
