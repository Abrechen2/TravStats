import { prisma } from "../../../db";
import { repointDecisionMembers } from "../decisionRepoint";

let userId: string;

beforeAll(async () => {
  userId = (
    await prisma.user.create({
      data: { username: `repoint-${Date.now()}`, passwordHash: "synthetic-test-hash" },
    })
  ).id;
});
afterAll(async () => {
  await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
});

describe("a duplicate-merge keeps trip-suggestion answers pointing at the kept record", () => {
  it("rewrites the removed copy's member key to the kept one, content keys aligned", async () => {
    await prisma.tripSuggestionDecision.create({
      data: {
        userId,
        kind: "new_trip",
        fingerprint: "new_trip:-:abc",
        status: "dismissed",
        memberKeys: ["flight:kept", "flight:gone", "lodging:x"],
        memberContentKeys: ["c1", "c2", "c3"],
      },
    });
    await prisma.$transaction((tx) =>
      repointDecisionMembers(tx, userId, "flight", "kept", ["gone"])
    );
    const row = await prisma.tripSuggestionDecision.findFirstOrThrow({ where: { userId } });
    expect(row.memberKeys).toEqual(["flight:kept", "lodging:x"]);
    expect(row.memberContentKeys).toEqual(["c1", "c3"]);
  });
});
