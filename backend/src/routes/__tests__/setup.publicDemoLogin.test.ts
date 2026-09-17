import request from "supertest";
import app from "../../index";

// A first install seeds demo/demo123 too, so the flag — not the existence of
// the account — decides whether the login page may print the credentials.
describe("GET /setup/status carries the public demo login flag", () => {
  const original = process.env.PUBLIC_DEMO_LOGIN;
  afterEach(() => {
    if (original === undefined) delete process.env.PUBLIC_DEMO_LOGIN;
    else process.env.PUBLIC_DEMO_LOGIN = original;
  });

  it("is false unless the instance opts in", async () => {
    delete process.env.PUBLIC_DEMO_LOGIN;
    const res = await request(app).get("/api/v1/setup/status");
    expect(res.status).toBe(200);
    expect(res.body.publicDemoLogin).toBe(false);
  });

  it("is true with PUBLIC_DEMO_LOGIN=true", async () => {
    process.env.PUBLIC_DEMO_LOGIN = "true";
    const res = await request(app).get("/api/v1/setup/status");
    expect(res.body.publicDemoLogin).toBe(true);
  });
});
