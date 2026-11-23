import { describe, expect, it } from "@jest/globals";

import { composeSuggestions } from "../compose";
import type { AnsweredProposal } from "../proposals";
import { homeSignature } from "../rejectionMemory";
import type { TripSuggestion } from "../types";
import { AT, input, ride, stay, trip, visit } from "./fixtures";

/**
 * Trip suggestions v2 (owner 2026-11-23: "a rejected proposal must never nag"):
 * a dismissal is remembered by its DAYS, not its member set, so editing the
 * logbook afterwards — one more entry, a date shifted — does not bring the
 * question back. Only a span grown past double comes back, once, `expanded`.
 */

const week = (shiftDays = 0) => {
  const d = (day: number) => `2025-05-${String(day + shiftDays).padStart(2, "0")}`;
  return [
    ride("rail", "out", AT.MUNICH_HBF, AT.FIRENZE, { day: d(3), hour: 7 }, { day: d(3), hour: 15 }),
    stay("florence", AT.FIRENZE, d(3), d(6), "Florenz"),
    stay("rome", AT.ROMA, d(6), d(9), "Rom"),
    ride("rail", "back", AT.ROMA, AT.MUNICH_HBF, { day: d(9), hour: 8 }, { day: d(9), hour: 19 }),
  ];
};

const dismissed = (p: TripSuggestion, over: Partial<AnsweredProposal> = {}): AnsweredProposal => ({
  kind: p.kind,
  fingerprint: p.id,
  targetId: p.trip?.id ?? p.place?.id ?? null,
  memberKeys: p.members.map((m) => m.key),
  status: "dismissed",
  startDay: p.startDay,
  endDay: p.endDay,
  homeSignature: homeSignature(AT.MUC),
  decidedDay: "2025-06-01",
  source: "engine",
  ...over,
});

const memory = { today: "2026-01-01", quietDays: 14 };

describe("rejection memory — engine proposals (trip suggestions v2)", () => {
  const shown = () => composeSuggestions(input({ entries: week() }))[0];

  const visits = ["pantheon", "forum", "trevi", "uffizi", "duomo"].map((id, i) =>
    visit(id, i < 3 ? AT.ROMA : AT.FIRENZE, i < 3 ? "2025-05-08" : "2025-05-04")
  );

  it("keeps a rejected trip quiet after entries are added (the member set changed by more than half)", () => {
    const answered = [dismissed(shown())];
    const entries = [...week(), ...visits];
    expect(composeSuggestions(input({ entries, answered, memory }))).toEqual([]);
  });

  it("keeps a rejected trip quiet after its dates shift by two days", () => {
    const answered = [dismissed(shown())];
    expect(composeSuggestions(input({ entries: week(2), answered, memory }))).toEqual([]);
  });

  it("keeps it quiet even when every member id is new (the old Jaccard re-ask)", () => {
    const answered = [dismissed(shown())];
    const replaced = week().map((e) => ({ ...e, id: `x-${e.id}`, key: `${e.domain}:x-${e.id}` }));
    expect(composeSuggestions(input({ entries: replaced, answered, memory }))).toEqual([]);
  });

  it("re-asks once, flagged expanded, when the absence grows past double", () => {
    const answered = [dismissed(shown())]; // 7 days, 05-03..05-09
    const longer = [
      ...week().filter((e) => e.key !== "rail:back"),
      stay("napoli", AT.ROMA, "2025-05-09", "2025-05-20", "Neapel"),
      ride(
        "rail",
        "home",
        AT.ROMA,
        AT.MUNICH_HBF,
        { day: "2025-05-20", hour: 8 },
        { day: "2025-05-20", hour: 19 }
      ),
    ];
    const out = composeSuggestions(input({ entries: longer, answered, memory }));
    expect(out).toHaveLength(1);
    expect(out[0].expanded).toBe(true);
  });

  it("does not re-ask even a doubled absence inside the quiet period", () => {
    const answered = [dismissed(shown(), { decidedDay: "2025-12-25" })];
    const longer = [
      ...week().filter((e) => e.key !== "rail:back"),
      stay("napoli", AT.ROMA, "2025-05-09", "2025-05-20", "Neapel"),
      ride(
        "rail",
        "home",
        AT.ROMA,
        AT.MUNICH_HBF,
        { day: "2025-05-20", hour: 8 },
        { day: "2025-05-20", hour: 19 }
      ),
    ];
    expect(composeSuggestions(input({ entries: longer, answered, memory }))).toEqual([]);
  });

  it("asks again when the dismissal was judged against a different home", () => {
    const answered = [dismissed(shown(), { homeSignature: homeSignature(AT.HAMBURG) })];
    expect(composeSuggestions(input({ entries: week(), answered, memory }))).toHaveLength(1);
  });

  it("derives the days of an old dismissal without a span from its members", () => {
    const answered = [dismissed(shown(), { startDay: null, endDay: null })];
    const entries = [...week(), visit("pantheon", AT.ROMA, "2025-05-08")];
    expect(composeSuggestions(input({ entries, answered, memory }))).toEqual([]);
  });

  it("a rejected TravTrack period silences the engine over the same days", () => {
    const answered: AnsweredProposal[] = [
      {
        kind: "new_trip",
        fingerprint: "travtrack:abc",
        targetId: null,
        memberKeys: [],
        status: "dismissed",
        startDay: "2025-05-04",
        endDay: "2025-05-07",
        homeSignature: null,
        decidedDay: "2025-06-01",
        source: "travtrack",
      },
    ];
    expect(composeSuggestions(input({ entries: week(), answered, memory }))).toEqual([]);
  });

  it("keeps a rejected extend quiet after the entries shift", () => {
    const entries = week().map((e) => (e.key === "lodging:florence" ? { ...e, tripId: "t1" } : e));
    const trips = [trip("t1", "2025-05-03", "2025-05-05")];
    const first = composeSuggestions(input({ entries, trips }))[0];
    expect(first.kind).toBe("extend");
    const answered = [dismissed(first)];
    const shifted = [...entries, ...visits];
    expect(composeSuggestions(input({ entries: shifted, trips, answered, memory }))).toEqual([]);
  });

  it("keeps unticked members on accept to their member set, not their days", () => {
    const answered: AnsweredProposal[] = [
      { ...dismissed(shown()), kind: "assign", targetId: "t9", source: "declined" },
    ];
    expect(composeSuggestions(input({ entries: week(), answered, memory }))).toHaveLength(1);
  });
});

