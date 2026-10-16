import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import { loadVisibleDomains } from "../../domainVisibility";
import logger from "../../../utils/logger";
import { buildLeaderboardSnapshot } from "../aggregates";
import { saveBoard } from "../boards";
import { LOCAL_ROW_CAP, readLeaderboard } from "../leaderboard";

jest.mock("../../domainVisibility", () => ({
  ...jest.requireActual("../../domainVisibility"),
  loadVisibleDomains: jest.fn(),
}));

// The real builder by default; one test wraps it to watch how many run at once.
jest.mock("../aggregates", () => {
  const actual = jest.requireActual("../aggregates");
  return { ...actual, buildLeaderboardSnapshot: jest.fn(actual.buildLeaderboardSnapshot) };
});
const realBuild = jest.requireActual("../aggregates").buildLeaderboardSnapshot;

const TRIPS = { groups: ["trips"], domains: ["ferry"], year: null };
const users: string[] = [];
let viewer: string, ben: string, cleo: string, dora: string, emil: string, remoteId: string;
const pull = jest.fn().mockResolvedValue({ status: "outdated" });

async function user(): Promise<string> {
  const u = await prisma.user.create({
    data: { username: `lb-l-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
  });
  users.push(u.id);
  return u.id;
}
async function shares(ownerId: string, scope: object, status = "accepted", ageMs = 0) {
  await prisma.leaderboardConsent.create({
    data: {
      ownerId,
      viewerId: viewer,
      status,
      scope,
      decidedAt: new Date(Date.now() - 10_000 + ageMs),
    },
  });
}
const remoteFor = async (userId: string, name: string) =>
  (
    await prisma.leaderboardRemote.create({
      data: {
        userId,
        origin: `https://${name}.lb-board.test`,
        channel: randomUUID(),
        username: name,
        displayName: name,
      },
    })
  ).id;

beforeAll(async () => {
  [viewer, ben, cleo, dora, emil] = [
    await user(),
    await user(),
    await user(),
    await user(),
    await user(),
  ];
  await shares(ben, TRIPS, "accepted", 0);
  await shares(cleo, { ...TRIPS, year: 2024 }, "accepted", 1);
  await shares(dora, TRIPS, "accepted", 2);
  await shares(emil, TRIPS, "withdrawn", 3);
  await prisma.user.update({ where: { id: dora }, data: { isActive: false } });
  await prisma.ferryJourney.create({
    data: {
      userId: ben,
      depStationName: "Puttgarden",
      depLat: 54.5,
      depLon: 11.23,
      arrStationName: "Rødby",
      arrLat: 54.65,
      arrLon: 11.35,
      departureTime: new Date("2025-08-01T08:00:00Z"),
      status: "completed",
      distanceKm: 19,
    },
  });
  remoteId = await remoteFor(viewer, "far");
});
beforeEach(() => {
  jest.mocked(loadVisibleDomains).mockResolvedValue(["ferry"]);
  pull.mockClear();
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: { in: users } } });
  await prisma.$disconnect();
});

it("lists self, consented friends and remote friends; drops deactivated and withdrawn ones", async () => {
  const res = await readLeaderboard(viewer, { year: 2025 }, pull);
  expect(res.rows.map((r) => [r.person.key, r.status])).toEqual([
    ["self", "ok"],
    [`local:${ben}`, "ok"],
    [`local:${cleo}`, "yearNotShared"],
    [`remote:${remoteId}`, "outdated"],
  ]);
  expect(res.rows[1].snapshot?.metrics).toEqual({ ferryCrossings: 1 });
  expect(res.rows[2].sharedYear).toBe(2024);
  expect(pull).toHaveBeenCalledWith(expect.objectContaining({ id: remoteId }), 2025);
});

it("does not answer a one-year consent with lifetime totals", async () => {
  const res = await readLeaderboard(viewer, { year: null }, pull);
  expect(res.rows.find((r) => r.person.key === `local:${cleo}`)).toMatchObject({
    status: "yearNotShared",
    snapshot: null,
  });
});

it("shows only a board's members, and a withdrawn member leaves the board", async () => {
  const board = await saveBoard(viewer, { name: "Fähre", members: [`local:${ben}`] });
  expect(
    (await readLeaderboard(viewer, { year: 2025, boardId: board.id }, pull)).rows.map(
      (r) => r.person.key
    )
  ).toEqual(["self", `local:${ben}`]);
  await prisma.leaderboardConsent.updateMany({
    where: { ownerId: ben, viewerId: viewer },
    data: { status: "withdrawn" },
  });
  expect(
    (await readLeaderboard(viewer, { year: 2025, boardId: board.id }, pull)).rows.map(
      (r) => r.person.key
    )
  ).toEqual(["self"]);
  expect(pull).not.toHaveBeenCalled();
});

