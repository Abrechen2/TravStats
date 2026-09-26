import request from "supertest";

/**
 * Silent-failure review 2026-09-26, finding 6, the route half: a lookup that
 * came back empty because a provider FAILED must not be answered with the
 * "No flights found" the client renders as "check your flight number".
 */
const lookupMock = jest.fn();
jest.mock("../../services/flightLookup", () => ({
  ...jest.requireActual("../../services/flightLookup"),
  lookupFlightWithHistorical: (...args: unknown[]) => lookupMock(...args),
}));

import app from "../../index";
import { prisma } from "../../db";

describe("GET /flight-lookup/:flightNumber — provider failure", () => {
  let cookie: string[];

  const clean = async (): Promise<void> => {
    await prisma.userSettings.deleteMany();
    await prisma.user.deleteMany({ where: { username: "lookup-provider-failed" } });
  };

  beforeAll(async () => {
    await clean();
    const registration = await request(app)
      .post("/api/v1/auth/register")
      .send({ username: "lookup-provider-failed", password: "password123" })
      .expect(201);
    cookie = registration.headers["set-cookie"] as unknown as string[];
  });

  afterAll(async () => {
    await clean();
    await prisma.$disconnect();
  });

  it("answers LOOKUP_PROVIDER_FAILED with the provider and the reason", async () => {
    lookupMock.mockResolvedValue({
      flights: [],
      unavailableReason: "provider_failed",
      providerFailures: [{ provider: "airlabs", outcome: "quota" }],
    });

    const res = await request(app)
      .get("/api/v1/flight-lookup/LH400")
      .query({ date: "2026-09-26", tz: "Europe/Berlin" })
      .set("Cookie", cookie)
      .expect(200);

    expect(res.body).toMatchObject({
      success: false,
      error: "LOOKUP_PROVIDER_FAILED",
      providerFailures: [{ provider: "airlabs", outcome: "quota" }],
    });
    // The asker's zone reaches the service, which decides "today" with it.
    expect(lookupMock.mock.calls[0][4]).toEqual({ clientTimezone: "Europe/Berlin" });
  });
});
