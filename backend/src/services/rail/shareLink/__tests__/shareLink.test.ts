import { parseShareLink } from "../shareLinkUrl";
import { bookingFromConnection, fetchDbConnection, MAX_BODY_BYTES } from "../dbConnection";
import { resolveShareLink } from "..";

jest.mock("../../parser/railCandidates", () => ({
  toRailCandidate: jest.fn(async (booking: { legs: unknown[] }) => ({ ...booking })),
}));

/** Invented ids and stations throughout — no real link or booking. */
const VBID = "0f0e0d0c-0b0a-4908-8706-050403020100";
const SHARE = `https://www.bahn.de/buchung/start?vbid=${VBID}`;
const SEARCH =
  "https://int.bahn.de/en/buchung/fahrplan/suche#sts=true&so=M%C3%BCnchen%20Hbf&zo=Berlin%20Hbf&kl=2&hd=2026-10-15T08:00:00";

const connection = {
  verbindungsAbschnitte: [
    {
      abfahrtsOrt: "München Hbf",
      ankunftsOrt: "Nürnberg Hbf",
      abfahrtsZeitpunkt: "2026-10-15T08:00:00",
      ankunftsZeitpunkt: "2026-10-15T09:05:00",
      verkehrsmittel: { name: "ICE 578", typ: "HOCHGESCHWINDIGKEITSZUEGE" },
    },
    {
      abfahrtsOrt: "Nürnberg Hbf",
      ankunftsOrt: "Nürnberg Hbf",
      abfahrtsZeitpunkt: "2026-10-15T09:05:00",
      verkehrsmittel: { typ: "WALK" },
    },
    {
      abfahrtsOrt: "Nürnberg Hbf",
      ankunftsOrt: "Berlin Hbf",
      abfahrtsZeitpunkt: "2026-10-15T09:20:00",
      ankunftsZeitpunkt: "2026-10-15T12:30:00",
      verkehrsmittel: { kurzText: "ICE", nummer: "1001" },
    },
  ],
};

