import vm from "node:vm";

import { describe, expect, it } from "@jest/globals";
import request from "supertest";

import { shareLinkApp } from "../../../routes/__tests__/shareLinkFixtures";
import { SHARE_PAGE_CSP } from "../../../routes/sharePage";
import { SHARE_PAGE_FORMAT_JS, SHARE_PAGE_HTML, SHARE_PAGE_JS } from "../sharePageAssets";
import { SHARE_PAGE_ITINERARY_COPY, SHARE_PAGE_ITINERARY_JS } from "../sharePageItinerary";

/**
 * The page a public share link opens (forgejo#281, design §2 T2/T3/T10–T12,
 * §4): a shell with no data, its own strict headers, one external script.
 */
describe("GET /share", () => {
  const app = shareLinkApp();

  it("answers the shell with no-store, noindex, no-referrer and a strict CSP", async () => {
    for (const path of ["/share", "/share/"]) {
      const res = await request(app).get(path).expect(200);
      expect(res.headers["content-type"]).toMatch(/^text\/html/);
      expect(res.headers["cache-control"]).toBe("no-store");
      expect(res.headers["x-robots-tag"]).toBe("noindex, nofollow, noarchive");
      expect(res.headers["referrer-policy"]).toBe("no-referrer");
      expect(res.headers["x-frame-options"]).toBe("DENY");
      expect(res.headers["content-security-policy"]).toBe(SHARE_PAGE_CSP);
      expect(res.text).toContain('<meta name="robots" content="noindex, nofollow, noarchive">');
    }
  });

  it("serves its script and style from its own origin", async () => {
    const js = await request(app).get("/share/share.js").expect(200);
    expect(js.headers["content-type"]).toMatch(/javascript/);
    expect(js.headers["content-security-policy"]).toBe(SHARE_PAGE_CSP);
    await request(app)
      .get("/share/share.css")
      .expect(200)
      .expect("Content-Type", /text\/css/);
  });

  it("carries no inline script, no third-party resource and no data", () => {
    const scripts = [...SHARE_PAGE_HTML.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)];
    expect(scripts).toHaveLength(1);
    expect(scripts[0][1]).toContain('src="/share/share.js"');
    expect(scripts[0][2].trim()).toBe("");
    expect(SHARE_PAGE_HTML).not.toMatch(/https?:\/\//);
    expect(SHARE_PAGE_HTML).not.toMatch(/\son\w+=/i); // no inline handlers
  });

  it("CSP allows only self and blob: images, and nothing inline", () => {
    expect(SHARE_PAGE_CSP).toContain("default-src 'none'");
    expect(SHARE_PAGE_CSP).toContain("script-src 'self'");
    expect(SHARE_PAGE_CSP).not.toContain("unsafe-inline");
    expect(SHARE_PAGE_CSP).not.toContain("unsafe-eval");
    expect(SHARE_PAGE_CSP).toContain("frame-ancestors 'none'");
  });

  it("ships a script that parses, reads the token from the fragment and never writes HTML", () => {
    expect(() => new vm.Script(SHARE_PAGE_JS)).not.toThrow();
    expect(SHARE_PAGE_JS).toContain("location.hash");
    expect(SHARE_PAGE_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML|document\.write/);
    expect(SHARE_PAGE_JS).not.toMatch(/localStorage|sessionStorage|document\.cookie/);
    // The token goes in a POST body, never into a URL.
    expect(SHARE_PAGE_JS).not.toMatch(/share-links\/[a-z]+\?|\+ ?token/);
    expect(SHARE_PAGE_JS).toContain('credentials: "omit"');
  });
});

/**
 * The page writes dates in the visitor's language — and never lets the
 * visitor's zone move a calendar day or a place's wall clock (ADR 0002).
 */
