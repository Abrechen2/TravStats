import { randomUUID } from "crypto";
import { prisma } from "../../../db";
import logger from "../../../utils/logger";
import { exchange } from "../../federation/security";
import { loadIdentity } from "../../federation/identity";
import type { LeaderboardScope } from "../../../schemas/comparison";
import { pullRemote } from "../remote";
import { listPeople } from "../consents";

jest.mock("../../federation/security", () => ({
  ...jest.requireActual("../../federation/security"),
  exchange: jest.fn(),
}));
jest.mock("../../federation/identity", () => ({
  ...jest.requireActual("../../federation/identity"),
  loadIdentity: jest.fn(),
}));

const PEER = "https://peer.lb-theirs.test";
const SCOPE: LeaderboardScope = { groups: ["trips"], domains: ["flight"], year: null };
let userId: string;
let warn: jest.SpyInstance;

const newRemote = () =>
  prisma.leaderboardRemote.create({
    data: {
      userId,
      origin: PEER,
      channel: randomUUID(),
      username: "anna",
      displayName: "Anna",
      consents: {
        create: {
          ownerId: userId,
          status: "accepted",
          scope: SCOPE as never,
          decidedAt: new Date(),
        },
      },
    },
  });
const theirsOf = async (remoteId: string) =>
  (await listPeople(userId)).people.find((p) => p.person.key === `remote:${remoteId}`)?.theirs;
const snapshot = {
  schema: "travstats-leaderboard",
  version: 1,
  asOf: "2026-10-16T00:00:00.000Z",
  year: null,
  domains: ["flight"],
  metrics: { flights: 3 },
  partial: [],
};

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `lb-t-${randomUUID().slice(0, 8)}`, passwordHash: "test-only" },
    })
  ).id;
  await prisma.comparisonPeer.upsert({
    where: { origin: PEER },
    create: {
      origin: PEER,
      publicKey: "unused",
      enabled: true,
      verifiedAt: new Date(),
      leaderboardVersions: [1, 2],
    },
    update: { enabled: true, verifiedAt: new Date(), leaderboardVersions: [1, 2] },
  });
});
beforeEach(() => {
  jest.mocked(exchange).mockReset();
  jest.mocked(loadIdentity).mockResolvedValue({ origin: "https://me.lb-theirs.test" } as never);
  warn = jest.spyOn(logger, "warn").mockImplementation(() => undefined);
});
afterEach(() => warn.mockRestore());
afterAll(async () => {
  await prisma.comparisonPeer.deleteMany({ where: { origin: { endsWith: ".lb-theirs.test" } } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

it("before any answer it is unknown", async () => {
  const r = await newRemote();
  expect(await theirsOf(r.id)).toEqual({ status: "unknown", answeredAt: null });
});

it("a remote person's theirs status follows the last aggregate answer", async () => {
  const r = await newRemote();
  const ask = async (reply: unknown) => {
    jest.mocked(exchange).mockResolvedValueOnce(reply);
    await pullRemote(r, null);
    return theirsOf(r.id);
  };
  expect(await ask({ status: "ok", snapshot })).toMatchObject({ status: "accepted" });
  expect(await ask({ status: "notShared" })).toMatchObject({ status: "pending" });
  expect(await ask({ status: "withdrawn" })).toMatchObject({ status: "withdrawn" });
  const last = await ask({ status: "yearNotShared", year: 2024 });
  expect(last).toMatchObject({ status: "accepted" });
  expect(last?.answeredAt).toEqual(expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/));
});

it("a failed pull keeps the last definite answer instead of downgrading it", async () => {
  const r = await newRemote();
  jest.mocked(exchange).mockResolvedValueOnce({ status: "withdrawn" });
  await pullRemote(r, null);
  jest.mocked(exchange).mockRejectedValueOnce(new Error("down"));
  await pullRemote(r, null);
  expect(await theirsOf(r.id)).toMatchObject({ status: "withdrawn" });
});

it("a notShared answer to a request that said the viewer does not share is not recorded", async () => {
  const r = await newRemote();
  await prisma.leaderboardConsent.updateMany({
    where: { remoteId: r.id },
    data: { status: "withdrawn" },
  });
  jest.mocked(exchange).mockResolvedValueOnce({ status: "notShared" });
  await pullRemote(r, null);
  expect(await theirsOf(r.id)).toEqual({ status: "unknown", answeredAt: null });
});
