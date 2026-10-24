import { prisma } from "../../../db";
import { AppError } from "../../../middleware/errorHandler";
import { createOnce, payloadHash } from "../clientRef";

/**
 * Two overlapping sends of one create with one clientRef (Codex review of
 * S1, finding 3). Both pass the first key lookup; the first commits its row
 * and its key; the second then meets that row in the route's own dedup
 * ("already imported", "duplicate" — returned or thrown) without ever
 * reaching the key. The promise is the replay of the first send's row, 200,
 * not a 409 about the retry's own first attempt.
 *
 * The first send is played by writing its key row from inside the second's
 * create, which is exactly the interleaving the race produces.
 */

const USERNAME = `clientref-race-${Date.now()}`;
const PAYLOAD = { name: "Ostsee", day: "2026-07-01" };

describe("createOnce — a retry that lost the race to itself", () => {
  let userId: string;

  beforeAll(async () => {
    userId = (await prisma.user.create({ data: { username: USERNAME, passwordHash: "synthetic" } }))
      .id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
  });

  const firstSendCommits = (clientRef: string, entityId: string) =>
    prisma.clientWriteRef.create({
      data: { userId, clientRef, kind: "cruise", entityId, payloadHash: payloadHash(PAYLOAD) },
    });

  const replay = async (entityId: string) => ({ replayed: entityId });

  it("a dedup answer RETURNED by the route becomes the replay of the winner's row", async () => {
    const outcome = await createOnce<{ replayed?: string; alreadyImported?: string }>({
      userId,
      clientRef: "race-returned",
      kind: "cruise",
      payload: PAYLOAD,
      create: async () => {
        await firstSendCommits("race-returned", "cruise-1");
        return { alreadyImported: "cruise-1" };
      },
      replay,
    });
    expect(outcome).toEqual({ created: false, result: { replayed: "cruise-1" } });
  });

  it("a dedup refusal THROWN by the route becomes the replay of the winner's row", async () => {
    const outcome = await createOnce<{ replayed?: string }>({
      userId,
      clientRef: "race-thrown",
      kind: "cruise",
      payload: PAYLOAD,
      create: async () => {
        await firstSendCommits("race-thrown", "cruise-2");
        throw new AppError("Duplicate", 409, "DUPLICATE");
      },
      replay,
    });
    expect(outcome).toEqual({ created: false, result: { replayed: "cruise-2" } });
  });

  it("without a winner the route's own dedup answer stands", async () => {
    const outcome = await createOnce<{ replayed?: string; alreadyImported?: string }>({
      userId,
      clientRef: "no-race",
      kind: "cruise",
      payload: PAYLOAD,
      create: async () => ({ alreadyImported: "older-import" }),
      replay: async () => null,
    });
    expect(outcome).toEqual({ created: true, result: { alreadyImported: "older-import" } });

    await expect(
      createOnce({
        userId,
        clientRef: "no-race-thrown",
        kind: "cruise",
        payload: PAYLOAD,
        create: async () => {
          throw new AppError("Duplicate", 409, "DUPLICATE");
        },
        replay: async () => null,
      })
    ).rejects.toMatchObject({ code: "DUPLICATE" });
  });

  it("a winner with a different body is still CLIENT_REF_REUSED", async () => {
    await expect(
      createOnce<{ replayed?: string; alreadyImported?: string }>({
        userId,
        clientRef: "race-other-body",
        kind: "cruise",
        payload: { ...PAYLOAD, name: "Nordsee" },
        create: async () => {
          await firstSendCommits("race-other-body", "cruise-3");
          return { alreadyImported: "cruise-3" };
        },
        replay,
      })
    ).rejects.toMatchObject({ statusCode: 409, code: "CLIENT_REF_REUSED" });
  });
});