describe("share page date formatting", () => {
  type Fmt = {
    day: (ymd: string) => string;
    clock: (tv: { local: string; precision: string } | null) => string | null;
    instant: (iso: string) => string;
  };
  const formatIn = (locale: string): Fmt => {
    const context: { result?: Fmt } = {};
    vm.runInNewContext(
      `${SHARE_PAGE_FORMAT_JS}; result = shareFormat(${JSON.stringify(locale)});`,
      context
    );
    return context.result!;
  };

  it("writes a calendar day in words, in German and English", () => {
    expect(formatIn("de-DE").day("2026-09-01")).toBe("1. September 2026");
    expect(formatIn("en-GB").day("2026-09-01")).toBe("1 September 2026");
  });

  it("does not move a day or a wall clock by the visitor's zone", () => {
    // The format pins its zone; a host zone far from UTC changes nothing.
    const script = `${SHARE_PAGE_FORMAT_JS}; result = shareFormat("de-DE");`;
    for (const tz of ["Pacific/Kiritimati", "Pacific/Pago_Pago"]) {
      const context: { result?: Fmt } = {};
      const previous = process.env.TZ;
      process.env.TZ = tz;
      try {
        vm.runInNewContext(script, context);
        expect(context.result!.day("2026-01-01")).toBe("1. Januar 2026");
        const clock = context.result!.clock({ local: "2026-10-10T23:45:00", precision: "minute" })!;
        expect(clock).toContain("10. Okt. 2026");
        expect(clock).toContain("23:45");
      } finally {
        process.env.TZ = previous;
      }
    }
  });

  it("shows a day-only time as its day, and an instant on the visitor's clock", () => {
    const en = formatIn("en-GB");
    expect(en.clock({ local: "2026-10-10T00:00:00", precision: "day" })).toBe("10 October 2026");
    expect(en.clock(null)).toBeNull();
    expect(en.instant("2026-10-17T20:47:36.000Z")).toMatch(/Oct 2026/);
  });

  it("is what the page script uses — no ISO date reaches the visitor", () => {
    expect(SHARE_PAGE_JS).toContain(SHARE_PAGE_FORMAT_JS);
    expect(SHARE_PAGE_JS).not.toMatch(/toLocaleString\(de/);
    expect(SHARE_PAGE_JS).toContain("fmt.day(t.dates.start.date)");
  });
});

/**
 * The itinerary on the public page (forgejo#302): each entry's times on its
 * place's clock with that zone written beside them, and the current entry
 * named in words — not by colour alone.
 */
describe("share page itinerary", () => {
  type Entry = { title: string; lines: string[]; now: string | null };
  const T = {
    ...SHARE_PAGE_ITINERARY_COPY.en,
    dep: "Departure",
    arr: "Arrival",
    scheduled: "Scheduled",
    inFlight: "In the air",
    landed: "Landed",
    cancelled: "Cancelled",
  };
  const entriesOf = (itinerary: unknown, tz = "Pacific/Kiritimati"): Entry[] => {
    const context: { result?: Entry[] } = {};
    const previous = process.env.TZ;
    process.env.TZ = tz;
    try {
      vm.runInNewContext(
        `${SHARE_PAGE_FORMAT_JS}; ${SHARE_PAGE_ITINERARY_JS}; result = itineraryEntries(` +
          `${JSON.stringify(itinerary)}, shareFormat("en-GB"), ${JSON.stringify(T)});`,
        context
      );
    } finally {
      process.env.TZ = previous;
    }
    return context.result!;
  };
  const tv = (local: string, zone: string | null, offset: string, precision = "minute") => ({
    utc: "2030-06-01T12:00:00.000Z",
    zone,
    offset,
    local,
    precision,
    zoneSource: zone ? "stored" : null,
  });
  const itinerary = {
    items: [
      {
        kind: "flight",
        airline: "Lufthansa",
        flightNumber: "LH400",
        from: { code: "FRA", name: "Frankfurt" },
        to: { code: "JFK", name: "New York JFK" },
        departure: tv("2030-06-01T14:00:00", "Europe/Berlin", "+02:00"),
        arrival: tv("2030-06-01T16:00:00", "America/New_York", "-04:00"),
        phase: "inFlight",
      },
      {
        kind: "stay",
        name: "Hotel Hudson View",
        address: "356 W 58th St",
        city: "New York",
        country: "US",
        checkIn: { date: "2030-06-01", zone: "America/New_York", precision: "day" },
        checkOut: { date: "2030-06-04", zone: "America/New_York", precision: "day" },
        checkInAt: null,
        checkOutAt: null,
      },
    ],
    now: { index: 0, state: "inProgress" },
  };

  it("writes each time on its place's clock with the zone beside it, whatever the visitor's zone", () => {
    for (const zone of ["Pacific/Kiritimati", "America/St_Johns"]) {
      const [flight, stay] = entriesOf(itinerary, zone);
      expect(flight.title).toBe("Flight Lufthansa LH400");
      expect(flight.lines).toContain("FRA → JFK (Frankfurt → New York JFK)");
      expect(flight.lines.join("\n")).toMatch(
        /Departure 1 Jun 2030,? 14:00 \(Europe\/Berlin, UTC\+02:00\)/
      );
      expect(flight.lines.join("\n")).toMatch(
        /Arrival 1 Jun 2030,? 16:00 \(America\/New York, UTC-04:00\)/
      );
      expect(flight.lines).toContain("In the air");
      expect(stay.title).toBe("Stay Hotel Hudson View");
      expect(stay.lines).toEqual([
        "356 W 58th St, New York, US",
        "Check-in 1 June 2030",
        "Check-out 4 June 2030",
      ]);
    }
  });

  it("names the current entry in words, and only that one", () => {
    const entries = entriesOf(itinerary);
    expect(entries.map((e) => e.now)).toEqual(["Now", null]);
    const next = entriesOf({ ...itinerary, now: { index: 1, state: "next" } });
    expect(next.map((e) => e.now)).toEqual([null, "Next"]);
  });

  it("is what the page script renders, through textContent only", () => {
    expect(SHARE_PAGE_JS).toContain(SHARE_PAGE_ITINERARY_JS);
    expect(SHARE_PAGE_JS).toContain("renderItinerary(t.itinerary)");
    expect(SHARE_PAGE_ITINERARY_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });
});
