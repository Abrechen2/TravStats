import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { loadVisibleDomains } from "../../domainVisibility";
import { readLeaderboard } from "../leaderboard";
import { serveAggregate } from "../peerActions";
import { clearYearlyTotalsCache } from "../yearlyTotalsCache";

jest.mock("../../domainVisibility", () => ({
  ...jest.requireActual("../../domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

const SCOPE = { groups: ["trips"], domains: ["ferry"], year: null };
const users: string[] = [];
let owner: string, viewer: string;

const mkUser = async () => {
  const u = await prisma.user.create({
    data: { username: `lb-ym-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  users.push(u.id);
  return u.id;
};

beforeAll(async () => {
  owner = await mkUser();
  viewer = await mkUser();
  await prisma.ferryJourney.createMany({
    data: ["2023-06-01T12:00:00Z", "2025-05-01T12:00:00Z"].map((d) => ({
      userId: owner,
      depStationName: "Kiel",
      depLat: 54.3,
      depLon: 10.1,
      arrStationName: "Oslo",
      arrLat: 59.9,
      arrLon: 10.7,
      departureTime: new Date(d),
      status: "completed",
      distanceKm: 100,
    })),
  });
});
beforeEach(() => {
  clearYearlyTotalsCache();
  jest.mocked(loadVisibleDomains).mockResolvedValue(["ferry"]);
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

const setConsent = (ownerId: string, viewerId: string, scope: object) =>
  prisma.leaderboardConsent.upsert({
    where: { ownerId_viewerId: { ownerId, viewerId } },
    create: { ownerId, viewerId, status: "accepted", scope, decidedAt: new Date() },
    update: { status: "accepted", scope, decidedAt: new Date() },
  });

describe("yearly totals are mutual — enforced on the server", () => {
  const local = async () =>
    (await readLeaderboard(viewer, { year: null })).rows.find((r) => r.person.key !== "self")
      ?.snapshot;

  it.each([
    ["the viewer's consent has no years", { ...SCOPE }, false],
    ["the viewer's consent has years:false", { ...SCOPE, years: false }, false],
    ["both sides opted in", { ...SCOPE, years: true }, true],
  ])("local: owner on, %s", async (_n, viewerScope, expected) => {
    await setConsent(owner, viewer, { ...SCOPE, years: true });
    await setConsent(viewer, owner, viewerScope);
    const snap = await local();
    expect(snap?.version).toBe(3);
    expect(snap && "years" in snap && snap.years !== undefined).toBe(expected);
  });

  it("local: owner off, viewer on → no years either", async () => {
    await setConsent(owner, viewer, { ...SCOPE });
    await setConsent(viewer, owner, { ...SCOPE, years: true });
    const snap = await local();
    expect(snap && "years" in snap).toBe(false);
  });

  describe("federated", () => {
    const origin = "https://far.lb-ym.test";
    let channel: string;
    beforeAll(async () => {
      const remote = await prisma.leaderboardRemote.create({
        data: {
          userId: owner,
          origin,
          channel: randomUUID(),
          username: "far",
          displayName: "Far",
          consents: {
            create: {
              ownerId: owner,
              status: "accepted",
              scope: { ...SCOPE, years: true },
              decidedAt: new Date(),
            },
          },
        },
      });
      channel = remote.channel;
    });
    const ask = async (viewerYears?: boolean) => {
      const reply = await serveAggregate(origin, {
        action: "aggregate",
        channel,
        year: null,
        accept: [1, 2, 3],
        viewerShares: true,
        ...(viewerYears === undefined ? {} : { viewerYears }),
      });
      if (reply.status !== "ok") throw new Error(reply.status);
      return reply.snapshot;
    };
    it.each([[false], [undefined]])("viewerYears %s → no years", async (flag) => {
      const snap = await ask(flag);
      expect(snap.version).toBe(3);
      expect("years" in snap).toBe(false);
    });
    it("viewerYears true and the owner's consent has years → years", async () => {
      const snap = await ask(true);
      if (snap.version !== 3) throw new Error("expected v3");
      expect(Object.keys(snap.years ?? {})).toEqual(["2023", "2025"]);
    });
    it("viewerYears true but the owner's consent has no years → none", async () => {
      await prisma.leaderboardConsent.updateMany({
        where: { ownerId: owner, remote: { origin } },
        data: { scope: SCOPE },
      });
      expect("years" in (await ask(true))).toBe(false);
    });
  });
});
