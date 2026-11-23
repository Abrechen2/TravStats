import { parseIcsWindow, MAX_EVENTS_PER_FILE, MAX_EXPANSIONS_PER_RULE } from "../icsParse";
import { CalendarError } from "../errors";

const ics = (...events: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//test//EN", ...events, "END:VCALENDAR"].join("\r\n");
const vevent = (lines: string[]) => ["BEGIN:VEVENT", ...lines, "END:VEVENT"].join("\r\n");

const NOV = {
  fromMs: Date.UTC(2026, 10, 1),
  untilMs: Date.UTC(2026, 11, 1),
  profileZone: "Europe/Berlin",
};

describe("parseIcsWindow", () => {
  it("places a DTSTART with an IANA TZID in that zone, not the host's", () => {
    const { events } = parseIcsWindow(
      ics(
        vevent([
          "UID:a",
          "SUMMARY:Kunde Muster",
          "LOCATION:Musterstraße 5, Stuttgart",
          "DTSTART;TZID=America/New_York:20261110T090000",
          "DTEND;TZID=America/New_York:20261110T103000",
        ])
      ),
      NOV
    );
    expect(events).toHaveLength(1);
    // 09:00 in New York in November (EST, UTC-5) is 14:00Z.
    expect(new Date(events[0].startMs).toISOString()).toBe("2026-11-10T14:00:00.000Z");
    expect(new Date(events[0].endMs).toISOString()).toBe("2026-11-10T15:30:00.000Z");
    expect(events[0]).toMatchObject({
      uid: "a",
      title: "Kunde Muster",
      location: "Musterstraße 5, Stuttgart",
      allDay: false,
    });
  });

  it("uses a VTIMEZONE the file defines for a non-IANA TZID", () => {
    const vtz = [
      "BEGIN:VTIMEZONE",
      "TZID:W. Europe Standard Time",
      "BEGIN:STANDARD",
      "DTSTART:16011028T030000",
      "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=10",
      "TZOFFSETFROM:+0200",
      "TZOFFSETTO:+0100",
      "END:STANDARD",
      "BEGIN:DAYLIGHT",
      "DTSTART:16010325T020000",
      "RRULE:FREQ=YEARLY;BYDAY=-1SU;BYMONTH=3",
      "TZOFFSETFROM:+0100",
      "TZOFFSETTO:+0200",
      "END:DAYLIGHT",
      "END:VTIMEZONE",
    ].join("\r\n");
    const { events } = parseIcsWindow(
      ics(
        vtz,
        vevent([
          "UID:w",
          "SUMMARY:Outlook",
          "DTSTART;TZID=W. Europe Standard Time:20261110T090000",
          "DTEND;TZID=W. Europe Standard Time:20261110T100000",
        ])
      ),
      NOV
    );
    expect(new Date(events[0].startMs).toISOString()).toBe("2026-11-10T08:00:00.000Z");
  });

  it("reads a floating time in the profile zone and a Z time as UTC", () => {
    const { events } = parseIcsWindow(
      ics(
        vevent(["UID:f", "SUMMARY:F", "DTSTART:20261110T090000", "DTEND:20261110T100000"]),
        vevent(["UID:z", "SUMMARY:Z", "DTSTART:20261111T090000Z", "DTEND:20261111T100000Z"])
      ),
      { ...NOV, profileZone: "Asia/Tokyo" }
    );
    expect(new Date(events[0].startMs).toISOString()).toBe("2026-11-10T00:00:00.000Z");
    expect(new Date(events[1].startMs).toISOString()).toBe("2026-11-11T09:00:00.000Z");
  });

  it("keeps an all-day event as local dates in the profile zone", () => {
    const { events } = parseIcsWindow(
      ics(
        vevent([
          "UID:d",
          "SUMMARY:Messe",
          "DTSTART;VALUE=DATE:20261110",
          "DTEND;VALUE=DATE:20261112",
        ]),
        vevent(["UID:e", "SUMMARY:Ein Tag", "DTSTART;VALUE=DATE:20261120"])
      ),
      NOV
    );
    expect(events[0]).toMatchObject({ allDay: true, startDay: "2026-11-10", endDay: "2026-11-12" });
    // Midnight in Berlin (UTC+1 in November).
    expect(new Date(events[0].startMs).toISOString()).toBe("2026-11-09T23:00:00.000Z");
    expect(new Date(events[0].endMs).toISOString()).toBe("2026-11-11T23:00:00.000Z");
    expect(events[1]).toMatchObject({ startDay: "2026-11-20", endDay: "2026-11-21" });
  });

  it("expands RRULE only inside the window, with exceptions and EXDATE applied", () => {
    const { events, skippedRules } = parseIcsWindow(
      ics(
        vevent([
          "UID:r",
          "SUMMARY:Jour fixe",
          "DTSTART;TZID=Europe/Berlin:20240101T100000",
          "DTEND;TZID=Europe/Berlin:20240101T110000",
          "RRULE:FREQ=WEEKLY;BYDAY=MO",
          "EXDATE;TZID=Europe/Berlin:20261109T100000",
        ]),
        vevent([
          "UID:r",
          "RECURRENCE-ID;TZID=Europe/Berlin:20261116T100000",
          "SUMMARY:Jour fixe (verschoben)",
          "DTSTART;TZID=Europe/Berlin:20261117T140000",
          "DTEND;TZID=Europe/Berlin:20261117T150000",
        ])
      ),
      NOV
    );
    // Mondays in November 2026: 2, 9 (excluded), 16 (moved to the 17th), 23, 30.
    expect(events.map((e) => new Date(e.startMs).toISOString())).toEqual([
      "2026-11-02T09:00:00.000Z",
      "2026-11-17T13:00:00.000Z",
      "2026-11-23T09:00:00.000Z",
      "2026-11-30T09:00:00.000Z",
    ]);
    expect(events[1].title).toBe("Jour fixe (verschoben)");
    expect(skippedRules).toBe(0);
  });

  it("caps the occurrences of one rule inside the window and counts the cut", () => {
    const { events, skippedRules } = parseIcsWindow(
      ics(
        vevent([
          "UID:m",
          "SUMMARY:Ticker",
          "DTSTART:20261101T000000Z",
          "DTEND:20261101T000100Z",
          "RRULE:FREQ=MINUTELY;INTERVAL=5",
        ])
      ),
      NOV
    );
    expect(events).toHaveLength(MAX_EXPANSIONS_PER_RULE);
    expect(skippedRules).toBe(1);
  });

  it("counts a rule that runs out of iterations before reaching the window", () => {
    const { events, skippedRules } = parseIcsWindow(
      ics(
        vevent([
          "UID:h",
          "SUMMARY:Hourly since 1990",
          "DTSTART:19900101T000000Z",
          "RRULE:FREQ=HOURLY",
        ])
      ),
      { ...NOV, maxIterationsPerRule: 1000 }
    );
    expect(events).toHaveLength(0);
    expect(skippedRules).toBe(1);
  });

  it("refuses a file with more events than the cap, before parsing it", () => {
    const many = Array.from({ length: 3 }, (_, i) =>
      vevent([`UID:${i}`, "SUMMARY:x", "DTSTART:20261110T090000Z"])
    );
    expect(() => parseIcsWindow(ics(...many), { ...NOV, maxEvents: 2 })).toThrow(
      expect.objectContaining({ kind: "protocol", code: "CALENDAR_TOO_MANY_EVENTS" })
    );
    expect(MAX_EVENTS_PER_FILE).toBe(10_000);
  });

  it("answers an unparseable body as a protocol failure, and stops at the deadline", () => {
    expect(() => parseIcsWindow("<html>login</html>", NOV)).toThrow(CalendarError);
    let clock = 0;
    expect(() =>
      parseIcsWindow(
        ics(vevent(["UID:t", "SUMMARY:x", "DTSTART:20261110T090000Z", "RRULE:FREQ=DAILY"])),
        { ...NOV, deadlineMs: 10, now: () => (clock += 100) }
      )
    ).toThrow(expect.objectContaining({ code: "CALENDAR_PARSE_TIMEOUT" }));
  });

  it("drops cancelled events and events outside the window", () => {
    const { events } = parseIcsWindow(
      ics(
        vevent(["UID:c", "SUMMARY:c", "STATUS:CANCELLED", "DTSTART:20261110T090000Z"]),
        vevent(["UID:o", "SUMMARY:o", "DTSTART:20261210T090000Z"])
      ),
      NOV
    );
    expect(events).toEqual([]);
  });
});
