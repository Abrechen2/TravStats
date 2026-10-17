import request from "supertest";
import app from "../../index";
import { prisma } from "../../db";

/**
 * The inbox suggestion switches on `/settings` (forgejo#306): flat columns,
 * nested in the API as `tripSuggestions` and `staySuggestions`. GET reports
 * them with their defaults, PUT writes only the keys it names.
 */
describe("settings — inbox suggestion switches", () => {
  let cookie: string[];
  let userId: string;
  const username = `suggestion-switches-${Date.now()}`;

  beforeEach(async () => {
    await prisma.user.deleteMany({ where: { username } });
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ username, password: "password123" });
    // The instance's first account may be told to change its password; either
    // answer carries the session cookie this test needs.
    expect([200, 201]).toContain(registration.status);
    cookie = [registration.headers["set-cookie"]].flat();
    userId = (await prisma.user.findUniqueOrThrow({ where: { username } })).id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { username } });
    await prisma.$disconnect();
  });

  it("GET reports the defaults: both on, Immich evidence on, LLM classification off", async () => {
    const res = await request(app).get("/api/v1/settings").set("Cookie", cookie).expect(200);
    expect(res.body.tripSuggestions).toEqual({ enabled: true });
    expect(res.body.staySuggestions).toEqual({
      enabled: true,
      immichEvidence: true,
      llmPlaceClassification: false,
    });
  });

  it("PUT persists each switch to its column and echoes it back", async () => {
    const put = await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({
        tripSuggestions: { enabled: false },
        staySuggestions: { enabled: false, immichEvidence: false, llmPlaceClassification: true },
      })
      .expect(200);
    expect(put.body.tripSuggestions).toEqual({ enabled: false });
    expect(put.body.staySuggestions).toEqual({
      enabled: false,
      immichEvidence: false,
      llmPlaceClassification: true,
    });
    const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    expect(row).toMatchObject({
      tripSuggestionsEnabled: false,
      staySuggestionsEnabled: false,
      staySuggestionsImmichEvidence: false,
      staySuggestionsLlmPlaceClassification: true,
    });
    // Columns, not the JSON blob: a stale blob key must never shadow them.
    expect(row.data).not.toHaveProperty("tripSuggestions");
    expect(row.data).not.toHaveProperty("staySuggestions");
  });

  it("a PUT naming one switch leaves the others alone", async () => {
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ staySuggestions: { enabled: false } })
      .expect(200);
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ tripSuggestions: { enabled: false } })
      .expect(200);
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ display: { theme: "dark" } })
      .expect(200);
    const row = await prisma.userSettings.findUniqueOrThrow({ where: { userId } });
    expect(row.staySuggestionsEnabled).toBe(false);
    expect(row.tripSuggestionsEnabled).toBe(false);
    expect(row.staySuggestionsImmichEvidence).toBe(true);
  });

  it("rejects an unknown key inside a switch group", async () => {
    await request(app)
      .put("/api/v1/settings")
      .set("Cookie", cookie)
      .send({ staySuggestions: { enabled: false, everything: true } })
      .expect(400);
  });
});
