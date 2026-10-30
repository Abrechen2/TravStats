import request from "supertest";

/**
 * forgejo#385 (RULE-32): POST /flight-lookup/bulk read req.body unvalidated,
 * never passed the asker's id (their own keys were ignored) and turned a
 * provider outage into `success: true, flights: []`.
 */
const lookupMock = jest.fn();
jest.mock("../../services/flightLookup", () => ({
  ...jest.requireActual("../../services/flightLookup"),
  lookupFlightByNumber: (...args: unknown[]) => lookupMock(...args),
}));

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

const USERNAME = "lookup-bulk";

describe("POST /flight-lookup/bulk", () => {
  let cookie: string;
  let userId: string;

  beforeAll(async () => {
    await prisma.user.deleteMany({ where: { username: USERNAME } });
    const user = await prisma.user.create({
      data: { username: USERNAME, passwordHash: await hashPassword("password123") },
    });
    userId = user.id;
    cookie = `auth_token=${generateToken(user.id)}`;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  beforeEach(() => lookupMock.mockReset());

  const post = (body: unknown) =>
    request(app).post("/api/v1/flight-lookup/bulk").set("Cookie", cookie).send(body as object);

  it("rejects a body that is not { flightNumbers: string[] }", async () => {
    expect((await post({ flightNumbers: [1, 2] })).status).toBe(400);
    expect((await post({ flightNumbers: "LH400" })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ flightNumbers: Array(11).fill("LH400") })).status).toBe(400);
  });

  it("passes the asker's id so their own provider keys are used", async () => {
    lookupMock.mockResolvedValue([{ flightNumber: "LH400" }]);
    const res = await post({ flightNumbers: ["LH400"] });
    expect(res.status).toBe(200);
    expect(lookupMock.mock.calls[0][2]).toBe(userId);
  });

  it("reports a provider failure as a failure, not as an empty success", async () => {
    lookupMock.mockImplementation(
      async (_n: string, _d: unknown, _u: string, outcomes: { record: Function }) => {
        outcomes.record("airlabs", "quota");
        return [];
      }
    );
    const res = await post({ flightNumbers: ["LH400"] });
    expect(res.body.results[0]).toMatchObject({
      flightNumber: "LH400",
      success: false,
      error: "LOOKUP_PROVIDER_FAILED",
      providerFailures: [{ provider: "airlabs", outcome: "quota" }],
    });
  });
});
