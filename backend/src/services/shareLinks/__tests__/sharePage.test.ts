import vm from "node:vm";

import { describe, expect, it } from "@jest/globals";
import request from "supertest";

import { shareLinkApp } from "../../../routes/__tests__/shareLinkFixtures";
import { SHARE_PAGE_CSP } from "../../../routes/sharePage";
import {
  SHARE_PAGE_CSS,
  SHARE_PAGE_FORMAT_JS,
  SHARE_PAGE_HTML,
  SHARE_PAGE_JS,
} from "../sharePageAssets";
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
    // The only outside address is the abrechen2 credit — a link, never a fetched resource.
    const outside = [...SHARE_PAGE_HTML.matchAll(/https?:\/\/[^"\s]+/g)].map((m) => m[0]);
    expect(outside).toEqual(["https://www.abrechen2.de/"]);
    expect(SHARE_PAGE_HTML).toMatch(/<a id="credit"[^>]*href="https:\/\/www\.abrechen2\.de\/"/);
    expect(SHARE_PAGE_HTML).not.toMatch(/\s(src|srcset)="https?:/);
    expect(SHARE_PAGE_HTML).not.toMatch(/<style|\sstyle=/); // the CSP allows no inline style
    expect(SHARE_PAGE_HTML).not.toMatch(/\son\w+=/i); // no inline handlers
  });

  it("carries the abrechen2 credit as outlined paths, never typeset (brand rule)", () => {
    expect(SHARE_PAGE_HTML).toContain("Ein Projekt von");
    const mark = SHARE_PAGE_HTML.match(
      /<svg class="a2-mark"[^>]*aria-label="abrechen2"[\s\S]*?<\/svg>/
    );
    expect(mark).not.toBeNull();
    expect((mark![0].match(/<path /g) ?? []).length).toBe(3);
    expect(mark![0]).not.toMatch(/<text/);
    expect(SHARE_PAGE_JS).toContain("https://www.abrechen2.de/en/");
  });

  it("lays the itinerary out for A4 when printed, and offers it as a PDF", () => {
    expect(SHARE_PAGE_CSS).toMatch(/@page\{size:A4/);
    expect(SHARE_PAGE_CSS).toMatch(/@media print\{[\s\S]*\.actions[^{]*\{display:none\}/);
    expect(SHARE_PAGE_JS).toContain("window.print()");
  });

  it("is drawn in the app's design: its tokens, its fonts, its logo, domain colours on the markers", async () => {
    // No palette of its own: the only hex values are the abrechen2 mark's two accents.
    const hexes = [...SHARE_PAGE_CSS.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((m) => m[0]);
    expect([...new Set(hexes)].sort()).toEqual(["#C2410C", "#FF7A1A"]);
    expect(SHARE_PAGE_CSS).not.toMatch(/rgba?\(/);
    for (const domain of ["flight", "hotel", "rail", "bus", "ferry", "rental", "cruise"]) {
      expect(SHARE_PAGE_CSS).toContain(`var(--ts-domain-${domain})`);
    }
    // Print and the PDF are the same tokens on the token set's paper.
    expect(SHARE_PAGE_CSS).toMatch(/@media print\{\s*:root\{[^}]*--ts-bg:var\(--ts-paper\)/);
    expect(SHARE_PAGE_HTML.indexOf("/share/theme.css")).toBeLessThan(
      SHARE_PAGE_HTML.indexOf("/share/share.css")
    );
    expect(SHARE_PAGE_HTML).toMatch(/class="ts-logo"[\s\S]*TRAV[\s\S]*STATS/);
    expect(SHARE_PAGE_JS).toContain('"entry k-" + e.kind');

    const theme = await request(shareLinkApp()).get("/share/theme.css").expect(200);
    expect(theme.headers["content-type"]).toMatch(/text\/css/);
    expect(theme.headers["content-security-policy"]).toBe(SHARE_PAGE_CSP);
    expect(theme.text).toContain("--ts-domain-flight:");
    expect(theme.text).toContain("--ts-paper:");
    expect(theme.text).toContain('font-family: "Hanken Grotesk"');
    expect(theme.text).not.toMatch(/@theme|@utility|fonts\.googleapis/);
    expect(SHARE_PAGE_CSP).toContain("font-src 'self'");
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

  it("cuts a month- or year-precision value to what is known — no invented day", () => {
    const de = formatIn("de-DE");
    const en = formatIn("en-GB");
    expect(en.clock({ local: "2030-06-01T00:00:00", precision: "month" })).toBe("June 2030");
    expect(de.clock({ local: "2030-06-01T00:00:00", precision: "month" })).toBe("Juni 2030");
    expect(en.clock({ local: "2030-01-01T00:00:00", precision: "year" })).toBe("2030");
  });

  it("is what the page script uses — no ISO date reaches the visitor", () => {
    expect(SHARE_PAGE_JS).toContain(SHARE_PAGE_FORMAT_JS);
    expect(SHARE_PAGE_JS).not.toMatch(/toLocaleString\(de/);
    expect(SHARE_PAGE_JS).toContain("fmt.day(t.dates.start.date)");
  });
});

/**
 * The itinerary on the public page (forgejo#302, day-by-day since 2026-11-22):
 * each time on its place's clock with that zone beside it, entries that span
 * days split onto the days family looks at, and the current entry named in
 * words — not by colour alone.
 */
describe("share page itinerary", () => {
  type Entry = {
    kind: string;
    label: string;
    time: string | null;
    zone: string | null;
    title: string;
    lines: string[];
    now: string | null;
  };
  type Day = {
    key: string;
    heading: { num: string; text: string } | null;
    nights: string[];
    entries: Entry[];
  };
  type Plan = { days: Day[]; now: { label: string; title: string; time: string | null } | null };
  const T = SHARE_PAGE_ITINERARY_COPY.en;
  const planOf = (itinerary: unknown, tz = "Pacific/Kiritimati", locale = "en-GB"): Plan => {
    const context: { result?: Plan } = {};
    const previous = process.env.TZ;
    process.env.TZ = tz;
    try {
      vm.runInNewContext(
        `${SHARE_PAGE_FORMAT_JS}; ${SHARE_PAGE_ITINERARY_JS}; result = planDays(` +
          `${JSON.stringify(itinerary)}, shareFormat(${JSON.stringify(locale)}), ${JSON.stringify(T)});`,
        context
      );
    } finally {
      process.env.TZ = previous;
    }
    return JSON.parse(JSON.stringify(context.result!));
  };
  const tv = (
    local: string,
    zone: string | null,
    offset: string,
    utc: string,
    precision = "minute"
  ) => ({
    utc,
    zone,
    offset,
    local,
    precision,
    zoneSource: zone ? "stored" : null,
  });
  const itinerary = {
    sections: ["flights", "stays"],
    items: [
      {
        kind: "flight",
        airline: "Lufthansa",
        flightNumber: "LH400",
        from: { code: "FRA", name: "Frankfurt" },
        to: { code: "JFK", name: "New York JFK" },
        departure: tv("2030-06-01T14:00:00", "Europe/Berlin", "+02:00", "2030-06-01T12:00:00.000Z"),
        arrival: tv(
          "2030-06-01T16:00:00",
          "America/New_York",
          "-04:00",
          "2030-06-01T20:00:00.000Z"
        ),
        terminal: "1",
        gate: "B12",
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
      const plan = planOf(itinerary, zone);
      const [first] = plan.days;
      expect(first.key).toBe("2030-06-01");
      expect(first.heading!.text).toMatch(/^Saturday,? 1 June 2030$/);
      const [flight, checkIn] = first.entries;
      expect(flight.time).toBe("14:00");
      expect(flight.zone).toMatch(/^(CEST|GMT\+2)$/);
      expect(flight.title).toBe("Lufthansa LH400");
      expect(flight.lines).toContain("Frankfurt (FRA) → New York JFK (JFK)");
      expect(flight.lines.join("\n")).toMatch(/Arrival 16:00 (EDT|GMT-4)/);
      expect(flight.lines).toContain("Terminal 1, Gate B12");
      expect(flight.lines).toContain("In the air");
      expect(checkIn.label).toBe("Check-in");
      expect(checkIn.lines).toEqual([
        "356 W 58th St, New York, US",
        "until 4 June 2030 (3 nights)",
      ]);
    }
  });

  it("puts a stay's nights and its check-out on their own days", () => {
    const plan = planOf(itinerary);
    expect(plan.days.map((d) => d.key)).toEqual([
      "2030-06-01",
      "2030-06-02",
      "2030-06-03",
      "2030-06-04",
    ]);
    expect(plan.days.slice(0, 3).map((d) => d.nights)).toEqual([
      ["Hotel Hudson View"],
      ["Hotel Hudson View"],
      ["Hotel Hudson View"],
    ]);
    expect(plan.days[3].nights).toEqual([]);
    expect(plan.days[3].entries.map((e) => e.label)).toEqual(["Check-out"]);
  });

  it("writes a stay known only to the month or the year without a day, under no date", () => {
    const stay = itinerary.items[1];
    const plan = planOf({
      sections: ["stays"],
      items: [
        {
          ...stay,
          checkIn: { date: "2030-06-01", zone: null, precision: "month" },
          checkOut: { date: "2030-06-01", zone: null, precision: "month" },
        },
      ],
      now: null,
    });
    expect(plan.days).toHaveLength(1);
    expect(plan.days[0].heading).toBeNull();
    expect(plan.days[0].entries[0].lines.slice(1)).toEqual([
      "Check-in June 2030",
      "Check-out June 2030",
    ]);
  });

  it("keeps a same-day stay's check-out time, and a visit known only to its month", () => {
    const stay = itinerary.items[1];
    const plan = planOf({
      sections: ["stays", "places"],
      items: [
        {
          ...stay,
          checkOut: { date: "2030-06-01", zone: "America/New_York", precision: "day" },
          checkOutAt: tv(
            "2030-06-01T23:00:00",
            "America/New_York",
            "-04:00",
            "2030-06-02T03:00:00.000Z"
          ),
        },
        {
          kind: "visit",
          name: "Statue of Liberty",
          city: "New York",
          at: tv(
            "2030-06-01T00:00:00",
            "America/New_York",
            "-04:00",
            "2030-06-01T04:00:00.000Z",
            "month"
          ),
        },
      ],
      now: null,
    });
    const [dated, undated] = plan.days;
    expect(dated.entries[0].lines.join("\n")).toMatch(/Check-out 23:00 (EDT|GMT-4)/);
    expect(dated.nights).toEqual([]);
    expect(undated.heading).toBeNull();
    expect(undated.entries[0].lines).toContain("June 2030");
  });

  it("names the current entry in words, and only that one", () => {
    const plan = planOf(itinerary);
    const all = plan.days.flatMap((d) => d.entries);
    expect(all.map((e) => e.now)).toEqual(["Now", null, null]);
    expect(plan.now).toMatchObject({ label: "Now", title: "Lufthansa LH400", time: "14:00" });
    const next = planOf({ ...itinerary, now: { index: 1, state: "next" } });
    expect(next.days.flatMap((d) => d.entries).map((e) => e.now)).toEqual([null, "Next", null]);
    expect(planOf({ ...itinerary, now: null }).now).toBeNull();
  });

  it("is what the page script renders, through textContent only", () => {
    expect(SHARE_PAGE_JS).toContain(SHARE_PAGE_ITINERARY_JS);
    expect(SHARE_PAGE_JS).toContain("renderItinerary(t.itinerary)");
    expect(SHARE_PAGE_ITINERARY_JS).not.toMatch(/innerHTML|outerHTML|insertAdjacentHTML/);
  });
});

/**
 * Run the real script against a minimal DOM and read back the text it wrote —
 * a renderer that threw, or wrote a key the view does not carry, would show a
 * blank page.
 */
class FakeNode {
  children: FakeNode[] = [];
  textContent = "";
  className = "";
  attributes: Record<string, string> = {};
  listeners: Record<string, () => void> = {};
  get firstChild(): FakeNode | undefined {
    return this.children[0];
  }
  appendChild(child: FakeNode): FakeNode {
    this.children.push(child);
    return child;
  }
  removeChild(child: FakeNode): void {
    this.children = this.children.filter((c) => c !== child);
  }
  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }
  addEventListener(type: string, fn: () => void): void {
    this.listeners[type] = fn;
  }
  text(): string {
    return [this.textContent, ...this.children.map((c) => c.text())].filter(Boolean).join("\n");
  }
  find(cls: string): FakeNode | undefined {
    if (this.className.split(" ").includes(cls)) return this;
    for (const c of this.children) {
      const hit = c.find(cls);
      if (hit) return hit;
    }
    return undefined;
  }
}

async function renderPage(
  answer: { status: number; body?: unknown },
  language = "de-DE"
): Promise<{ root: FakeNode; document: { title: string }; printed: string[] }> {
  const root = new FakeNode();
  const printed: string[] = [];
  const document = {
    title: "TravStats",
    documentElement: {},
    getElementById: () => root,
    createElement: () => new FakeNode(),
  };
  const context = {
    navigator: { language, languages: [language] },
    document,
    window: { print: () => printed.push(document.title) },
    location: { hash: "#token" },
    fetch: () =>
      Promise.resolve({
        status: answer.status,
        ok: answer.status === 200,
        json: () => Promise.resolve(answer.body),
      }),
    setInterval: () => 1,
    clearInterval: () => {},
    setTimeout: () => 1,
    URL,
    Intl,
    decodeURIComponent,
  };
  new vm.Script(SHARE_PAGE_JS).runInNewContext(context);
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { root, document, printed };
}

const day = (date: string) => ({ date, zone: null, precision: "day" });

describe("share page rendering", () => {
  const trip = {
    kind: "trip",
    trip: {
      owner: "Anna",
      name: "New York 2030",
      dates: { start: day("2030-06-01"), end: day("2030-06-08") },
      totals: {
        flights: 1,
        flightKm: 6189,
        cruises: 0,
        railRides: 0,
        busRides: 0,
        ferryCrossings: 0,
        rentals: 0,
        countries: 2,
        days: 8,
      },
      itinerary: {
        sections: ["stays"],
        items: [
          {
            kind: "stay",
            name: "Hotel Hudson View",
            address: "356 W 58th St",
            city: "New York",
            country: "US",
            checkIn: day("2030-06-01"),
            checkOut: day("2030-06-04"),
            checkInAt: null,
            checkOutAt: null,
          },
        ],
        now: { index: 0, state: "next" },
      },
    },
  };
  const live = {
    status: 200,
    body: { data: { expiresAt: "2030-06-15T10:00:00.000Z", view: trip } },
  };

  it("writes the trip's title, dates, owner and day plan in German", async () => {
    const { root, document } = await renderPage(live);
    const text = root.text();
    expect(text).toContain("New York 2030");
    expect(text).toContain("1. Juni 2030 – 8. Juni 2030");
    expect(text).toContain("Geteilt von Anna");
    expect(text).toContain("Als Nächstes");
    expect(text).toContain("Übernachtung: Hotel Hudson View");
    expect(text).toContain("Samstag");
    expect(text).toContain("Link gültig bis");
    // One of a thing is written in the singular.
    expect(text).not.toContain("Flüge");
    expect(text).toContain("Flug");
    expect(text).toContain("8\nTage");
    expect(document.title).toBe("New York 2030 – TravStats");
  });

  it("prints the itinerary as '<Trip>-Reiseplan', and in English as '<Trip>-Itinerary'", async () => {
    const de = await renderPage(live);
    const button = de.root.find("btn")!;
    expect(button.textContent).toBe("Als PDF herunterladen");
    button.listeners.click();
    expect(de.printed).toEqual(["New York 2030-Reiseplan"]);
    const en = await renderPage(live, "en-US");
    expect(en.root.find("btn")!.textContent).toBe("Download as PDF");
    en.root.find("btn")!.listeners.click();
    expect(en.printed).toEqual(["New York 2030-Itinerary"]);
  });

  it("answers a retired link with 'no longer available', in German and English", async () => {
    const de = await renderPage({ status: 410, body: { error: "gone" } });
    expect(de.root.text()).toContain("Dieser Link ist nicht mehr verfügbar.");
    const en = await renderPage({ status: 410, body: { error: "gone" } }, "en-GB");
    expect(en.root.text()).toContain("This link is no longer available.");
  });

  it("answers an unknown link with its own sentence, not a blank page", async () => {
    const { root } = await renderPage({ status: 404, body: {} });
    expect(root.text()).toContain("Dieser Link ist nicht (mehr) gültig.");
  });
});
