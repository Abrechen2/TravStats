import { prisma } from "../../../db";
import { travTrackSwitches } from "../../travtrack/__tests__/switches";
import { makeUser } from "../../travtrack/__tests__/fixtures";
import { setLocationProvider, travTrackAcceptsBefore } from "../provider";

/**
 * When an account's provider left TravTrack (TravTrack plan E9, coordinator
 * ruling after the Codex review): OwnTracks and Overland keep posting after a
 * switch, and positions recorded while TravTrack was the provider are still
 * TravTrack's, while later ones are not. So the moment of leaving is kept —
 * set when the provider changes away from `travtrack`, cleared when it comes
 * back, untouched by a switch between two other providers.
 */

const PREFIX = "tt-left-at-";

describe("travtrack_left_at", () => {
  const switches = travTrackSwitches();
  let userId: string;

  const leftAt = async () =>
    (
      await prisma.userSettings.findUnique({
        where: { userId },
        select: { travtrackLeftAt: true },
      })
    )?.travtrackLeftAt ?? null;

  beforeAll(async () => {
    await switches.set({ beta: true, config: true });
    userId = await makeUser(`${PREFIX}a`);
  });

  afterAll(async () => {
    await switches.restore();
    await prisma.user.deleteMany({ where: { username: { startsWith: PREFIX } } });
    await prisma.$disconnect();
  });

  it("an account that never chose TravTrack accepts nothing", async () => {
    expect(await travTrackAcceptsBefore(userId)).toBe(-Infinity);
    await setLocationProvider(userId, "none");
    expect(await leftAt()).toBeNull();
    expect(await travTrackAcceptsBefore(userId)).toBe(-Infinity);
  });

  it("TravTrack as the provider accepts every time", async () => {
    await setLocationProvider(userId, "travtrack");
    expect(await leftAt()).toBeNull();
    expect(await travTrackAcceptsBefore(userId)).toBe(Infinity);
  });

  it("leaving TravTrack records the moment, and points before it stay acceptable", async () => {
    await setLocationProvider(userId, "travtrack");
    const before = Date.now();
    await setLocationProvider(userId, "none");
    const at = await leftAt();
    expect(at).not.toBeNull();
    expect(at!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(await travTrackAcceptsBefore(userId)).toBe(at!.getTime());
  });

  it("choosing the same provider again, or another non-TravTrack one, keeps the moment", async () => {
    await setLocationProvider(userId, "travtrack");
    await setLocationProvider(userId, "none");
    const at = await leftAt();
    await setLocationProvider(userId, "none");
    expect(await leftAt()).toEqual(at);
  });

  it("coming back to TravTrack clears it", async () => {
    await setLocationProvider(userId, "none");
    await setLocationProvider(userId, "travtrack");
    expect(await leftAt()).toBeNull();
  });
});
