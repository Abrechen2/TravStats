import { randomUUID } from "node:crypto";
import { prisma } from "../../../db";
import { createPlan, writePlan, reserveUsage } from "../store";
import { assertAnchorsCurrent } from "../anchors";
import { generateProposal } from "../ai";
import { resolveLlmChain, llmGenerate } from "../../llm/llmProvider";
import { withLlmRequestPolicy, permitsLlmTarget } from "../../llm/requestPolicy";
jest.mock("../../llm/llmGate", () => ({ assertLlmEnabled: jest.fn() }));
jest.mock("../../llm/llmProvider", () => ({
  resolveLlmChain: jest.fn(),
  llmGenerate: jest.fn(),
  describeLlmTarget: () => ({ kind: "ollama", model: "test" }),
}));
const chain = jest.mocked(resolveLlmChain),
  generate = jest.mocked(llmGenerate);
let userId: string;
beforeEach(async () => {
  userId = (
    await prisma.user.create({
      data: { username: "ai-plan-" + randomUUID(), passwordHash: "not-a-password" },
    })
  ).id;
  await prisma.travelPlanConfig.upsert({
    where: { id: "default" },
    create: { enabled: true },
    update: { enabled: true },
  });
  chain.mockResolvedValue([
    { kind: "openai", url: "https://example.com", model: "cloud", isCloud: true },
    { url: "http://localhost:11434", model: "local", isCloud: false },
  ]);
  generate.mockReset();
});
afterAll(async () => {
  await prisma.$disconnect();
});
async function plan() {
  return createPlan(userId, {
    name: "AI trip",
    clientRef: randomUUID(),
    settings: { destination: "Madeira", ai: { enabled: true, policy: "local_only" } },
  });
}
it("uses only the local target, excludes notes and references and adds ideas only after acceptance", async () => {
  const p = await plan();
  generate.mockResolvedValue(
    JSON.stringify({
      summary: "Research",
      assumptions: ["Verify availability"],
      ideas: [
        { title: "A coastal walk", note: "Check access before planning", category: "nature" },
      ],
      changes: [],
    })
  );
  const proposal = await generateProposal(userId, p.tripId, "Ideas please");
  expect(generate.mock.calls[0][0].model).toBe("local");
  const prompt = JSON.parse(generate.mock.calls[0][1].prompt);
  expect(prompt).not.toHaveProperty("documents");
  expect(prompt).not.toHaveProperty("bookings");
  expect((await prisma.travelPlan.findUniqueOrThrow({ where: { id: p.id } })).state).toEqual(
    p.state
  );
  const accepted = await writePlan(userId, p.tripId, {
    baseRevision: p.revision,
    clientRef: randomUUID(),
    operation: { type: "proposal", proposalId: proposal.id },
  });
  expect(accepted.state.ideas).toHaveLength(1);
  expect(accepted.state.items).toHaveLength(0);
});
it("never falls back to cloud when local-only has no allowed provider", async () => {
  const p = await plan();
  chain.mockResolvedValue([
    { kind: "openai", url: "https://example.com", model: "cloud", isCloud: true },
  ]);
  await expect(generateProposal(userId, p.tripId, "Help")).rejects.toMatchObject({
    code: "PLAN_AI_UNAVAILABLE",
  });
  expect(generate).not.toHaveBeenCalled();
});
it("does not call a provider without consent", async () => {
  const p = await createPlan(userId, { name: "No AI", clientRef: randomUUID() });
  await expect(generateProposal(userId, p.tripId, "Help")).rejects.toMatchObject({
    code: "PLAN_AI_CONSENT",
  });
  expect(generate).not.toHaveBeenCalled();
});
it("rejects malformed model output without changing a plan", async () => {
  const p = await plan();
  generate.mockResolvedValue("not json");
  await expect(generateProposal(userId, p.tripId, "Help")).rejects.toMatchObject({
    code: "PLAN_AI_INVALID",
  });
  expect(await prisma.travelPlanProposal.count({ where: { planId: p.id } })).toBe(0);
});
it("reserves the daily limit atomically for concurrent requests", async () => {
  const results = await Promise.allSettled(
    Array.from({ length: 6 }, () => reserveUsage(userId, "ai", 2))
  );
  expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
});
it("isolates concurrent request policies across awaits", async () => {
  const target = { url: "https://example.com", isCloud: true };
  const results = await Promise.all(
    ["disabled", "local_only", "cloud_allowed"].map((policy) =>
      withLlmRequestPolicy(policy as "disabled" | "local_only" | "cloud_allowed", async () => {
        await Promise.resolve();
        return permitsLlmTarget(target);
      })
    )
  );
  expect(results).toEqual([false, false, true]);
  expect(permitsLlmTarget(target)).toBe(true);
});

it("invalidates planning help when a source booking changed outside the plan", async () => {
  const p = await plan(),
    flight = await prisma.flight.create({
      data: {
        userId,
        tripId: p.tripId,
        depLat: 1,
        depLon: 1,
        arrLat: 2,
        arrLon: 2,
        status: "scheduled",
      },
    });
  const state = {
    ...p.state,
    items: [
      {
        id: randomUUID(),
        title: "A fixed flight",
        kind: "flight" as const,
        day: null,
        time: null,
        duration: null,
        timezone: null,
        place: "",
        note: "",
        booked: true,
        bookingId: null,
        stationId: null,
        execution: "unconfirmed" as const,
        source: { kind: "existing:flight", id: flight.id, version: flight.updatedAt.toISOString() },
      },
    ],
  };
  await assertAnchorsCurrent(prisma, userId, p.tripId, state);
  await prisma.flight.update({ where: { id: flight.id }, data: { flightNumber: "LH117" } });
  await expect(assertAnchorsCurrent(prisma, userId, p.tripId, state)).rejects.toMatchObject({
    code: "PLAN_ANCHOR_STALE",
  });
});
