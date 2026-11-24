import { placeMatch, textNames, timeMatch, type StopSpan } from "../match";
import { applyRules, type CalendarRuleView } from "../rules";
import type { CalendarEvent } from "../icsParse";

/** The matcher's truth table (spec 2026-11-23-plugins-and-calendar.md, P2). */
const H = 3_600_000;
const T0 = Date.UTC(2026, 10, 10, 9);
const STOP: StopSpan = { fromMs: T0, untilMs: T0 + 2 * H, lat: 48.69, lon: 9.31 };
const ev = (over: Partial<CalendarEvent> = {}): CalendarEvent => ({
  uid: "u",
  title: "WAR Musterfirma",
  location: null,
  startMs: T0,
  endMs: T0 + 2 * H,
  allDay: false,
  startDay: null,
  endDay: null,
  ...over,
});
const at = (meters: number) => ({ lat: STOP.lat + meters / 111_320, lon: STOP.lon });

describe("timeMatch", () => {
  it.each([
    ["same span", ev(), "overlap"],
    [
      "half of the shorter (1 h of a 2 h event inside a 2 h stop)",
      ev({ startMs: T0 + H, endMs: T0 + 3 * H }),
      "overlap",
    ],
    [
      "under half, start within 60 min",
      ev({ startMs: T0 - 50 * 60_000, endMs: T0 - 5 * 60_000 }),
      "startNear",
    ],
    [
      "stop starts 61 min after a short event",
      ev({ startMs: T0 - 61 * 60_000, endMs: T0 - 31 * 60_000 }),
      null,
    ],
    ["the evening before", ev({ startMs: T0 - 12 * H, endMs: T0 - 11 * H }), null],
    [
      "all-day that covers it",
      ev({ allDay: true, startMs: T0 - 9 * H, endMs: T0 + 15 * H }),
      "overlap",
    ],
  ])("%s → %s", (_, event, expected) => {
    expect(timeMatch(event, STOP)).toBe(expected);
  });
});

describe("placeMatch", () => {
  const none = { geocoded: null, named: [], rulePlace: null };
  it("takes a geocoded location within 300 m, not at 301 m", () => {
    expect(placeMatch(ev(), STOP, { ...none, geocoded: at(290) })?.match).toBe("geocoded");
    expect(placeMatch(ev(), STOP, { ...none, geocoded: at(310) })).toBeNull();
  });
  it("matches the location text to an own place or the venue beside the stop", () => {
    const named = [{ id: "p1", name: "Musterfirma GmbH", ...at(100) }];
    expect(
      placeMatch(ev({ location: "Musterfirma GmbH, Musterstraße 5" }), STOP, { ...none, named })
    ).toMatchObject({ match: "placeName", placeId: "p1" });
    // The same name 2 km away is not this stop.
    expect(
      placeMatch(ev({ location: "Musterfirma GmbH" }), STOP, {
        ...none,
        named: [{ id: "p2", name: "Musterfirma GmbH", ...at(2000) }],
      })
    ).toBeNull();
  });
  it("takes the place a keyword rule names, when it is beside the stop", () => {
    expect(
      placeMatch(ev(), STOP, { ...none, rulePlace: { id: "p3", name: "Kunde", ...at(50) } })
    ).toMatchObject({ match: "rulePlace", placeId: "p3" });
  });
  it("is context only without any of the three", () => {
    expect(placeMatch(ev({ location: "Irgendwo" }), STOP, none)).toBeNull();
  });
});

describe("textNames", () => {
  it.each([
    ["Café Müller, Hauptstr. 1", "Cafe Müller", true],
    ["Besprechung bei Bosch Feuerbach", "Bosch", true],
    ["Boschstraße 3", "Bosch", false],
    ["Raum 4", "Musterfirma", false],
  ])("%s names %s: %s", (location, name, expected) => {
    expect(textNames(location, name)).toBe(expected);
  });
});

describe("applyRules", () => {
  const rules: CalendarRuleView[] = [
    {
      id: "r1",
      position: 0,
      kind: "keyword",
      sourceId: null,
      token: "WAR",
      matchMode: "startsWith",
      purpose: "business",
      nameTemplate: "{titleAfterToken}",
      placeId: null,
    },
    {
      id: "r2",
      position: 1,
      kind: "calendar",
      sourceId: "work",
      token: null,
      matchMode: "contains",
      purpose: "business",
      nameTemplate: null,
      placeId: null,
    },
  ];
  it("first match wins, with the template filled", () => {
    expect(applyRules(rules, ev({ title: "WAR: Musterfirma" }), "home")).toMatchObject({
      ruleId: "r1",
      purpose: "business",
      name: "Musterfirma",
    });
  });
  it("matches a token at word boundaries only, case-insensitively", () => {
    expect(applyRules(rules, ev({ title: "war Musterfirma" }), "home").ruleId).toBe("r1");
    expect(applyRules(rules, ev({ title: "WARTUNG Musterfirma" }), "home").ruleId).toBeNull();
  });
  it("a calendar rule takes every event of its calendar", () => {
    expect(applyRules(rules, ev({ title: "Termin" }), "work")).toMatchObject({
      ruleId: "r2",
      name: "Termin",
    });
  });
  it("without a rule: the title as name and no purpose", () => {
    expect(applyRules(rules, ev({ title: "Zahnarzt" }), "home")).toMatchObject({
      ruleId: null,
      purpose: null,
      name: "Zahnarzt",
    });
  });
});
