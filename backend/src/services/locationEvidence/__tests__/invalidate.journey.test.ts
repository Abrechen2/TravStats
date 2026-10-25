/**
 * History deleted — a journey question's share of it (TravTrack plan E5 for
 * E7's rows). A journey is affected by a removal that meets its runs' window,
 * that takes one of its runs' points (digest), that falls on one of its days
 * (its runs are bounded by the stays and silences read from those days), or —
 * for a zone — whose circle holds an end of a run, a vertex of its line or a
 * chord of that line, even when the zone deleted no point. Open questions go;
 * an accepted one keeps its answer, with no end, line or digest.
 */
import request from "supertest";
import app from "../../../index";
import { prisma } from "../../../db";
import { generateToken } from "../../../utils/jwt";
import { positionKey } from "../../travtrack/classify";
import { deleteTravTrackRange } from "../../travtrack/deleteRange";
import { createZone } from "../../travtrack/zones";
import { travTrackSwitches } from "../../travtrack/__tests__/switches";
import { invalidateOnHistoryDeleted, journeyMeetsZone } from "../invalidate";
import { parseJourneyEvidence } from "../journeys/evidence";
import { suggestJourneys } from "../journeys/suggest";
import { LON_PER_KM_AT_50, MIN } from "../journeys/__tests__/journeyPoints";
import {
  H,
  NOW,
  makeJourneyUser,
  morning,
  resetJourneyUser,
  ride,
  storeAll,
  storeJourney,
} from "../journeys/__tests__/journeyFixtures";
import { point } from "../journeys/__tests__/journeyPoints";

const PREFIX = "evidence-invalidate-journey-";
const DAY = "2026-10-20";
const T0 = morning(DAY);
/** The drive: 90 min at 100 km/h east along 50° N from 8° E, after a 30-min stop. */
const DRIVE_FROM = T0 + 30 * MIN;
const DRIVE_UNTIL = DRIVE_FROM + 90 * MIN;
const kmEast = (km: number) => ({ lat: 50, lon: 8 + km * LON_PER_KM_AT_50 });

const switches = travTrackSwitches();
let userId: string;
let cookie: string;

beforeAll(async () => {
  process.env.ENCRYPTION_KEY ??= "c".repeat(64);
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  userId = await makeJourneyUser(`${PREFIX}a`);
  cookie = `auth_token=${generateToken(userId)}`;
});

beforeEach(async () => {
  await switches.set({ beta: true, config: true });
  await resetJourneyUser(userId);
  await prisma.travTrackPrivacyZone.deleteMany({ where: { userId } });
  await storeJourney(userId, T0);
  await suggestJourneys(userId, { nowMs: NOW });
});

afterAll(async () => {
  await switches.restore();
  await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
  await prisma.$disconnect();
});

const question = () => prisma.locationSuggestion.findFirst({ where: { userId, kind: "journey" } });
const zone = (at: { lat: number; lon: number }, radiusM: number) =>
  createZone(userId, { name: "z", ...at, radiusM }, true);

describe("zone", () => {
  it("a new zone that deletes nothing still removes a pending journey whose line's chord crosses it", async () => {
    expect(await question()).not.toBeNull();
    // 75 km in: halfway between two fixes (one every 3.3 km), so no stored
    // point and no vertex lies within 300 m — only the chord does.
    const before = await prisma.travTrackPoint.count({ where: { userId } });
    await zone(kmEast(75), 300);
    expect(await prisma.travTrackPoint.count({ where: { userId } })).toBe(before);
    expect(await question()).toBeNull();
  });

  it("a zone around a run's end removes it, by the end alone", async () => {
    const run = parseJourneyEvidence((await question())!.evidence)!.runs[0];
    // The handler directly, with nothing removed: the stop at the end holds
    // stored points, and a zone through the app would delete them too.
    await prisma.$transaction((tx) =>
      invalidateOnHistoryDeleted(tx, userId, {
        kind: "zone",
        zone: { ...run.end, radiusM: 100 },
        spans: [],
        days: [],
        keys: new Set(),
      })
    );
    expect(await question()).toBeNull();
  });

  it("a zone away from the line, its ends and its days leaves it", async () => {
    await zone({ lat: 52.5, lon: 13.4 }, 500);
    expect(await question()).not.toBeNull();
  });

  it("the line check: a vertex inside, a chord across, or an unreadable line meets the zone", () => {
    const run = (line: unknown) => ({
      runs: [{ start: { lat: 0, lon: 0 }, end: { lat: 0, lon: 1 }, line }],
    });
    const circle = { lat: 0, lon: 0.5, radiusM: 1000 };
    expect(
      journeyMeetsZone(
        run([
          [
            [0.2, 0],
            [0.5, 0],
          ],
        ]),
        circle
      )
    ).toBe(true);
    expect(
      journeyMeetsZone(
        run([
          [
            [0.2, 0],
            [0.8, 0],
          ],
        ]),
        circle
      )
    ).toBe(true);
    expect(
      journeyMeetsZone(
        run([
          [
            [0.2, 0.5],
            [0.8, 0.5],
          ],
        ]),
        circle
      )
    ).toBe(false);
    expect(journeyMeetsZone(run([["x"]]), circle)).toBe(true);
    expect(journeyMeetsZone({}, circle)).toBe(true);
  });
});

