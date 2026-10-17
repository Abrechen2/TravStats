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
