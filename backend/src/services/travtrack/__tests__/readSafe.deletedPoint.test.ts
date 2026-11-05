import { prisma } from "../../../db";
import { deriveLegs } from "../legs/derive";
import { rememberDeletedPoint } from "../deletedPoints";
import { readSafeTravTrack } from "../readSafe";
import { makeUser, storePoint, wipeTravTrack } from "./fixtures";

const PREFIX = "travtrack-readsafe-deleted-point-";
const H = 3_600_000;
const FROM = Date.parse("2026-11-04T23:00:00Z");
const WINDOW = { fromMs: FROM, untilMs: FROM + 24 * H };
const SPOT = { lat: 47.82673, lon: 12.19074 };

describe("TravTrack — a silence holding a deleted point", () => {
  let userId: string;
  beforeAll(async () => {
    userId = await makeUser(`${PREFIX}a`);
  });
  beforeEach(() => wipeTravTrack([userId]));
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  const stops = async () =>
    deriveLegs(await readSafeTravTrack(userId, WINDOW, 50_000), {
      windows: [],
      overrides: [],
      stays: [],
    }).stops;

  it("is bridged when nothing was deleted, and not when one mid-gap point was (was: bridged)", async () => {
    for (const h of [1, 4]) await storePoint(userId, { t: FROM + h * H, ...SPOT });
    expect(await stops()).toHaveLength(1);
    await prisma.$transaction((tx) =>
      rememberDeletedPoint(tx, userId, { tS: (FROM + 2.5 * H) / 1000, ...SPOT })
    );
    expect(await stops()).toEqual([]);
  });
});
