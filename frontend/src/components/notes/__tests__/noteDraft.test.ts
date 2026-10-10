import { describe, expect, it } from "vitest";

import { draftMoment, draftOfNote, draftProblems, newNoteDraft, notesByDay } from "../noteDraft";
import { noteFixture } from "./noteFixture";

describe("newNoteDraft — now, on the clock of the zone the note is written in", () => {
  it("reads 22:30 UTC as 00:30 on the next day in Berlin", () => {
    const draft = newNoteDraft("Europe/Berlin", new Date("2026-09-27T22:30:00Z"));
    expect(draft).toMatchObject({ date: "2026-09-28", time: "00:30", zone: "Europe/Berlin" });
  });

  it("reads the same instant as the 27th in New York", () => {
    const draft = newNoteDraft("America/New_York", new Date("2026-09-27T22:30:00Z"));
    expect(draft).toMatchObject({ date: "2026-09-27", time: "18:30" });
  });
});

describe("draftOfNote — the server's own reading, never re-derived", () => {
  it("takes date and time from times.occurredAt.local", () => {
    expect(draftOfNote(noteFixture())).toMatchObject({
      date: "2026-09-28",
      time: "00:30",
      zone: "Europe/Berlin",
    });
  });

  it("leaves the time empty for a note dated to the day", () => {
    expect(draftOfNote(noteFixture({ occurredPrecision: "day" })).time).toBe("");
  });
});

describe("draftMoment", () => {
  const base = newNoteDraft("Europe/Berlin", new Date("2026-09-27T10:00:00Z"));

  it("sends the wall clock with its zone", () => {
    expect(draftMoment({ ...base, date: "2026-09-28", time: "00:30" })).toEqual({
      local: "2026-09-28T00:30",
      zone: "Europe/Berlin",
    });
  });

  it("sends the day alone when no time was given, never an invented midnight", () => {
    expect(draftMoment({ ...base, date: "2026-09-28", time: "" })).toEqual({
      day: "2026-09-28",
      zone: "Europe/Berlin",
    });
  });
});

describe("draftProblems", () => {
  const base = { body: "x", date: "2026-09-28", time: "", zone: "Europe/Berlin", placeName: "" };

  it("passes a complete draft", () => {
    expect(draftProblems(base)).toEqual({});
  });

  it("names each missing piece", () => {
    expect(draftProblems({ ...base, body: "  ", date: "", zone: "Mars/Olympus" })).toEqual({
      body: "notes:editor.bodyRequired",
      date: "notes:editor.dateRequired",
      zone: "notes:errors.zoneMissing",
    });
  });
});

describe("notesByDay", () => {
  it("groups by the day the server names, newest day and newest note first", () => {
    const lateBerlin = noteFixture({ id: "a" });
    const sameDay = noteFixture({
      id: "b",
      occurredAt: "2026-09-28T08:00:00.000Z",
      times: {
        ...noteFixture().times,
        day: { date: "2026-09-28", zone: "Europe/Berlin", precision: "day" },
      },
    });
    const earlier = noteFixture({
      id: "c",
      occurredAt: "2026-09-20T08:00:00.000Z",
      times: {
        ...noteFixture().times,
        day: { date: "2026-09-20", zone: "Europe/Berlin", precision: "day" },
      },
    });
    const groups = notesByDay([earlier, lateBerlin, sameDay]);
    expect(groups.map((g) => g.day)).toEqual(["2026-09-28", "2026-09-20"]);
    // 22:30 UTC on the 27th is filed under the 28th — the day where it was written.
    expect(groups[0].notes.map((n) => n.id)).toEqual(["b", "a"]);
  });
});
