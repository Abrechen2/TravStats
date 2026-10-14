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
    expect(checkPlan(s).some((f) => f.code === "transferOpen" || f.code === "transferReview")).toBe(
      false
    );
    s.bookings[0].arrivalTime = "18:00";
    expect(checkPlan(s).some((f) => f.code === "transferReview")).toBe(true);
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
    expect(checkPlan(s).some((f) => f.code === "transferOpen" || f.code === "transferReview")).toBe(
      false
    );
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
    expect(checkPlan(s).some((f) => f.code === "arrivalBuffer")).toBe(false);
  });
});
