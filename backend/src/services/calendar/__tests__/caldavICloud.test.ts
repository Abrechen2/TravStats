import { assertXmlBounded, queryCollection } from "../caldav";
import { parseIcsTexts } from "../icsParse";
import { readCaldav } from "../sources";
import type { FetchLike } from "../../egress/boundedFetch";

/**
 * iCloud's REPORT answers, shaped after a real account (prod, rc.47) with every
 * summary, location and description replaced by synthetic text. That account's
 * source failed as a whole with CALENDAR_PARSE because one collection was empty
 * in the window, and with CALENDAR_XML_TOO_DEEP on a wider window because event
 * descriptions inside CDATA carried `<mailto:…>` and HTML.
 */

const BASE = "https://caldav.icloud.com/";
const CREDS = { url: BASE, username: "u", password: "app-pw" };
const POLICY = { allowPrivate: false };
const NOV = { fromMs: Date.UTC(2026, 10, 1), untilMs: Date.UTC(2026, 11, 1) };
const ZONE = "Europe/Berlin";

const ics = (...event: string[]) =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Apple Inc.//iPhone OS 18.1//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VTIMEZONE",
    "TZID:Europe/Berlin",
    "BEGIN:DAYLIGHT",
    "TZOFFSETFROM:+0100",
    "RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU",
    "DTSTART:19810329T020000",
    "TZNAME:MESZ",
    "TZOFFSETTO:+0200",
    "END:DAYLIGHT",
    "BEGIN:STANDARD",
    "TZOFFSETFROM:+0200",
    "RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU",
    "DTSTART:19961027T030000",
    "TZNAME:MEZ",
    "TZOFFSETTO:+0100",
    "END:STANDARD",
    "END:VTIMEZONE",
    ...event,
    "END:VCALENDAR",
  ].join("\r\n");

const event = (uid: string, start: string, extra: string[] = []) => [
  "BEGIN:VEVENT",
  `UID:${uid}`,
  `DTSTART;TZID=Europe/Berlin:${start}`,
  `DTEND;TZID=Europe/Berlin:${start.replace(/T\d\d/, "T23")}`,
  "SUMMARY:Synthetic event",
  ...extra,
  "BEGIN:VALARM",
  "ACTION:DISPLAY",
  "TRIGGER:-PT15M",
  "DESCRIPTION:Reminder",
  "END:VALARM",
  "END:VEVENT",
];

/** One `<response>` as iCloud writes it: default DAV namespace, CDATA, a 404 propstat beside the 200. */
const response = (href: string, data: string) =>
  `<response><href>${href}</href><propstat><prop><calendar-data xmlns="urn:ietf:params:xml:ns:caldav"><![CDATA[${data}]]></calendar-data></prop><status>HTTP/1.1 200 OK</status></propstat><propstat><prop><getetag/></prop><status>HTTP/1.1 404 Not Found</status></propstat></response>`;

const multistatus = (...responses: string[]) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<multistatus xmlns="DAV:">\n  ${responses.join("\n  ")}\n</multistatus>`;

const EMPTY = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<multistatus xmlns="DAV:">\n          </multistatus>`;

const NESTED_LOOKING_DESCRIPTION =
  "DESCRIPTION:" +
  Array.from({ length: 40 }, (_, i) => `<mailto:person${i}@example.com>`).join(" ") +
  " <!DOCTYPE html><html><body><p>synthetic</p></body></html>";

const fetchFor =
  (byCollection: Record<string, () => Response>): FetchLike =>
  async (url) => {
    const name = new URL(url).pathname.split("/").filter(Boolean).pop() ?? "";
    return byCollection[name]();
  };

const col = (name: string) => ({
  href: `https://p42-caldav.icloud.com/1/calendars/${name}/`,
  name,
});

