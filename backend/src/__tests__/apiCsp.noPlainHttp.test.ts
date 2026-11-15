import request from "supertest";
import app from "../index";

/** forgejo#415 N8: the API's Helmet CSP offers no plain http:/ws: source either. */
describe("API Content-Security-Policy", () => {
  it("allows neither http: nor ws: sources", async () => {
    const res = await request(app).get("/api/v1/health");
    const csp = String(res.headers["content-security-policy"] ?? "");
    expect(csp).not.toBe("");
    const tokens = csp.split(/[\s;]+/);
    expect(tokens).not.toContain("http:");
    expect(tokens).not.toContain("ws:");
  });
});
