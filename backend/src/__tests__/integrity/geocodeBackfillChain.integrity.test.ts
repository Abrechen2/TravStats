/**
 * Data-integrity audit 2026-09-19, finding 2 — and its fix.
 *
 * `services/lodging/geocodeBackfill.ts` wrote the geocoder's answer with
 * `prisma.lodging.updateMany({ where: { id, lat: null, lon: null }, data: {
 *   lat, lon, …, ...(coords.chainName && row.chainId === null
 *        ? { chain: { connect: { name: coords.chainName } } } : {}) } })`.
 *
 * `updateMany` takes `LodgingUpdateManyMutationInput`, which carries `chainId`
 * and no `chain` relation (src/generated/prisma/models/Lodging.ts:615). The
 * nested `connect` was therefore an unknown argument. TypeScript did not catch
 * it — the excess-property check does not reach a conditionally spread object
 * literal — so it was a RUNTIME failure, and the per-row `catch` above it
 * turned the failure into a `warn` line and moved on.
 *
 * Consequence, for exactly the rows where the geocoder DID identify a chain
 * and the house had none yet: the coordinates were thrown away too. Nothing
 * stored, nothing shown to the user, and the row's `geocodeAttemptedAt` was
 * already stamped, so it went to the back of the queue and failed the same way
 * next time.
 *
 * These cases drive the REAL `backfillMissingCoordinates`, with the three
 * geocoder tiers stubbed, and read the row back. An earlier version asserted
 * against a local copy of the write — which is no guard at all: reverting the
 * service would have left it green.
 */
import { prisma } from "../../db";

jest.mock("../../services/geo/photon", () => ({ searchPlaces: jest.fn() }));
jest.mock("../../services/geo/nominatim", () => ({
  geocodeAddress: jest.fn(),
  reverseGeocode: jest.fn(),
}));
jest.mock("../../services/geo/googlePlaces", () => ({
  findLodgingPlace: jest.fn(),
  isGooglePlacesConfigured: jest.fn(),
}));

import { searchPlaces } from "../../services/geo/photon";
import { geocodeAddress } from "../../services/geo/nominatim";
import { findLodgingPlace } from "../../services/geo/googlePlaces";
import { backfillMissingCoordinates } from "../../services/lodging/geocodeBackfill";

const TAG = `i2geo-${Date.now()}`;
let userId = "";
let chainId = 0;

/**
 * The Google tier is the only one that reports a chain, so it is the one that
 * reaches the branch under test. Photon and Nominatim answer nothing, exactly
 * as they do for a house neither of them knows.
 */
function googleAnswers(chainName: string | null): void {
  jest.mocked(searchPlaces).mockResolvedValue([]);
  jest.mocked(geocodeAddress).mockResolvedValue(null);
  jest.mocked(findLodgingPlace).mockResolvedValue({
    lat: 48.1,
    lon: 11.6,
    type: "hotel",
    name: "Whatever Google calls it",
    city: "München",
    country: "Germany",
    address: "Musterstraße 1",
    chainName,
    countryCode: "DE",
  });
}

beforeAll(async () => {
  const user = await prisma.user.create({
    data: { username: `${TAG}-user`, passwordHash: "x" },
  });
  userId = user.id;
  const chain = await prisma.lodgingChain.create({
    data: { name: `${TAG}-Chain`, isUserAdded: true },
  });
  chainId = chain.id;
});

beforeEach(() => {
  jest.clearAllMocks();
});

afterAll(async () => {
  await prisma.lodging.deleteMany({ where: { userId } });
  await prisma.user.deleteMany({ where: { username: { startsWith: TAG } } });
  await prisma.lodgingChain.deleteMany({ where: { name: { startsWith: TAG } } });
  await prisma.$disconnect();
});

describe("the geocode backfill's position write", () => {
  it("stores the position when the geocoder names NO chain (the control)", async () => {
    const row = await prisma.lodging.create({
      data: { userId, name: `${TAG}-no-chain`, type: "hotel" },
    });
    googleAnswers(null);

    const result = await backfillMissingCoordinates(userId);

    expect(result.filled).toBe(1);
    const after = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.lat).toBeCloseTo(48.1);
    expect(after.lon).toBeCloseTo(11.6);
    expect(after.chainId).toBeNull();
  });

  it("stores the position AND the chain when the geocoder names one the catalogue knows", async () => {
    // The defect's own case: before the fix this row came back with lat, lon,
    // city and chain all still null, because the write threw as a whole.
    const row = await prisma.lodging.create({
      data: { userId, name: `${TAG}-with-chain`, type: "hotel" },
    });
    googleAnswers(`${TAG}-Chain`);

    const result = await backfillMissingCoordinates(userId);

    expect(result.filled).toBe(1);
    const after = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.lat).toBeCloseTo(48.1);
    expect(after.lon).toBeCloseTo(11.6);
    expect(after.city).toBe("München");
    expect(after.chainId).toBe(chainId);
  });

  it("still stores the POSITION when the chain name is one the catalogue does not know", async () => {
    const row = await prisma.lodging.create({
      data: { userId, name: `${TAG}-unknown-chain`, type: "hotel" },
    });
    googleAnswers(`${TAG}-no-such-chain`);

    const result = await backfillMissingCoordinates(userId);

    // The position is the point of the pass. An unknown chain name is not a
    // reason to store nothing — which is precisely what the defect did.
    expect(result.filled).toBe(1);
    const after = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.lat).toBeCloseTo(48.1);
    expect(after.chainId).toBeNull();
  });

  it("never overwrites a chain the row already has", async () => {
    const other = await prisma.lodgingChain.create({
      data: { name: `${TAG}-Other`, isUserAdded: true },
    });
    const row = await prisma.lodging.create({
      data: { userId, name: `${TAG}-owned-chain`, type: "hotel", chainId: other.id },
    });
    googleAnswers(`${TAG}-Chain`);

    await backfillMissingCoordinates(userId);

    const after = await prisma.lodging.findUniqueOrThrow({ where: { id: row.id } });
    expect(after.lat).toBeCloseTo(48.1);
    expect(after.chainId).toBe(other.id);
  });
});
