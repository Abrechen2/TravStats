import { escapeText, foldLine, formatDay, formatUtc, writeCalendar, type IcsEvent } from "../ics";

/**
 * The iCalendar writer behind the calendar feed (forgejo#310), held to the
 * RFC 5545 rules a calendar app is strict about: CRLF line ends, 75-octet
 * folding that never splits a UTF-8 sequence, TEXT escaping, DTSTAMP.
 */

const octets = (line: string): number => Buffer.byteLength(line, "utf8");

/** Undo §3.1 folding: a CRLF followed by one space joins the lines. */
const unfold = (text: string): string => text.replace(/\r\n /g, "");

const timed: IcsEvent = {
  uid: "flight-1@travstats",
  summary: "✈ München → Wien LH 2280",
  bounds: {
    kind: "timed",
    start: new Date("2030-06-01T12:05:00Z"),
    end: new Date("2030-06-01T13:20:00Z"),
  },
  location: "MUC → VIE",
  description: "Lufthansa\nhttps://travstats.example/flights/1",
  url: "https://travstats.example/flights/1",
  lastModified: new Date("2030-05-01T08:00:00Z"),
};

const allDay: IcsEvent = {
  uid: "stay-1@travstats",
  summary: "🏨 Hotel Sacher",
  bounds: { kind: "allDay", start: "2030-06-01", endExclusive: "2030-06-04" },
};

describe("ics writer", () => {
  it("ends every line in CRLF, the last one included, with no bare LF anywhere", () => {
    const text = writeCalendar({
      name: "TravStats",
      refreshMinutes: 60,
      generatedAt: new Date("2030-05-20T10:00:00Z"),
      events: [timed, allDay],
    });
    expect(text.endsWith("END:VCALENDAR\r\n")).toBe(true);
    expect(text.replace(/\r\n/g, "")).not.toMatch(/[\r\n]/);
    expect(text.startsWith("BEGIN:VCALENDAR\r\nVERSION:2.0\r\n")).toBe(true);
  });

  it("writes a timed event in UTC and an all-day event as VALUE=DATE with an exclusive end", () => {
    const text = unfold(
      writeCalendar({
        name: "TravStats",
        refreshMinutes: 60,
        generatedAt: new Date("2030-05-20T10:00:00Z"),
        events: [timed, allDay],
      })
    );
    expect(text).toContain("\r\nDTSTART:20300601T120500Z\r\nDTEND:20300601T132000Z\r\n");
    expect(text).toContain("\r\nDTSTART;VALUE=DATE:20300601\r\nDTEND;VALUE=DATE:20300604\r\n");
    // DTSTAMP is required in every VEVENT (§3.6.1).
    expect(text.match(/\r\nDTSTAMP:20300520T100000Z\r\n/g)).toHaveLength(2);
    expect(text).toContain("\r\nUID:flight-1@travstats\r\n");
    expect(text).toContain("\r\nLAST-MODIFIED:20300501T080000Z\r\n");
    expect(text).toContain("\r\nREFRESH-INTERVAL;VALUE=DURATION:PT60M\r\n");
  });

  it("leaves DTEND out of a timed event without an end", () => {
    const text = writeCalendar({
      name: "TravStats",
      refreshMinutes: 60,
      generatedAt: new Date("2030-05-20T10:00:00Z"),
      events: [
        { ...timed, bounds: { kind: "timed", start: timed.bounds.start as Date, end: null } },
      ],
    });
    expect(text).toContain("DTSTART:20300601T120500Z\r\n");
    expect(text).not.toContain("DTEND");
  });

  it("escapes backslash, semicolon, comma and every kind of newline in TEXT", () => {
    expect(escapeText("a\\b;c,d\ne\r\nf\rg")).toBe("a\\\\b\\;c\\,d\\ne\\nf\\ng");
    const text = unfold(
      writeCalendar({
        name: "Mine, yours; ours",
        refreshMinutes: 60,
        generatedAt: new Date("2030-05-20T10:00:00Z"),
        events: [{ ...allDay, summary: "Hotel A, B; C\\D", description: "line 1\nline 2" }],
      })
    );
    expect(text).toContain("\r\nSUMMARY:Hotel A\\, B\\; C\\\\D\r\n");
    expect(text).toContain("\r\nDESCRIPTION:line 1\\nline 2\r\n");
    expect(text).toContain("\r\nX-WR-CALNAME:Mine\\, yours\\; ours\r\n");
  });

  it("drops control characters TEXT may not carry", () => {
    expect(escapeText("a\u0000b\u0007c\u007fd")).toBe("abcd");
  });

  it("does not escape a URL's commas — a URI value is not TEXT", () => {
    const text = unfold(
      writeCalendar({
        name: "TravStats",
        refreshMinutes: 60,
        generatedAt: new Date("2030-05-20T10:00:00Z"),
        events: [{ ...allDay, url: "https://x.example/a,b;c" }],
      })
    );
    expect(text).toContain("\r\nURL:https://x.example/a,b;c\r\n");
  });

  it("folds at 75 octets, counting octets rather than characters", () => {
    // 60 two-octet characters: 120 octets, but only 60 characters — a writer
    // that folded by `.length` would leave this line unfolded at 129 octets.
    const line = `SUMMARY:${"ü".repeat(60)}`;
    const folded = foldLine(line);
    const physical = folded.split("\r\n");
    expect(physical.length).toBeGreaterThan(1);
    for (const piece of physical) expect(octets(piece)).toBeLessThanOrEqual(75);
    for (const piece of physical.slice(1)) expect(piece.startsWith(" ")).toBe(true);
    expect(unfold(folded)).toBe(line);
  });

  it("never splits a multi-byte character across a fold", () => {
    // One ASCII octet shifts every 4-octet emoji off the fold boundary.
    const line = `SUMMARY:x${"🚆".repeat(40)}`;
    const physical = foldLine(line).split("\r\n");
    for (const piece of physical) {
      expect(octets(piece)).toBeLessThanOrEqual(75);
      // A cut sequence would decode to U+FFFD on a round trip.
      expect(Buffer.from(piece, "utf8").toString("utf8")).toBe(piece);
      expect(piece).not.toContain("�");
    }
    expect(unfold(physical.join("\r\n"))).toBe(line);
  });

  it("leaves a line of exactly 75 octets alone and folds the 76th", () => {
    expect(foldLine("A".repeat(75))).toBe("A".repeat(75));
    expect(foldLine("A".repeat(76))).toBe(`${"A".repeat(75)}\r\n A`);
  });

  it("formats instants in UTC and days without a zone", () => {
    expect(formatUtc(new Date("2030-01-02T03:04:05.678Z"))).toBe("20300102T030405Z");
    expect(formatDay("2030-12-31")).toBe("20301231");
    expect(() => formatDay("2030-12-31T00:00")).toThrow();
  });
});

