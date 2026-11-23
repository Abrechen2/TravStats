import { parseIcsInWorker } from "../icsWorker";
import { parseIcsWindow, unsafeEventRule } from "../icsParse";
import { readCaldav } from "../sources";
import type { FetchLike } from "../../egress/boundedFetch";

/**
 * Crafted calendars that used to block the server (security review, MEDIUM):
 * a recurrence ical.js walks forever inside one `next()`, a time zone whose
 * rules recur every second, and many collections whose texts each stayed under
 * a per-text budget. Each test goes through the worker, so without its fix it
 * ends at the kill (a timeout) instead of hanging the suite.
 */

const ics = (...lines: string[]) =>
  ["BEGIN:VCALENDAR", "VERSION:2.0", ...lines, "END:VCALENDAR"].join("\r\n");
const NOV = {
  fromMs: Date.UTC(2026, 10, 1),
  untilMs: Date.UTC(2026, 11, 1),
  profileZone: "Europe/Berlin",
};
const soon = () => Date.now() + 4000;

jest.setTimeout(20_000);

describe("crafted calendars", () => {
  it("refuses a recurrence that can never match (30 February) instead of looping", async () => {
    const text = ics(
      "BEGIN:VEVENT",
      "UID:never",
      "SUMMARY:never",
      "DTSTART:20200101T000000Z",
      "RRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30",
      "END:VEVENT",
      "BEGIN:VEVENT",
      "UID:ok",
      "SUMMARY:ok",
      "DTSTART:20261110T090000Z",
      "END:VEVENT"
    );
    const result = await parseIcsInWorker([text], { ...NOV, deadlineAt: soon() });
    expect(result.skippedRules).toBe(1);
    expect(result.events.map((e) => e.uid)).toEqual(["ok"]);
  });

  it("refuses a VTIMEZONE whose rules recur finer than monthly", async () => {
    const text = ics(
      "BEGIN:VTIMEZONE",
      "TZID:Evil",
      "BEGIN:STANDARD",
      "DTSTART:16010101T000000",
      "RRULE:FREQ=SECONDLY",
      "TZOFFSETFROM:+0100",
      "TZOFFSETTO:+0100",
      "END:STANDARD",
      "END:VTIMEZONE",
      "BEGIN:VEVENT",
      "UID:e",
      "SUMMARY:e",
      "DTSTART;TZID=Evil:20261110T090000",
      "END:VEVENT"
    );
    await expect(parseIcsInWorker([text], { ...NOV, deadlineAt: soon() })).rejects.toMatchObject({
      kind: "protocol",
      code: "CALENDAR_UNSAFE_TIMEZONE",
    });
  });

  it("holds one event budget across many collections", async () => {
    // Each collection answers 40 small events; 30 collections are 1200 — over a budget of 1000
    // that every single text stays far below.
    const event = (i: number, c: number) =>
      `<d:response><d:href>/cal/${c}/${i}.ics</d:href><d:propstat><d:prop><c:calendar-data>${ics(
        "BEGIN:VEVENT",
        `UID:${c}-${i}`,
        "SUMMARY:x",
        "DTSTART:20261110T090000Z",
        "END:VEVENT"
      )}</c:calendar-data></d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
    const fetchImpl: FetchLike = async (url) => {
      const c = Number(new URL(url).pathname.split("/")[2]);
      const body = `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav">${Array.from(
        { length: 40 },
        (_, i) => event(i, c)
      ).join("")}</d:multistatus>`;
      return new Response(body, { status: 207 });
    };
    const collections = Array.from({ length: 30 }, (_, c) => ({
      href: `https://dav.example.com/cal/${c}/`,
      name: String(c),
    }));
    await expect(
      readCaldav(
        { url: "https://dav.example.com/", username: "u", password: "p" },
        collections,
        NOV,
        "Europe/Berlin",
        { allowPrivate: true },
        { fetch: fetchImpl, maxEvents: 1000 }
      )
    ).rejects.toMatchObject({ code: "CALENDAR_TOO_MANY_EVENTS" });
  });

  it("kills a parse stuck inside the library at the read's deadline", async () => {
    const started = Date.now();
    await expect(
      parseIcsInWorker([ics()], { ...NOV, deadlineAt: Date.now() + 1500, spinForTest: true })
    ).rejects.toMatchObject({ code: "CALENDAR_PARSE_TIMEOUT" });
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("unsafe recurrences", () => {
  it.each([
    [{ freq: "SECONDLY" }, true],
    [{ freq: "MINUTELY" }, true],
    [{ freq: "YEARLY", parts: { BYMONTH: [2], BYMONTHDAY: [30] } }, true],
    [{ freq: "YEARLY", parts: { BYMONTH: [4, 6], BYMONTHDAY: [31] } }, true],
    [{ freq: "WEEKLY", parts: { BYWEEKNO: [10] } }, true],
    [{ freq: "YEARLY", parts: { BYMONTH: [2], BYMONTHDAY: [29] } }, false],
    [{ freq: "MONTHLY", parts: { BYMONTHDAY: [-1] } }, false],
    [{ freq: "WEEKLY", parts: { BYDAY: ["MO"] } }, false],
  ])("%j unsafe: %s", (recur, unsafe) => {
    expect(unsafeEventRule(recur)).toBe(unsafe);
  });

  it("refuses a rule starting before 1900", () => {
    const { events, skippedRules } = parseIcsWindow(
      ics(
        "BEGIN:VEVENT",
        "UID:old",
        "SUMMARY:old",
        "DTSTART:18001110T090000Z",
        "RRULE:FREQ=YEARLY",
        "END:VEVENT"
      ),
      NOV
    );
    expect(events).toEqual([]);
    expect(skippedRules).toBe(1);
  });
});
