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
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

const USERNAME = "lookup-provider-failed";

describe("GET /flight-lookup/:flightNumber — provider failure", () => {
  let cookie: string;

  // Only this suite's own rows: the backend suite runs files in parallel on
  // one database, so a bare userSettings.deleteMany() wiped other files'
  // settings mid-test.
  const clean = async (): Promise<void> => {
    await prisma.userSettings.deleteMany({ where: { user: { username: USERNAME } } });
    await prisma.user.deleteMany({ where: { username: USERNAME } });
  };

  beforeAll(async () => {
    await clean();
    // Created directly, not through /auth/register: with ALLOW_REGISTRATION
    // off in the test env, registration only succeeds for the FIRST user, so
    // this file failed with 403 whenever another file's user existed first.
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    cookie = `auth_token=${generateToken(user.id)}`;
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
