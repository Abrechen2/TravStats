import http from "http";
import type { AddressInfo } from "net";
import { callPlugin, retryAfterMs, type PluginTarget } from "../client";
import { verify } from "../signing";

/**
 * The plugin call (spec 2026-11-23, P3): each failure reason surfaces as itself,
 * the answer is validated as untrusted input, and the request is signed.
 */
type Handler = (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void;
let handler: Handler;
let server: http.Server;
let base: string;
const SECRET = "s3cret-for-the-test";
const LAN = { allowPrivate: true };
const target = (path = "/hook", policy = LAN): PluginTarget => ({
  url: `${base}${path}`,
  secret: SECRET,
  policy,
});
const STOP = {
  kind: "stop" as const,
  locale: "de" as const,
  stop: {
    start: "2026-11-10T09:00:00.000Z",
    end: "2026-11-10T10:00:00.000Z",
    timeZone: "Europe/Berlin",
    lat: 48.69,
    lon: 9.31,
    precisionMeters: 100,
  },
};
const answer =
  (body: unknown, status = 200, headers: Record<string, string> = {}): Handler =>
  (_q, _b, res) => {
    res.writeHead(status, { "Content-Type": "application/json", ...headers });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
const ok = (over: Record<string, unknown> = {}) => ({
  name: "Musterfirma",
  confidence: 0.9,
  ...over,
});

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => handler(req, body, res));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => new Promise((r) => server.close(r)));

describe("callPlugin", () => {
  it("sends a signed request the plugin can verify, and reads the answer", async () => {
    let verified = false;
    handler = (req, body, res) => {
      const h = (n: string) => String(req.headers[n.toLowerCase()]);
      verified = verify(
        SECRET,
        {
          method: req.method!,
          path: req.url!,
          timestamp: Number(h("TravStats-Timestamp")),
          requestId: h("TravStats-Request-Id"),
          body,
        },
        h("TravStats-Signature")
      );
      expect(JSON.parse(body).requestId).toBe(h("TravStats-Request-Id"));
      expect(h("TravStats-Plugin-Version")).toBe("1");
      answer({
        version: 1,
        suggestions: [ok({ url: "https://example.com/p/1", extra: "ignored" })],
      })(req, body, res);
    };
    const r = await callPlugin(target("/hook?x=1"), STOP);
    expect(verified).toBe(true);
    expect(r).toMatchObject({ kind: "ok", version: 1, suggestions: [{ name: "Musterfirma" }] });
  });

  it.each([
    ["204", answer("", 204), "empty"],
    ["an empty list", answer({ version: 1, suggestions: [] }), "empty"],
  ])("%s is 'nothing here', a real answer", async (_, h, kind) => {
    handler = h;
    expect((await callPlugin(target(), STOP)).kind).toBe(kind);
  });

  it.each([
    ["an http url", { version: 1, suggestions: [ok({ url: "http://example.com" })] }],
    ["six suggestions", { version: 1, suggestions: Array.from({ length: 6 }, () => ok()) }],
    ["no confidence", { version: 1, suggestions: [{ name: "x" }] }],
    ["confidence above 1", { version: 1, suggestions: [ok({ confidence: 1.5 })] }],
    ["a purpose outside the two", { version: 1, suggestions: [ok({ purpose: "holiday" })] }],
    ["an unknown major", { version: 2, suggestions: [ok()] }],
    ["not JSON", "<html>"],
  ])("refuses %s as protocol", async (_, body) => {
    handler = answer(body);
    expect(await callPlugin(target(), STOP)).toMatchObject({ kind: "failed", reason: "protocol" });
  });

  it.each([
    [401, "auth"],
    [403, "auth"],
    [500, "server"],
    [503, "server"],
    [302, "protocol"],
    [418, "protocol"],
  ])("answers %i as %s", async (status, reason) => {
    handler = answer({}, status, status === 302 ? { Location: "http://169.254.169.254/" } : {});
    expect(await callPlugin(target(), STOP)).toMatchObject({ kind: "failed", reason });
  });

  it("honours Retry-After on 429", async () => {
    handler = answer({}, 429, { "Retry-After": "120" });
    const before = Date.now();
    const r = await callPlugin(target(), STOP);
    expect(r).toMatchObject({ kind: "failed", reason: "rateLimited" });
    expect((r as { retryAtMs: number }).retryAtMs).toBeGreaterThanOrEqual(before + 119_000);
    expect(retryAfterMs("Wed, 21 Oct 2015 07:28:00 GMT", 0)).toBe(
      Date.parse("2015-10-21T07:28:00Z")
    );
  });

  it("caps the answer at 64 KB", async () => {
    handler = answer({ version: 1, suggestions: [ok({ note: "x".repeat(70_000) })] });
    expect(await callPlugin(target(), STOP)).toMatchObject({ reason: "protocol" });
  });

  it("refuses a private target for an ordinary account, before connecting", async () => {
    handler = answer({ version: 1, suggestions: [] });
    expect(await callPlugin(target("/hook", { allowPrivate: false }), STOP)).toMatchObject({
      reason: "privateTarget",
    });
  });

  it("answers a closed port as unreachable", async () => {
    expect(
      await callPlugin({ url: "http://127.0.0.1:1/", secret: SECRET, policy: LAN }, STOP)
    ).toMatchObject({ reason: "unreachable" });
  });

  it("stops at 5 s", async () => {
    handler = (_q, _b, res) => setTimeout(() => res.end("{}"), 6000);
    const started = Date.now();
    expect(await callPlugin(target(), STOP)).toMatchObject({ reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(5800);
  }, 10_000);
});