describe("one bad row costs only that row", () => {
  it("shows a friend whose stored scope does not parse as notShared, not a failed page", async () => {
    const [me, odd, fine] = [await user(), await user(), await user()];
    await prisma.leaderboardConsent.createMany({
      data: [
        {
          ownerId: odd,
          viewerId: me,
          status: "accepted",
          scope: { groups: "trips" },
          decidedAt: new Date(1000),
        },
        {
          ownerId: fine,
          viewerId: me,
          status: "accepted",
          scope: TRIPS,
          decidedAt: new Date(2000),
        },
      ],
    });
    const res = await readLeaderboard(me, { year: null }, pull);
    expect(res.rows.map((r) => [r.person.key, r.status, r.snapshot, r.sharedYear])).toEqual([
      ["self", "ok", expect.anything(), null],
      [`local:${odd}`, "notShared", null, null],
      [`local:${fine}`, "ok", expect.anything(), null],
    ]);
  });

  it("answers for every other remote friend when one server fails or never answers", async () => {
    const me = await user();
    const [failing, hanging, fine] = [
      await remoteFor(me, "failing"),
      await remoteFor(me, "hanging"),
      await remoteFor(me, "fine"),
    ];
    const slowPull = jest.fn((remote: { id: string }) => {
      if (remote.id === failing) return Promise.reject(new Error("connection reset"));
      if (remote.id === hanging) return new Promise<never>(() => undefined);
      return Promise.resolve({ status: "yearNotShared" as const, sharedYear: 2023 });
    });
    const started = Date.now();
    const res = await readLeaderboard(me, { year: 2025 }, slowPull, 200);
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(res.rows.map((r) => [r.person.key, r.status, r.sharedYear])).toEqual([
      ["self", "ok", null],
      [`remote:${failing}`, "unreachable", null],
      [`remote:${hanging}`, "unreachable", null],
      [`remote:${fine}`, "yearNotShared", 2023],
    ]);
  });
});

it("finds a board member who is not among the oldest LOCAL_ROW_CAP friends", async () => {
  const me = await user();
  const friends: string[] = [];
  for (let i = 0; i <= LOCAL_ROW_CAP; i++) friends.push(await user());
  await prisma.leaderboardConsent.createMany({
    data: friends.map((ownerId, i) => ({
      ownerId,
      viewerId: me,
      status: "accepted",
      scope: TRIPS,
      decidedAt: new Date(1_000_000 + i * 1000),
    })),
  });
  const newest = friends[LOCAL_ROW_CAP];
  const far = await remoteFor(me, "board-far");
  await remoteFor(me, "not-on-board");
  const board = await saveBoard(me, { name: "Neu", members: [`local:${newest}`, `remote:${far}`] });

  const all = await readLeaderboard(me, { year: null }, pull);
  expect(all.rows.filter((r) => r.person.kind === "local")).toHaveLength(LOCAL_ROW_CAP);

  const onBoard = await readLeaderboard(me, { year: null, boardId: board.id }, pull);
  expect(onBoard.rows.map((r) => r.person.key)).toEqual([
    "self",
    `local:${newest}`,
    `remote:${far}`,
  ]);
  expect(pull).toHaveBeenLastCalledWith(expect.objectContaining({ id: far }), null);
});

it("builds friends' totals a few at a time, in order, with the self row first", async () => {
  const me = await user();
  const friends: string[] = [];
  for (let i = 0; i < 9; i++) friends.push(await user());
  await prisma.leaderboardConsent.createMany({
    data: friends.map((ownerId, i) => ({
      ownerId,
      viewerId: me,
      status: "accepted",
      scope: TRIPS,
      decidedAt: new Date(2_000_000 + i * 1000),
    })),
  });
  const broken = friends[4];
  let open = 0;
  let most = 0;
  const order: string[] = [];
  jest.mocked(buildLeaderboardSnapshot).mockImplementation(async (ownerId, ...rest) => {
    order.push(ownerId);
    open += 1;
    most = Math.max(most, open);
    try {
      await new Promise((resolve) => setTimeout(resolve, 15));
      if (ownerId === broken) throw new Error("loader down");
      return await realBuild(ownerId, ...rest);
    } finally {
      open -= 1;
    }
  });
  const quiet = jest.spyOn(logger, "error").mockImplementation(() => undefined);
  try {
    const res = await readLeaderboard(me, { year: null }, pull);
    expect(order[0]).toBe(me);
    expect(most).toBeGreaterThan(1);
    expect(most).toBeLessThanOrEqual(4);
    expect(res.rows.map((r) => [r.person.key, r.status])).toEqual([
      ["self", "ok"],
      ...friends.map((f) => [`local:${f}`, f === broken ? "unreachable" : "ok"]),
    ]);
  } finally {
    quiet.mockRestore();
    jest.mocked(buildLeaderboardSnapshot).mockImplementation(realBuild);
  }
});
