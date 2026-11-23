import { describe, expect, it } from "@jest/globals";

import { judgeSpan, type SpanDecision } from "../rejectionMemory";
import { mergeStream } from "../stream";
import type { TripSuggestion } from "../types";

/**
 * The merged candidate stream (trip suggestions v2): the engine's proposals and
 * the TravTrack questions, one memory, at most three open cards.
 */

const card = (
  id: string,
  startDay: string,
  endDay: string,
  kind: TripSuggestion["kind"] = "new_trip"
): TripSuggestion => ({
  id,
  kind,
  startDay,
  endDay,
  nights: 1,
  planned: false,
  destination: null,
  signals: [],
  zoneUnknown: 0,
  members: [],
});

const row = (id: string, fromDay: string, toDay: string) => ({ id, fromDay, toDay });
const never = () => false;

describe("mergeStream", () => {
  it("drops a TravTrack period the engine already proposes over the same days", () => {
    const out = mergeStream({
      engine: [card("a", "2025-05-03", "2025-05-09")],
      travTrack: [row("t", "2025-05-08", "2025-05-12")],
      tripSpans: [],
      isRejected: never,
    });
    expect(out.engine.map((c) => c.id)).toEqual(["a"]);
    expect([...out.travTrackIds]).toEqual([]);
  });

  it("drops a TravTrack period existing trips cover by more than half", () => {
    const out = mergeStream({
      engine: [],
      travTrack: [row("t", "2025-05-01", "2025-05-04")],
      tripSpans: [{ startDay: "2025-05-02", endDay: "2025-05-04" }],
      isRejected: never,
    });
    expect(out.total).toBe(0);
  });

  it("drops a TravTrack period the shared memory rejected", () => {
    const out = mergeStream({
      engine: [],
      travTrack: [row("t", "2025-05-01", "2025-05-04")],
      tripSpans: [],
      isRejected: () => true,
    });
    expect(out.total).toBe(0);
  });

  it("opens at most three cards, newest first, across both sources", () => {
    const out = mergeStream({
      engine: [card("a", "2025-01-01", "2025-01-03"), card("b", "2025-03-01", "2025-03-03")],
      travTrack: [row("t1", "2025-02-01", "2025-02-03"), row("t2", "2025-04-01", "2025-04-03")],
      tripSpans: [],
      isRejected: never,
    });
    expect(out.total).toBe(4);
    expect([...out.travTrackIds]).toEqual(["t2", "t1"]);
    expect(out.engine.map((c) => c.id)).toEqual(["b"]);
  });
});

describe("judgeSpan", () => {
  const d = (over: Partial<SpanDecision> = {}): SpanDecision => ({
    family: "trip",
    targetId: null,
    startDay: "2025-05-03",
    endDay: "2025-05-09",
    decidedDay: "2025-06-01",
    homeSignature: null,
    ...over,
  });
  const c = (
    startDay: string,
    endDay: string,
    family: "trip" | "place" = "trip",
    targetId: string | null = null
  ) => ({
    family,
    targetId,
    startDay,
    endDay,
    homeSignature: null,
  });

  it("suppresses one day of overlap", () => {
    expect(judgeSpan(c("2025-05-09", "2025-05-12"), [d()], "2026-01-01", 14)).toBe("suppressed");
  });
  it("leaves an adjacent span alone", () => {
    expect(judgeSpan(c("2025-05-10", "2025-05-12"), [d()], "2026-01-01", 14)).toBe("open");
  });
  it("lets exactly double through as suppressed, more than double as expanded", () => {
    expect(judgeSpan(c("2025-05-03", "2025-05-16"), [d()], "2026-01-01", 14)).toBe("suppressed");
    expect(judgeSpan(c("2025-05-03", "2025-05-17"), [d()], "2026-01-01", 14)).toBe("expanded");
  });
  it("holds even an expanded span during the quiet period", () => {
    expect(
      judgeSpan(c("2025-05-03", "2025-05-30"), [d({ decidedDay: "2025-12-25" })], "2026-01-01", 14)
    ).toBe("suppressed");
  });
  it("judges place visits per place", () => {
    const visit = d({
      family: "place",
      targetId: "p1",
      startDay: "2025-05-04",
      endDay: "2025-05-04",
    });
    expect(judgeSpan(c("2025-05-04", "2025-05-04", "place", "p1"), [visit], "2026-01-01", 14)).toBe(
      "suppressed"
    );
    expect(judgeSpan(c("2025-05-04", "2025-05-04", "place", "p2"), [visit], "2026-01-01", 14)).toBe(
      "open"
    );
  });
});
