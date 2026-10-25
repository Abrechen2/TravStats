import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { utcMidnight } from "../../services/countryDays/store";
import * as countryRule from "../../services/locationEvidence/countrySuggestions";
import { countrySuggestions } from "../../services/locationEvidence/countrySuggestions";
import { setLocationProvider } from "../../services/locationProvider/provider";
import { deleteTravTrackRange } from "../../services/travtrack/deleteRange";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";

jest.mock("../../utils/achievements", () => ({ recheckAchievements: jest.fn(async () => {}) }));

/**
 * `/api/v1/location-suggestions` (TravTrack plan E6, E4's protocol; review
 * focus 21): a country question is answered "visited" or "ground" by writing
 * the user's own country override — once, however often the answer is sent —
 * after re-checking that TravTrack still names the country on two ground days.
 * Evidence that no longer holds invalidates the question, committed before the
 * 409; history deleted takes the question with it (E5). Rejecting writes nothing but the answer, and works with TravTrack off.
 */

const PREFIX = "location-suggestions-route-";

describe("/api/v1/location-suggestions", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherId: string;
  let cookie: string;
  let otherCookie: string;

  const api = () => request(app);
  const accept = (id: string, verdict: string, as = cookie) =>
    api().post(`/api/v1/location-suggestions/${id}/accept`).set("Cookie", as).send({ verdict });
  const reject = (id: string, as = cookie) =>
    api().post(`/api/v1/location-suggestions/${id}/reject`).set("Cookie", as).send({});
  const day = (date: string, countryCode = "PT") =>
    prisma.countryDay.create({
      data: {
        userId,
        source: "travtrack",
        date: utcMidnight(date),
        countryCode,
        pointCount: 12,
        airportPointCount: 0,
        spanKm: 1,
      },
    });

  /** One pending question for Portugal, 12–13 October. */
  async function question(): Promise<string> {
    await day("2026-10-12");
    await day("2026-10-13");
    await countrySuggestions(userId);
    return (await prisma.locationSuggestion.findFirstOrThrow({ where: { userId } })).id;
  }
  const fresh = (id: string) => prisma.locationSuggestion.findUniqueOrThrow({ where: { id } });

  beforeAll(async () => {
    process.env.ENCRYPTION_KEY ??= "c".repeat(64);
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    userId = (await prisma.user.create({ data: { username: `${PREFIX}a`, passwordHash: "x" } })).id;
    otherId = (await prisma.user.create({ data: { username: `${PREFIX}b`, passwordHash: "x" } }))
      .id;
    cookie = `auth_token=${generateToken(userId)}`;
    otherCookie = `auth_token=${generateToken(otherId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await prisma.countryDay.deleteMany({ where: { userId } });
    await prisma.locationSuggestion.deleteMany({ where: { userId } });
    await prisma.countryOverride.deleteMany({ where: { userId } });
    await prisma.travTrackDerivationState.deleteMany({ where: { userId } });
    await prisma.travTrackPoint.deleteMany({ where: { userId } });
    await prisma.travTrackDeletedRange.deleteMany({ where: { userId } });
    // A removal in one test leaves its days to re-derive; no question reads them.
    await prisma.travTrackDirtyDay.deleteMany({ where: { userId } });
    await setLocationProvider(userId, "travtrack");
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("lists pending questions as envelopes, without evidence key or digests", async () => {
    const id = await question();

    const res = await api()
      .get("/api/v1/location-suggestions?status=pending")
      .set("Cookie", cookie);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toEqual([
      {
        id,
        kind: "country",
        provider: { kind: "travtrack", rev: expect.any(Number) },
        window: {
          fromMs: utcMidnight("2026-10-12").getTime(),
          untilMs: utcMidnight("2026-10-14").getTime(),
        },
        algorithm: { name: "country", version: 1 },
        explanation: { code: "country.groundDays", params: { country: "PT", days: 2, points: 24 } },
        status: "pending",
        coverage: "complete",
      },
    ]);
    expect(JSON.stringify(res.body)).not.toMatch(/evidenceKey|evidence_key|pointDigests/);

    const other = await api().get("/api/v1/location-suggestions").set("Cookie", otherCookie);
    expect(other.body.data).toEqual([]);
  });

  it("refuses an unknown status filter", async () => {
    const res = await api()
      .get("/api/v1/location-suggestions?status=covered")
      .set("Cookie", cookie);
    expect(res.status).toBe(400);
  });

  it("accept writes the override once, twice answers the same", async () => {
    const id = await question();

    const first = await accept(id, "visited");
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ id, status: "accepted" });

    const override = await prisma.countryOverride.findUniqueOrThrow({
      where: { userId_countryCode: { userId, countryCode: "PT" } },
    });
    expect(override).toMatchObject({
      verdict: "visited",
      note: "",
      day: utcMidnight("2026-10-12"),
    });
    expect(await fresh(id)).toMatchObject({
      status: "accepted",
      acceptedEntryKind: "countryOverride",
      acceptedEntryId: override.id,
      claimToken: null,
    });

    const second = await accept(id, "ground");
    expect(second.status).toBe(200);
    expect(second.body.data).toMatchObject({ id, status: "accepted" });
    expect(await prisma.countryOverride.count({ where: { userId } })).toBe(1);
    // A replay answers the first decision; it never rewrites it.
    expect((await prisma.countryOverride.findFirstOrThrow({ where: { userId } })).verdict).toBe(
      "visited"
    );
  });

  it("an override the user set meanwhile resolves the question naming it, unchanged", async () => {
    const id = await question();
    const mine = await prisma.countryOverride.create({
      data: { userId, countryCode: "PT", verdict: "ground", note: "only the airport bus" },
    });

    const res = await accept(id, "visited");

    expect(res.status).toBe(200);
    expect(await fresh(id)).toMatchObject({ status: "accepted", acceptedEntryId: mine.id });
    expect(
      await prisma.countryOverride.findUniqueOrThrow({ where: { id: mine.id } })
    ).toMatchObject({ verdict: "ground", note: "only the airport bus" });
  });

  it("two concurrent accepts write one override", async () => {
    const id = await question();

    const answers = await Promise.all([accept(id, "visited"), accept(id, "visited")]);

    for (const res of answers) {
      if (res.status !== 200) {
        expect(res.status).toBe(409);
        expect(res.body.code).toBe("SUGGESTION_ACCEPT_IN_PROGRESS");
      }
    }
    expect(answers.some((res) => res.status === 200)).toBe(true);
    expect(await prisma.countryOverride.count({ where: { userId } })).toBe(1);
    // The client's retry gets the replay.
    expect((await accept(id, "visited")).status).toBe(200);
  });

  it("a fresh claim answers SUGGESTION_ACCEPT_IN_PROGRESS; one left by a crash is taken over after two minutes", async () => {
    const id = await question();
    await prisma.locationSuggestion.update({
      where: { id },
      data: { status: "accepting", claimToken: "crashed", claimedAt: new Date() },
    });

    const busy = await accept(id, "visited");
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe("SUGGESTION_ACCEPT_IN_PROGRESS");

    await prisma.locationSuggestion.update({
      where: { id },
      data: { claimedAt: new Date(Date.now() - 3 * 60_000) },
    });
    const taken = await accept(id, "visited");
    expect(taken.status).toBe(200);
    expect(await prisma.countryOverride.count({ where: { userId } })).toBe(1);
  });

  it("accept after the days were re-derived without the country → 409 EVIDENCE_INVALIDATED, committed", async () => {
    const id = await question();
    // The projection no longer names Portugal on the 12th.
    await prisma.countryDay.deleteMany({
      where: { userId, date: utcMidnight("2026-10-12") },
    });

    const res = await accept(id, "visited");

    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVIDENCE_INVALIDATED");
    // Read afresh: the invalidation was committed before the answer left.
    expect(await fresh(id)).toMatchObject({ status: "invalidated", claimToken: null });
    expect(await prisma.countryOverride.count({ where: { userId } })).toBe(0);
    // And it is not asked again as if nothing happened.
    expect((await accept(id, "visited")).body.code).toBe("SUGGESTION_ALREADY_RESOLVED");
  });

  it("deleting the days' points takes the question with it (E5): accepting is 404, nothing written", async () => {
    const id = await question();
    await prisma.travTrackPoint.create({
      data: {
        userId,
        t: new Date("2026-10-12T09:00:00Z"),
        tS: Math.floor(Date.parse("2026-10-12T09:00:00Z") / 1000),
        lat: 38.72,
        lon: -9.14,
        origin: "companion:phone-1",
        originRef: "pt-1",
        deviceId: "phone-1",
      },
    });
    await deleteTravTrackRange(
      userId,
      new Date("2026-10-12T00:00:00Z"),
      new Date("2026-10-13T00:00:00Z")
    );

    expect(await prisma.locationSuggestion.findUnique({ where: { id } })).toBeNull();
    const res = await accept(id, "visited");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("SUGGESTION_NOT_FOUND");
    expect(await prisma.countryOverride.count({ where: { userId } })).toBe(0);
  });

  it("TravTrack off → 403 TRAVTRACK_DISABLED, the question stays pending, reject still works", async () => {
    const id = await question();
    await switches.set({ beta: true, config: false });

    const res = await accept(id, "visited");
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
    expect((await fresh(id)).status).toBe("pending");

    const no = await reject(id);
    expect(no.status).toBe(200);
    expect((await fresh(id)).status).toBe("rejected");
    expect(await prisma.countryOverride.count({ where: { userId } })).toBe(0);
  });

  it("an account no longer on TravTrack → 409 TRAVTRACK_UNAVAILABLE, the question stays, reject still works", async () => {
    const id = await question();
    await setLocationProvider(userId, "none");

    const res = await accept(id, "visited");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TRAVTRACK_UNAVAILABLE");
    expect((await fresh(id)).status).toBe("pending");
    expect(await prisma.countryOverride.count({ where: { userId } })).toBe(0);

    expect((await reject(id)).status).toBe(200);
  });

  it("TravTrack switched off during the re-check writes no override and leaves the question", async () => {
    const id = await question();
    const spy = jest.spyOn(countryRule, "countryRunHolds").mockImplementation(async () => {
      await switches.set({ beta: true, config: false });
      return "holds" as const;
    });
    try {
      const res = await accept(id, "visited");
      expect(res.status).toBe(403);
      expect(res.body.code).toBe("TRAVTRACK_DISABLED");
    } finally {
      spy.mockRestore();
    }
    expect(await prisma.countryOverride.count({ where: { userId } })).toBe(0);
    expect(await fresh(id)).toMatchObject({ status: "pending", claimToken: null });
  });

  it("reject is final: accepting afterwards is SUGGESTION_ALREADY_RESOLVED; rejecting again is fine", async () => {
    const id = await question();
    expect((await reject(id)).status).toBe(200);

    const res = await accept(id, "visited");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SUGGESTION_ALREADY_RESOLVED");
    expect((await reject(id)).status).toBe(200);
  });

  it("an accepted question cannot be rejected", async () => {
    const id = await question();
    await accept(id, "ground");

    const res = await reject(id);
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("SUGGESTION_ALREADY_RESOLVED");
  });

  it("another account's question is not found, and a verdict outside the two is refused", async () => {
    const id = await question();
    expect((await accept(id, "visited", otherCookie)).status).toBe(404);
    expect((await reject(id, otherCookie)).status).toBe(404);
    expect((await accept(id, "excluded")).status).toBe(400);
    expect((await fresh(id)).status).toBe("pending");
  });
});