describe("range, digest and day", () => {
  it("a range over the run removes the open question", async () => {
    await deleteTravTrackRange(userId, new Date(DRIVE_FROM), new Date(DRIVE_UNTIL));
    expect(await question()).toBeNull();
  });

  it("points of the day outside the run's window still remove it: its runs were read from that day", async () => {
    const evening = Date.parse(`${DAY}T19:00:00Z`);
    await storeAll(userId, [point(evening, 50, 9), point(evening + 2 * MIN, 50, 9)]);
    await deleteTravTrackRange(userId, new Date(evening - MIN), new Date(evening + 3 * MIN));
    expect(await question()).toBeNull();
  });

  it("a range on another day leaves it", async () => {
    const other = Date.parse("2026-10-22T19:00:00Z");
    await storeAll(userId, [point(other, 50, 9)]);
    await deleteTravTrackRange(userId, new Date(other - MIN), new Date(other + MIN));
    expect(await question()).not.toBeNull();
  });

  it("one of a run's points removed elsewhere (an origin's keys) removes it by its digest", async () => {
    const stored = await prisma.travTrackPoint.findFirstOrThrow({
      where: { userId, t: { gt: new Date(DRIVE_FROM + 10 * MIN) } },
      orderBy: { t: "asc" },
    });
    await prisma.$transaction((tx) =>
      invalidateOnHistoryDeleted(tx, userId, {
        kind: "origin",
        origin: "gpx:elsewhere",
        keys: new Set([positionKey(stored)]),
        spans: [],
        days: [],
      })
    );
    expect(await question()).toBeNull();
  });
});

describe("an accepted journey", () => {
  it("keeps its answer and link, loses ends, line and digests; a repeat still answers it; the day is not asked again", async () => {
    const q = (await question())!;
    const run = parseJourneyEvidence(q.evidence)!.runs[0];
    const rail = await prisma.railJourney.create({ data: ride(userId, run.fromMs, run.untilMs) });
    const body = { runIndex: 0, entryKind: "rail", entryId: rail.id };
    const accept = () =>
      request(app)
        .post(`/api/v1/location-suggestions/${q.id}/accept`)
        .set("Cookie", cookie)
        .send(body);
    const first = await accept();
    expect(first.status).toBe(200);
    expect(first.body.data.status).toBe("accepted");

    await deleteTravTrackRange(userId, new Date(T0 - H), new Date(DRIVE_UNTIL + H));

    const kept = await prisma.locationSuggestion.findUniqueOrThrow({ where: { id: q.id } });
    expect(kept).toMatchObject({
      status: "accepted",
      acceptedEntryKind: "rail",
      acceptedEntryId: rail.id,
    });
    const text = JSON.stringify(kept.evidence);
    for (const gone of ["line", "start", "end", "pointDigests", `${run.end.lat}`]) {
      expect(text).not.toContain(gone);
    }
    expect(kept.evidence).toMatchObject({
      source: "travtrack",
      day: DAY,
      runs: [
        {
          fromMs: run.fromMs,
          untilMs: run.untilMs,
          state: "linked",
          link: { entryKind: "rail", entryId: rail.id },
        },
      ],
    });
    expect(await prisma.railJourney.count({ where: { id: rail.id } })).toBe(1);
    // The kilometres were measured on the deleted history (Codex review of L4).
    expect(kept.explanation).toEqual({ code: "journey.unlogged", params: { runs: 1 } });

    const again = await accept();
    expect(again.status).toBe(200);
    expect(again.body.data.status).toBe("accepted");
    const other = await accept().then(() =>
      request(app)
        .post(`/api/v1/location-suggestions/${q.id}/accept`)
        .set("Cookie", cookie)
        .send({ ...body, entryId: "another" })
    );
    expect(other.status).toBe(409);
    expect(other.body.code).toBe("SUGGESTION_ALREADY_RESOLVED");

    // The same drive again (re-imported, say): the day stays answered.
    await storeJourney(userId, T0);
    await suggestJourneys(userId, { nowMs: NOW });
    expect(await prisma.locationSuggestion.count({ where: { userId, kind: "journey" } })).toBe(1);
  });
});