describe("candidate rules (trip suggestions v2)", () => {
  it("prefers extending an existing trip over a new one when the absence overlaps it", () => {
    const entries = week().map((e) => (e.key === "lodging:rome" ? { ...e, tripId: "t1" } : e));
    const out = composeSuggestions(
      input({ entries, trips: [trip("t1", "2025-05-06", "2025-05-09")] })
    );
    expect(out.map((p) => p.kind)).toEqual(["extend"]);
  });

  it("never offers days a dated trip covers as a new trip — they go to that trip", () => {
    // Trips covering an absence always catch it by their window (`tripFor`),
    // so the coverage drop of v2 only ever acts on TravTrack rows (stream.ts).
    const trips = [trip("t1", "2025-05-03", "2025-05-08")];
    const out = composeSuggestions(input({ entries: week(), trips }));
    expect(out).toHaveLength(1);
    expect(out[0].kind).not.toBe("new_trip");
    expect(out[0].trip?.id).toBe("t1");
  });

  it("proposes an all-business absence as a business trip", () => {
    const entries = week().map((e) => ({ ...e, purpose: "business" }));
    const out = composeSuggestions(input({ entries }));
    expect(out[0].purpose).toBe("business");
  });

  it("does not call a mixed absence business", () => {
    const entries = week().map((e, i) => ({ ...e, purpose: i === 0 ? "business" : "private" }));
    expect(composeSuggestions(input({ entries }))[0].purpose).toBeUndefined();
  });

  it("makes one trip of one package booking, even across a day at home", () => {
    const entries = [
      ride(
        "rail",
        "a",
        AT.MUNICH_HBF,
        AT.FIRENZE,
        { day: "2025-05-03", hour: 7 },
        { day: "2025-05-03", hour: 15 },
        { bookingId: "b1" }
      ),
      stay("f", AT.FIRENZE, "2025-05-03", "2025-05-05", "Florenz", { bookingId: "b1" }),
      ride(
        "rail",
        "b",
        AT.FIRENZE,
        AT.MUNICH_HBF,
        { day: "2025-05-05", hour: 8 },
        { day: "2025-05-05", hour: 19 },
        { bookingId: "b1" }
      ),
      // Two days at home, then the package's second half.
      ride(
        "rail",
        "c",
        AT.MUNICH_HBF,
        AT.ROMA,
        { day: "2025-05-09", hour: 7 },
        { day: "2025-05-09", hour: 17 },
        { bookingId: "b1" }
      ),
      stay("r", AT.ROMA, "2025-05-09", "2025-05-11", "Rom", { bookingId: "b1" }),
      ride(
        "rail",
        "d",
        AT.ROMA,
        AT.MUNICH_HBF,
        { day: "2025-05-11", hour: 8 },
        { day: "2025-05-11", hour: 19 },
        { bookingId: "b1" }
      ),
    ];
    const out = composeSuggestions(input({ entries }));
    expect(out).toHaveLength(1);
    expect(out[0].signals).toContain("package");
    expect(out[0].members).toHaveLength(6);
  });
});
