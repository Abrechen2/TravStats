import request from "supertest";

import app from "../../index";
import { prisma } from "../../db";
import { generateToken } from "../../utils/jwt";
import { travTrackSwitches } from "../../services/travtrack/__tests__/switches";
import { bumpHistoryGeneration } from "../../services/locationEvidence/generation";
import { parseJourneyEvidence } from "../../services/locationEvidence/journeys/evidence";
import { suggestJourneys } from "../../services/locationEvidence/journeys/suggest";
import {
  acceptJourneyRun,
  closeJourneyRuns,
} from "../../services/locationEvidence/journeys/accept";
import {
  H,
  NOW,
  makeJourneyUser,
  morning,
  resetJourneyUser,
  ride,
  storeJourney,
} from "../../services/locationEvidence/journeys/__tests__/journeyFixtures";

/**
 * Answering a journey question (TravTrack plan E7, through E4's protocol):
 * each run is linked to the entry the user made for it — re-checked against
 * the history as it is now, published under the TravTrack lock, idempotent.
 */

const PREFIX = "location-suggestions-journey-";
const DAY = "2026-10-20";

beforeAll(() => {
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
});

describe("journey questions", () => {
  const switches = travTrackSwitches();
  let userId: string;
  let otherId: string;
  let cookie: string;
  let id: string;

  const evidence = async () =>
    parseJourneyEvidence(
      (await prisma.locationSuggestion.findUniqueOrThrow({ where: { id } })).evidence
    )!;
  const row = () => prisma.locationSuggestion.findUniqueOrThrow({ where: { id } });
  const accept = (body: object) =>
    request(app).post(`/api/v1/location-suggestions/${id}/accept`).set("Cookie", cookie).send(body);
  const reject = (body: object = {}) =>
    request(app).post(`/api/v1/location-suggestions/${id}/reject`).set("Cookie", cookie).send(body);
  /** A rail ride over run `i` of the question. */
  const railOver = async (i: number, owner = userId) => {
    const run = (await evidence()).runs[i];
    return prisma.railJourney.create({ data: ride(owner, run.fromMs, run.untilMs) });
  };

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    userId = await makeJourneyUser(`${PREFIX}a`);
    otherId = await makeJourneyUser(`${PREFIX}b`);
    cookie = `auth_token=${generateToken(userId)}`;
  });

  beforeEach(async () => {
    await switches.set({ beta: true, config: true });
    await resetJourneyUser(userId);
    await prisma.userSettings.update({
      where: { userId },
      data: { locationProvider: "travtrack" },
    });
    await storeJourney(userId, morning(DAY));
    await storeJourney(userId, morning(DAY) + 4 * H, 10.5);
    await suggestJourneys(userId, { nowMs: NOW });
    id = (await prisma.locationSuggestion.findFirstOrThrow({ where: { userId } })).id;
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("lists the question with its runs, never a digest, a line or the evidence key", async () => {
    const res = await request(app)
      .get("/api/v1/location-suggestions?status=pending")
      .set("Cookie", cookie);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    const [item] = res.body.data;
    expect(item).toMatchObject({
      id,
      kind: "journey",
      provider: { kind: "travtrack" },
      explanation: { code: "journey.unlogged", params: { runs: 2 } },
      status: "pending",
      journey: { day: DAY, zone: "Europe/Berlin" },
    });
    expect(item.journey.runs).toHaveLength(2);
    expect(item.journey.runs[0]).toMatchObject({ index: 0, state: "open", link: null });
    const text = JSON.stringify(res.body);
    for (const secret of ["pointDigests", "line", "evidenceKey", "evidence_key"]) {
      expect(text).not.toContain(secret);
    }
    const stored = await row();
    expect(text).not.toContain(stored.evidenceKey);
    expect(text).not.toContain((await evidence()).runs[0].pointDigests[0]);
  });

  it("accept links once; twice the same; another entry 409", async () => {
    const r = await railOver(0);
    const first = await accept({ runIndex: 0, entryKind: "rail", entryId: r.id });
    expect(first.status).toBe(200);
    expect(first.body.data.journey.runs[0]).toMatchObject({
      state: "linked",
      link: { entryKind: "rail", entryId: r.id },
    });
    // One run is still open: the question stays.
    expect(first.body.data.status).toBe("pending");

    const again = await accept({ runIndex: 0, entryKind: "rail", entryId: r.id });
    expect(again.status).toBe(200);
    expect(again.body.data).toEqual(first.body.data);

    const other = await railOver(0);
    const refused = await accept({ runIndex: 0, entryKind: "rail", entryId: other.id });
    expect(refused.status).toBe(409);
    expect(refused.body.code).toBe("SUGGESTION_ALREADY_RESOLVED");
    expect((await evidence()).runs[0].link).toEqual({ entryKind: "rail", entryId: r.id });
  });

  it("the last run answered accepts the question, naming its first entry", async () => {
    const r = await railOver(0);
    await accept({ runIndex: 0, entryKind: "rail", entryId: r.id });
    const run = (await evidence()).runs[1];
    const b = await prisma.busJourney.create({ data: ride(userId, run.fromMs, run.untilMs) });
    const res = await accept({ runIndex: 1, entryKind: "bus", entryId: b.id });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("accepted");
    expect(await row()).toMatchObject({
      status: "accepted",
      acceptedEntryKind: "rail",
      acceptedEntryId: r.id,
      claimToken: null,
    });
  });

  it("a roadtrip answered from the card, with its two dated stations, is linked", async () => {
    const run = (await evidence()).runs[0];
    const created = await request(app)
      .post("/api/v1/roadtrips")
      .set("Cookie", cookie)
      .send({ name: `Roadtrip am ${DAY}` });
    expect(created.status).toBe(201);
    const routeId = created.body.roadtrip.id;
    // What the card sends: the run's ends as pass-through stations on their local days.
    const stations = await request(app)
      .put(`/api/v1/roadtrips/${routeId}/stations`)
      .set("Cookie", cookie)
      .send({
        expectedStationIds: [],
        stations: [
          { title: "Start", ...run.start, startDate: DAY, night: { kind: "pass" } },
          { title: "Ziel", ...run.end, startDate: DAY, night: { kind: "pass" } },
        ],
      });
    expect(stations.status).toBe(200);
    const res = await accept({ runIndex: 0, entryKind: "roadtrip", entryId: routeId });
    expect(res.status).toBe(200);
    expect(res.body.data.journey.runs[0]).toMatchObject({
      state: "linked",
      link: { entryKind: "roadtrip", entryId: routeId },
    });
  });

  it("an entry outside the run's window, another user's or none at all is refused", async () => {
    const run = (await evidence()).runs[0];
    const far = await prisma.railJourney.create({
      data: ride(userId, run.fromMs - 30 * H, run.fromMs - 29 * H),
    });
    const theirs = await railOver(0, otherId);
    const half = await prisma.railJourney.create({
      data: ride(userId, run.fromMs, run.fromMs + (run.untilMs - run.fromMs) * 0.4),
    });
    for (const entryId of [far.id, theirs.id, half.id, "00000000-0000-4000-8000-000000000000"]) {
      const res = await accept({ runIndex: 0, entryKind: "rail", entryId });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_FAILED");
    }
    // The saved entry stays, the run stays open, the question can still be answered.
    expect(await prisma.railJourney.count({ where: { id: far.id } })).toBe(1);
    expect((await evidence()).runs[0].state).toBe("open");
    expect((await row()).status).toBe("pending");
    expect((await accept({ runIndex: 7, entryKind: "rail", entryId: far.id })).status).toBe(400);
    expect((await accept({ runIndex: 0, entryKind: "ferry", entryId: far.id })).status).toBe(400);
  });

  it("closing the rest accepts with what is linked; closing everything rejects", async () => {
    const r = await railOver(0);
    await accept({ runIndex: 0, entryKind: "rail", entryId: r.id });
    const closed = await reject({ runIndex: 1 });
    expect(closed.status).toBe(200);
    expect(closed.body.data.status).toBe("accepted");
    expect(closed.body.data.journey.runs[1].state).toBe("closed");

    await resetJourneyUser(userId);
    await storeJourney(userId, morning(DAY));
    await suggestJourneys(userId, { nowMs: NOW });
    id = (await prisma.locationSuggestion.findFirstOrThrow({ where: { userId } })).id;
    const all = await reject();
    expect(all.body.data.status).toBe("rejected");
    expect((await reject()).status).toBe(200);
    expect((await accept({ runIndex: 0, entryKind: "rail", entryId: r.id })).status).toBe(409);
  });

  it("TravTrack off → 403 TRAVTRACK_DISABLED, the question stays, reject still works", async () => {
    const r = await railOver(0);
    await switches.set({ beta: true, config: false });
    const res = await accept({ runIndex: 0, entryKind: "rail", entryId: r.id });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("TRAVTRACK_DISABLED");
    expect((await row()).status).toBe("pending");
    expect((await reject()).body.data.status).toBe("rejected");
  });

  it("an account no longer on TravTrack cannot accept (409 TRAVTRACK_UNAVAILABLE)", async () => {
    const r = await railOver(0);
    await prisma.userSettings.update({ where: { userId }, data: { locationProvider: "none" } });
    const res = await accept({ runIndex: 0, entryKind: "rail", entryId: r.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("TRAVTRACK_UNAVAILABLE");
  });

  it("points deleted since the scan → 409 EVIDENCE_INVALIDATED, committed before the answer", async () => {
    const run = (await evidence()).runs[0];
    const r = await railOver(0);
    await prisma.travTrackPoint.deleteMany({
      where: { userId, t: { gte: new Date(run.fromMs), lte: new Date(run.untilMs) } },
    });
    const res = await accept({ runIndex: 0, entryKind: "rail", entryId: r.id });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("EVIDENCE_INVALIDATED");
    // Read afresh: the run is invalidated, the other run still open, the claim gone.
    const after = await row();
    expect(after).toMatchObject({ status: "pending", claimToken: null });
    expect(parseJourneyEvidence(after.evidence)!.runs.map((x) => x.state)).toEqual([
      "invalidated",
      "open",
    ]);
  });

  it("a range deleted between re-check and publish re-checks once, then invalidates", async () => {
    const run = (await evidence()).runs[0];
    const r = await railOver(0);
    let calls = 0;
    await expect(
      acceptJourneyRun(
        userId,
        id,
        { runIndex: 0, entryKind: "rail", entryId: r.id },
        {
          afterRecheck: async () => {
            calls += 1;
            if (calls > 1) return;
            await prisma.travTrackPoint.deleteMany({
              where: { userId, t: { gte: new Date(run.fromMs), lte: new Date(run.untilMs) } },
            });
            await prisma.$transaction((tx) => bumpHistoryGeneration(tx, userId));
          },
        }
      )
    ).rejects.toMatchObject({ code: "EVIDENCE_INVALIDATED" });
    expect(calls).toBe(2);
    expect((await evidence()).runs[0].state).toBe("invalidated");
  });

  it("history that keeps changing answers HISTORY_CHANGED and leaves the question open", async () => {
    const r = await railOver(0);
    await expect(
      acceptJourneyRun(
        userId,
        id,
        { runIndex: 0, entryKind: "rail", entryId: r.id },
        { afterRecheck: () => prisma.$transaction((tx) => bumpHistoryGeneration(tx, userId)) }
      )
    ).rejects.toMatchObject({ code: "HISTORY_CHANGED" });
    expect(await row()).toMatchObject({ status: "pending", claimToken: null });
    expect((await evidence()).runs[0].state).toBe("open");
  });

  it("a claim taken over while it publishes is never overwritten", async () => {
    const r = await railOver(0);
    let intruder = -1;
    const outcome = await acceptJourneyRun(
      userId,
      id,
      { runIndex: 0, entryKind: "rail", entryId: r.id },
      {
        beforeWrite: async () => {
          // Another worker takes the claim over (as after a stale claim), not awaited:
          // with the row locked it waits for this publication to end.
          void prisma.locationSuggestion
            .updateMany({
              where: { id, status: "accepting" },
              data: { claimToken: "intruder", claimedAt: new Date() },
            })
            .then(({ count }) => (intruder = count));
          await new Promise((resolve) => setTimeout(resolve, 300));
        },
      }
    ).then(
      () => "accepted",
      (e: { code?: string }) => e.code
    );
    await new Promise((resolve) => setTimeout(resolve, 300));
    const after = await row();
    if (outcome === "accepted") {
      // The takeover found the question no longer being accepted.
      expect(intruder).toBe(0);
      expect(after.claimToken).toBeNull();
    } else {
      // The takeover won: the old worker wrote nothing.
      expect(outcome).toBe("SUGGESTION_ACCEPT_IN_PROGRESS");
      expect(after.claimToken).toBe("intruder");
      expect((await evidence()).runs[0].state).toBe("open");
    }
  });

  it("closing a run cannot cancel an accept that took over a stale claim", async () => {
    await prisma.locationSuggestion.update({
      where: { id },
      data: {
        status: "accepting",
        claimToken: "crashed",
        claimedAt: new Date(Date.now() - 3 * 60_000),
      },
    });
    await expect(
      closeJourneyRuns(userId, id, 0, {
        afterRead: () =>
          prisma.locationSuggestion.update({
            where: { id },
            data: { claimToken: "fresh", claimedAt: new Date() },
          }),
      })
    ).rejects.toMatchObject({ code: "SUGGESTION_ACCEPT_IN_PROGRESS" });
    expect(await row()).toMatchObject({ status: "accepting", claimToken: "fresh" });
    expect((await evidence()).runs[0].state).toBe("open");
  });

  it("two concurrent accepts write one link", async () => {
    const r = await railOver(0);
    const body = { runIndex: 0, entryKind: "rail", entryId: r.id };
    const answers = await Promise.all([accept(body), accept(body)]);
    for (const a of answers) {
      expect([200, 409]).toContain(a.status);
      if (a.status === 409) expect(a.body.code).toBe("SUGGESTION_ACCEPT_IN_PROGRESS");
    }
    expect((await accept(body)).status).toBe(200);
    expect((await evidence()).runs[0]).toMatchObject({ state: "linked" });
  });

  it("a fresh claim is in progress; a claim left by a crash is taken over after two minutes", async () => {
    const r = await railOver(0);
    const body = { runIndex: 0, entryKind: "rail", entryId: r.id };
    await prisma.locationSuggestion.update({
      where: { id },
      data: { status: "accepting", claimToken: "crashed", claimedAt: new Date() },
    });
    const busy = await accept(body);
    expect(busy.status).toBe(409);
    expect(busy.body.code).toBe("SUGGESTION_ACCEPT_IN_PROGRESS");
    await prisma.locationSuggestion.update({
      where: { id },
      data: { claimedAt: new Date(Date.now() - 3 * 60_000) },
    });
    expect((await accept(body)).status).toBe(200);
  });

  it("another account's question is not found", async () => {
    const res = await request(app)
      .post(`/api/v1/location-suggestions/${id}/reject`)
      .set("Cookie", `auth_token=${generateToken(otherId)}`)
      .send({});
    expect(res.status).toBe(404);
  });
});