describe("iCloud CalDAV answers", () => {
  it("reads an empty collection as no events, not a parse failure (the rc.47 CALENDAR_PARSE)", async () => {
    const fetchImpl = fetchFor({ empty: () => new Response(EMPTY, { status: 207 }) });
    await expect(
      queryCollection(CREDS, col("empty").href, NOV, POLICY, fetchImpl)
    ).resolves.toEqual([]);
  });

  it("does not count `<…>` or a DOCTYPE inside CDATA as markup", async () => {
    const data = ics(
      ...event("a", "20261110T090000", [
        NESTED_LOOKING_DESCRIPTION,
        "RRULE:FREQ=WEEKLY;COUNT=4",
        "EXDATE;TZID=Europe/Berlin:20261117T090000",
      ])
    );
    const xml = multistatus(response("/1/calendars/home/a.ics", data));
    expect(() => assertXmlBounded(xml)).not.toThrow();
    const texts = await queryCollection(
      CREDS,
      col("home").href,
      NOV,
      POLICY,
      fetchFor({ home: () => new Response(xml, { status: 207 }) })
    );
    expect(texts).toHaveLength(1);
    const parsed = parseIcsTexts(texts, { ...NOV, profileZone: ZONE });
    // Weekly ×4 from 10 Nov: the 17th is excluded and 1 Dec lies past the window.
    expect(parsed.events.map((e) => new Date(e.startMs).toISOString().slice(0, 10))).toEqual([
      "2026-11-10",
      "2026-11-24",
    ]);
  });

  it("still refuses a DOCTYPE in the answer's own markup", () => {
    expect(() => assertXmlBounded(`<!DOCTYPE x [<!ENTITY a "b">]><multistatus/>`)).toThrow(
      /CALENDAR_PARSE/
    );
  });

  it("skips and counts one broken event instead of failing the calendar", () => {
    const good = ics(...event("good", "20261110T090000"));
    const broken = "BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nthis is not a content line\r\n";
    const parsed = parseIcsTexts([good, broken], { ...NOV, profileZone: ZONE });
    expect(parsed.events).toHaveLength(1);
    expect(parsed.skippedEvents).toBe(1);
    expect(parsed.skippedReasons).toEqual({ CALENDAR_PARSE: 1 });
  });

  it("still fails a feed in which nothing parses", () => {
    expect(() => parseIcsTexts(["not a calendar"], { ...NOV, profileZone: ZONE })).toThrow(
      /CALENDAR_PARSE/
    );
  });

  it("skips a collection whose answer does not parse and names it, keeping the others", async () => {
    const fetchImpl = fetchFor({
      home: () =>
        new Response(
          multistatus(response("/1/calendars/home/a.ics", ics(...event("a", "20261110T090000")))),
          { status: 207 }
        ),
      empty: () => new Response(EMPTY, { status: 207 }),
      broken: () => new Response("<html>not dav</html>", { status: 207 }),
    });
    const parsed = await readCaldav(
      CREDS,
      [col("home"), col("empty"), col("broken")],
      NOV,
      ZONE,
      POLICY,
      { fetch: fetchImpl }
    );
    expect(parsed.events).toHaveLength(1);
    expect(parsed.failedCollections).toEqual([
      { name: "broken", href: col("broken").href, code: "CALENDAR_PARSE" },
    ]);
  });

  it("fails the source when every collection fails", async () => {
    const fetchImpl = fetchFor({ broken: () => new Response("<html/>", { status: 207 }) });
    await expect(
      readCaldav(CREDS, [col("broken")], NOV, ZONE, POLICY, { fetch: fetchImpl })
    ).rejects.toMatchObject({ code: "CALENDAR_PARSE" });
  });

  it("still fails the whole source on a rejected login", async () => {
    const fetchImpl = fetchFor({
      home: () => new Response(EMPTY, { status: 207 }),
      other: () => new Response("", { status: 401 }),
    });
    await expect(
      readCaldav(CREDS, [col("home"), col("other")], NOV, ZONE, POLICY, { fetch: fetchImpl })
    ).rejects.toMatchObject({ kind: "auth" });
  });
});
