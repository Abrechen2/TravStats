import request from "supertest";
import app from "../../index";

/**
 * `/api/v1/version` names the tzdata release the server converts times with
 * (ADR 0002 D3), so a client — the Companion runs on Hermes with its own
 * zone data — can tell when the two disagree after a political zone change.
 * Public: read before login, like the rest of the endpoint.
 */
jest.mock("../../services/updateChecker", () => ({
  getCachedLatestRelease: jest.fn().mockResolvedValue(null),
  isUpdateAvailable: jest.fn().mockReturnValue(false),
}));

describe("GET /api/v1/version", () => {
  it("reports the runtime's tzdata release without a token", async () => {
    const res = await request(app).get("/api/v1/version");
    expect(res.status).toBe(200);
    expect(res.body.tzdata).toBe(process.versions.tz);
    expect(res.body.tzdata).toMatch(/^\d{4}[a-z]$/);
    // The fields the About section already read are unchanged.
    expect(res.body).toEqual(
      expect.objectContaining({ latestAvailable: null, updateAvailable: false })
    );
    expect(typeof res.body.version).toBe("string");
  });
});