function response(status: number, body: string, headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

describe("parseShareLink", () => {
  it("tells a share link, a search link, a foreign link and no link apart", () => {
    expect(parseShareLink(SHARE)).toMatchObject({ kind: "dbShare", vbid: VBID });
    expect(parseShareLink(SEARCH)).toEqual({
      kind: "dbSearch",
      facts: {
        departureStationName: "München Hbf",
        arrivalStationName: "Berlin Hbf",
        departureLocal: "2026-10-15T08:00",
        travelClass: "second",
      },
    });
    expect(parseShareLink("https://www.sncf-connect.com/x?vbid=" + VBID)).toEqual({
      kind: "unsupported",
      host: "www.sncf-connect.com",
    });
    expect(parseShareLink("not a link")).toEqual({ kind: "invalid" });
    expect(parseShareLink("https://www.bahn.de/buchung/start?vbid=12")).toEqual({
      kind: "invalid",
    });
  });
});

describe("bookingFromConnection", () => {
  it("keeps a stated category beside a train named by number alone, and guesses none", () => {
    const leg = (verkehrsmittel: Record<string, string>) => ({
      verbindungsAbschnitte: [
        {
          abfahrtsOrt: "Augsburg Hbf",
          ankunftsOrt: "München Hbf",
          abfahrtsZeitpunkt: "2026-10-15T08:08:00",
          ankunftsZeitpunkt: "2026-10-15T08:54:00",
          verkehrsmittel,
        },
      ],
    });
    const train = (v: Record<string, string>) => {
      const l = bookingFromConnection(leg(v), null)?.legs[0];
      return [l?.trainCategory, l?.trainNumber];
    };
    expect(train({ name: "57031", kurzText: "RB" })).toEqual(["RB", "57031"]);
    expect(train({ name: "57031" })).toEqual([null, "57031"]);
    expect(train({ name: "57031", kurzText: "57031" })).toEqual([null, "57031"]);
  });

  // Tester feedback 2026-11-08: a regional train was named "Zug 54876" instead of "RE 9".
  describe("the line bahn.de prints in mittelText", () => {
    const first = (verkehrsmittel: Record<string, string>) => {
      const l = bookingFromConnection(
        {
          verbindungsAbschnitte: [
            {
              abfahrtsOrt: "Augsburg Hbf",
              ankunftsOrt: "München Hbf",
              abfahrtsZeitpunkt: "2026-10-15T08:08:00",
              ankunftsZeitpunkt: "2026-10-15T08:54:00",
              verkehrsmittel,
            },
          ],
        },
        null
      )?.legs[0];
      return [l?.trainCategory, l?.trainNumber, l?.operationalTrainNumber];
    };

    it("names a regional train by its line and keeps the train number beside it (RE, RB)", () => {
      expect(first({ name: "54876", kurzText: "RE", mittelText: "RE 9" })).toEqual([
        "RE",
        "9",
        "54876",
      ]);
      expect(first({ name: "57031", mittelText: "RB37" })).toEqual(["RB", "37", "57031"]);
    });

    it("leaves an ICE with its own number, with or without mittelText", () => {
      expect(first({ name: "ICE 578", typ: "HOCHGESCHWINDIGKEITSZUEGE" })).toEqual([
        "ICE",
        "578",
        "578",
      ]);
      expect(first({ name: "2374", mittelText: "ICE 2374" })).toEqual(["ICE", "2374", "2374"]);
    });

    it("leaves an S-Bahn named as before", () => {
      expect(first({ name: "S 1", kurzText: "S", mittelText: "S 1" })).toEqual(["S", "1", "1"]);
    });

    it("falls back to the number alone for an answer without mittelText (old bookmarklet)", () => {
      expect(first({ name: "54876" })).toEqual([null, "54876", "54876"]);
    });
  });

  it("keeps the trains, drops the walk, and invents no reference or price", () => {
    const b = bookingFromConnection(connection, "first");
    expect(b).toMatchObject({
      bookingReference: null,
      price: null,
      travelClass: "first",
      source: "db-share-link",
    });
    expect(b?.legs).toEqual([
      expect.objectContaining({
        depStationName: "München Hbf",
        departureLocal: "2026-10-15T08:00",
        arrivalLocal: "2026-10-15T09:05",
        trainCategory: "ICE",
        trainNumber: "578",
      }),
      expect.objectContaining({ arrStationName: "Berlin Hbf", trainNumber: "1001" }),
    ]);
  });
});

describe("fetchDbConnection — every failure as itself", () => {
  const spy = jest.spyOn(global, "fetch");
  afterEach(() => spy.mockReset());
  afterAll(() => spy.mockRestore());

  it.each([
    [403, '{"status":"ERROR","code":"OPS_BLOCKED"}', "blocked"],
    [404, "", "expired"],
    [410, "", "expired"],
    [429, "", "rateLimited"],
    [502, "bad gateway", "providerError"],
  ])("answers HTTP %s (body %j) as %s", async (status, body, reason) => {
    spy.mockResolvedValueOnce(response(status, body));
    expect(await fetchDbConnection(VBID)).toEqual({ ok: false, reason });
  });

  it("names a timeout a timeout and a dead network unreachable", async () => {
    const timeout = Object.assign(new Error("aborted"), { name: "TimeoutError" });
    spy.mockRejectedValueOnce(timeout);
    expect(await fetchDbConnection(VBID)).toEqual({ ok: false, reason: "timeout" });
    spy.mockRejectedValueOnce(new TypeError("fetch failed"));
    expect(await fetchDbConnection(VBID)).toEqual({ ok: false, reason: "unreachable" });
  });

  it("refuses a body that is not a connection, or too large to be one", async () => {
    spy.mockResolvedValueOnce(response(200, "<html>shell</html>"));
    expect(await fetchDbConnection(VBID)).toEqual({ ok: false, reason: "unreadable" });
    spy.mockResolvedValueOnce(response(200, JSON.stringify({ verbindung: {} })));
    expect(await fetchDbConnection(VBID)).toEqual({ ok: false, reason: "unreadable" });
    spy.mockResolvedValueOnce(
      response(200, "{}", { "content-length": String(MAX_BODY_BYTES + 1) })
    );
    expect(await fetchDbConnection(VBID)).toEqual({ ok: false, reason: "unreadable" });
  });

  it("reads a connection, bounded by a timeout signal and without following redirects", async () => {
    spy.mockResolvedValueOnce(response(200, JSON.stringify({ verbindung: connection })));
    const result = await fetchDbConnection(VBID);
    expect(result.ok).toBe(true);
    const [url, init] = spy.mock.calls[0];
    expect(String(url)).toBe(`https://www.bahn.de/web/api/angebote/verbindung/${VBID}`);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    expect(init?.redirect).toBe("error");
  });
});

describe("resolveShareLink", () => {
  it("hands the link's own facts on when the fetch is blocked", async () => {
    const link = `${SHARE}#so=K%C3%B6ln%20Hbf&kl=1`;
    const outcome = await resolveShareLink(link, "u1", {
      fetchConnection: async () => ({ ok: false, reason: "blocked" }),
    });
    expect(outcome).toEqual({
      outcome: "failed",
      reason: "blocked",
      facts: {
        departureStationName: "Köln Hbf",
        arrivalStationName: null,
        departureLocal: null,
        travelClass: "first",
      },
    });
  });

  it("never fetches for a search link, and says it carries no ride", async () => {
    const fetchConnection = jest.fn();
    const outcome = await resolveShareLink(SEARCH, "u1", { fetchConnection });
    expect(fetchConnection).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ outcome: "failed", reason: "noConnectionInLink" });
  });

  it("reports a connection of walks only as noTrain", async () => {
    const outcome = await resolveShareLink(SHARE, "u1", {
      fetchConnection: async () => ({
        ok: true,
        connection: { verbindungsAbschnitte: [connection.verbindungsAbschnitte[1]] },
        travelClass: null,
      }),
    });
    expect(outcome).toMatchObject({ outcome: "failed", reason: "noTrain" });
  });

  it("returns a read connection as a booking for the rail review", async () => {
    const outcome = await resolveShareLink(SHARE, "u1", {
      fetchConnection: async () => ({ ok: true, connection, travelClass: null }),
    });
    expect(outcome.outcome).toBe("read");
    if (outcome.outcome === "read") expect(outcome.booking.legs).toHaveLength(2);
  });
});
