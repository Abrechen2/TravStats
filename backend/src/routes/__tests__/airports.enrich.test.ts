import request from "supertest";

/**
 * forgejo#407: POST /airports/enrich answered 404 "No matching airport found"
 * when the external sources could not be asked at all, so the admin button that
 * now calls it could not tell "no such airport" from "try again later".
 */
const lookupMock = jest.fn();
jest.mock("../../services/airportLookup", () => ({
  ...jest.requireActual("../../services/airportLookup"),
  lookupOrCreateAirport: (...args: unknown[]) => lookupMock(...args),
}));

import app from "../../index";
import { prisma } from "../../db";
import { hashPassword } from "../../utils/password";
import { generateToken } from "../../utils/jwt";

describe("POST /airports/enrich names why a code found nothing", () => {
  let userId: string;
  let cookie: string;

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: {
        username: `enrich-${Date.now()}`,
        passwordHash: await hashPassword("pw-123456"),
        isActive: true,
      },
    });
    userId = u.id;
    cookie = `auth_token=${generateToken(u.id)}`;
  });
  afterAll(async () => {
    await prisma.user.deleteMany({ where: { id: userId } });
  });
  beforeEach(() => lookupMock.mockReset());

  const post = (body: object) =>
    request(app).post("/api/v1/airports/enrich").set("Cookie", cookie).send(body);

  it("answers 503 AIRPORT_LOOKUP_UNAVAILABLE when no source could be asked, not 404", async () => {
    lookupMock.mockResolvedValue({ status: "unavailable", reason: "timeout" });
    const res = await post({ iata: "zzz" });
    expect(res.status).toBe(503);
    expect(res.body.code ?? res.body.error?.code).toBe("AIRPORT_LOOKUP_UNAVAILABLE");
    expect(lookupMock).toHaveBeenCalledWith("ZZZ");
  });

  it("still answers from the ICAO code when the IATA lookup could not be asked", async () => {
    lookupMock
      .mockResolvedValueOnce({ status: "unavailable", reason: "timeout" })
      .mockResolvedValueOnce({ status: "found", airport: { iata: "FRA" } });
    const res = await post({ iata: "FRA", icao: "EDDF" });
    expect(res.status).toBe(200);
    expect(lookupMock).toHaveBeenCalledTimes(2);
  });

  it("answers 404 when the sources were asked and know no such code", async () => {
    lookupMock.mockResolvedValue({ status: "not_found" });
    expect((await post({ iata: "ZZZ" })).status).toBe(404);
  });

  it("returns the airport once found", async () => {
    lookupMock.mockResolvedValue({ status: "found", airport: { iata: "FRA", name: "Frankfurt" } });
    const res = await post({ icao: "EDDF" });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ iata: "FRA" });
  });

  it("rejects a body with no code and no coordinates", async () => {
    expect((await post({})).status).toBe(400);
  });
});
