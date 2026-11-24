import { prisma } from "../../../db";
import { hashPassword } from "../../../utils/password";
import { encryptApiKey } from "../../../utils/encryption";
import { deletePlugin } from "../registry";

/**
 * rc.45 review: deleting a plugin removed only its `evidence.plugins` entries, so a
 * purpose it had suggested stayed on the finding, and `pluginsPending` kept owing an
 * answer from a plugin that no longer exists.
 */
describe("deletePlugin leaves nothing that names the plugin", () => {
  let userId: string;

  beforeAll(async () => {
    userId = (
      await prisma.user.create({
        data: {
          username: `plugin-delete-${Date.now()}`,
          passwordHash: await hashPassword("pw-12345678"),
        },
      })
    ).id;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const plugin = (name: string) =>
    prisma.suggestionPlugin.create({
      data: {
        userId,
        name,
        url: "https://plugin.example.com/hook",
        secretEncrypted: encryptApiKey("secret")!,
        precision: "100m",
      },
    });
  const finding = (fingerprint: string, evidence: Record<string, unknown>) =>
    prisma.dawarichStay.create({
      data: {
        userId,
        fingerprint,
        sourceStartAt: new Date("2026-11-10T10:00:00Z"),
        sourceEndAt: new Date("2026-11-10T11:00:00Z"),
        sourceLat: 52.5,
        sourceLon: 13.4,
        startAt: new Date("2026-11-10T10:00:00Z"),
        endAt: new Date("2026-11-10T11:00:00Z"),
        lat: 52.5,
        lon: 13.4,
        zone: "Europe/Berlin",
        pointCount: 10,
        provider: "travtrack",
        evidence,
      },
    });
  const evidenceOf = async (id: string) =>
    (await prisma.dawarichStay.findUniqueOrThrow({ where: { id } })).evidence as Record<
      string,
      unknown
    >;

  it("drops its suggested purpose and its pending-answer entries, and keeps another plugin's", async () => {
    const gone = await plugin("Weg");
    const kept = await plugin("Bleibt");
    const a = await finding("fp-a", {
      plugins: [{ pluginId: gone.id }, { pluginId: kept.id }],
      pluginsPending: [gone.id, kept.id],
      suggestedPurpose: "work",
      suggestedPurposeFrom: `plugin:${gone.id}`,
    });
    const b = await finding("fp-b", {
      pluginsPending: [gone.id],
      suggestedPurpose: "leisure",
      suggestedPurposeFrom: `plugin:${kept.id}`,
    });

    await deletePlugin(userId, gone.id);

    const ea = await evidenceOf(a.id);
    expect(ea.plugins).toEqual([{ pluginId: kept.id }]);
    expect(ea.pluginsPending).toEqual([kept.id]);
    expect(ea.suggestedPurpose).toBeUndefined();
    expect(ea.suggestedPurposeFrom).toBeUndefined();
    const eb = await evidenceOf(b.id);
    expect(eb.pluginsPending).toBeUndefined();
    expect(eb.suggestedPurposeFrom).toBe(`plugin:${kept.id}`);
  });
});