/**
 * Local times at the place (owner, 2026-10-26): a Korea flight was shown at
 * German times. A timed event with a known zone is written as that zone's wall
 * clock with a TZID, and the calendar carries a VTIMEZONE for each zone used.
 */
describe("ics writer — place zones", () => {
  const calendar = (events: IcsEvent[]): string =>
    unfold(
      writeCalendar({
        name: "TravStats",
        refreshMinutes: 60,
        generatedAt: new Date("2026-10-01T10:00:00Z"),
        events,
      })
    );

  // KE1206: 03:05 UTC is 12:05 in Seoul.
  const seoul: IcsEvent = {
    uid: "flight-ke1206@travstats",
    summary: "✈ Jeju 12:05 → Gimpo 13:10 · KE1206",
    bounds: {
      kind: "timed",
      start: new Date("2026-10-17T03:05:00Z"),
      end: new Date("2026-10-17T04:10:00Z"),
      startZone: "Asia/Seoul",
      endZone: "Asia/Seoul",
    },
  };

  // Departs at local midnight on the night Berlin leaves summer time (25 Oct,
  // 03:00 CEST → 02:00 CET), lands at 07:00 CET.
  const berlinNight: IcsEvent = {
    uid: "rail-night@travstats",
    summary: "🚆 Berlin 00:00 → München 07:00",
    bounds: {
      kind: "timed",
      start: new Date("2026-10-24T22:00:00Z"),
      end: new Date("2026-10-25T06:00:00Z"),
      startZone: "Europe/Berlin",
      endZone: "Europe/Berlin",
    },
  };

  const vtimezone = (text: string, zone: string): string => {
    const match = text.match(
      new RegExp(`BEGIN:VTIMEZONE\\r\\nTZID:${zone}\\r\\n[\\s\\S]*?END:VTIMEZONE`)
    );
    if (!match) throw new Error(`no VTIMEZONE for ${zone}`);
    return match[0];
  };

  it("writes a Seoul flight on Seoul's clock, with a VTIMEZONE for Asia/Seoul", () => {
    const text = calendar([seoul]);
    expect(text).toContain("DTSTART;TZID=Asia/Seoul:20261017T120500\r\n");
    expect(text).toContain("DTEND;TZID=Asia/Seoul:20261017T131000\r\n");
    const block = vtimezone(text, "Asia/Seoul");
    expect(block).toContain("TZOFFSETTO:+0900");
    expect(block).not.toContain("BEGIN:DAYLIGHT");
  });

  it("writes start and end each in its own zone", () => {
    const text = calendar([
      {
        ...seoul,
        bounds: {
          kind: "timed",
          start: new Date("2026-10-17T03:05:00Z"),
          end: new Date("2026-10-17T15:00:00Z"),
          startZone: "Asia/Seoul",
          endZone: "Europe/Berlin",
        },
      },
    ]);
    expect(text).toContain("DTSTART;TZID=Asia/Seoul:20261017T120500\r\n");
    expect(text).toContain("DTEND;TZID=Europe/Berlin:20261017T170000\r\n");
    vtimezone(text, "Asia/Seoul");
    vtimezone(text, "Europe/Berlin");
  });

  it("crosses Berlin's October DST change with both offsets and the transition", () => {
    const text = calendar([berlinNight]);
    expect(text).toContain("DTSTART;TZID=Europe/Berlin:20261025T000000\r\n");
    expect(text).toContain("DTEND;TZID=Europe/Berlin:20261025T070000\r\n");
    const block = vtimezone(text, "Europe/Berlin");
    // Onsets are local times in the offset in force BEFORE them (RFC 5545 §3.6.5).
    expect(block).toMatch(
      /BEGIN:STANDARD\r\nDTSTART:20261025T030000\r\nTZOFFSETFROM:\+0200\r\nTZOFFSETTO:\+0100\r\nEND:STANDARD/
    );
    expect(block).toMatch(
      /BEGIN:DAYLIGHT\r\nDTSTART:20260329T020000\r\nTZOFFSETFROM:\+0100\r\nTZOFFSETTO:\+0200\r\nEND:DAYLIGHT/
    );
  });

  it("keeps an event without a known zone in UTC and adds no VTIMEZONE", () => {
    const unknown: IcsEvent = {
      ...seoul,
      uid: "x@travstats",
      bounds: { ...seoul.bounds, startZone: "Mars/Olympus", endZone: null } as IcsEvent["bounds"],
    };
    const text = calendar([timed, unknown]);
    expect(text).toContain("DTSTART:20300601T120500Z\r\n");
    expect(text).toContain("DTSTART:20261017T030500Z\r\n");
    expect(text).toContain("DTEND:20261017T041000Z\r\n");
    expect(text).not.toContain("VTIMEZONE");
    expect(text).not.toContain("TZID");
  });

  it("writes a far-off event in UTC without walking its zone's millennia", () => {
    // The feed URL is public: one entry dated 9999 must not make every read
    // generate eight thousand years of Berlin transitions.
    const far = (iso: string, uid: string): IcsEvent => ({
      ...berlinNight,
      uid,
      bounds: { kind: "timed", start: new Date(iso), end: null, startZone: "Europe/Berlin" },
    });
    const started = performance.now();
    const text = calendar([
      far("9999-06-01T10:00:00Z", "a"),
      far("0001-06-01T10:00:00Z", "b"),
      seoul,
    ]);
    expect(performance.now() - started).toBeLessThan(100);
    expect(text).toContain("DTSTART:99990601T100000Z\r\n");
    expect(text).toContain("DTSTART:00010601T100000Z\r\n");
    expect(text).not.toContain("TZID:Europe/Berlin");
    expect(text).toContain("DTSTART;TZID=Asia/Seoul:20261017T120500\r\n");
  });

  it("keeps the zone window to thirty years around the calendar's date", () => {
    // Inside 1970–2100, but decades from the feed's date: UTC, and no
    // VTIMEZONE stretched across the gap.
    const at = (iso: string, uid: string): IcsEvent => ({
      ...berlinNight,
      uid,
      bounds: { kind: "timed", start: new Date(iso), end: null, startZone: "Europe/Berlin" },
    });
    const text = calendar([at("2026-12-01T10:00:00Z", "near"), at("2090-06-01T10:00:00Z", "far")]);
    expect(text).toContain("DTSTART;TZID=Europe/Berlin:20261201T110000\r\n");
    expect(text).toContain("DTSTART:20900601T100000Z\r\n");
    const block = vtimezone(text, "Europe/Berlin");
    expect(block).not.toMatch(/DTSTART:20[3-9]\d/);
  });

  it("is a valid calendar: folded lines, balanced blocks, a VTIMEZONE for every TZID", () => {
    const raw = writeCalendar({
      name: "TravStats",
      refreshMinutes: 60,
      generatedAt: new Date("2026-10-01T10:00:00Z"),
      events: [
        { ...seoul, summary: `${seoul.summary} ${"Ü".repeat(60)}` },
        berlinNight,
        timed,
        allDay,
      ],
    });
    const physical = raw.split("\r\n").slice(0, -1);
    for (const line of physical) expect(octets(line)).toBeLessThanOrEqual(75);
    const lines = unfold(raw).split("\r\n");
    const stack: string[] = [];
    for (const line of lines) {
      if (line.startsWith("BEGIN:")) stack.push(line.slice(6));
      if (line.startsWith("END:")) expect(stack.pop()).toBe(line.slice(4));
    }
    expect(stack).toEqual([]);
    const referenced = new Set([...unfold(raw).matchAll(/;TZID=([^:;]+):/g)].map((m) => m[1]));
    const defined = new Set([...unfold(raw).matchAll(/\r\nTZID:([^\r]+)\r\n/g)].map((m) => m[1]));
    expect([...referenced].sort()).toEqual(["Asia/Seoul", "Europe/Berlin"]);
    expect([...defined].sort()).toEqual([...referenced].sort());
    // Every VTIMEZONE precedes the first VEVENT.
    expect(raw.lastIndexOf("END:VTIMEZONE")).toBeLessThan(raw.indexOf("BEGIN:VEVENT"));
  });
});
