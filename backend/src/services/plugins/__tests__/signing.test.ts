import { sign, signingString, verify, newSecret } from "../signing";

/**
 * Fixture vectors for the plugin signature (spec 2026-11-23-plugins-and-calendar.md):
 * the same vectors stand in docs/features/plugins.md and the template's test, so a
 * plugin author can check an implementation against them.
 */
const SECRET = "test-secret-0123456789abcdef0123456789";
const POST = {
  method: "POST",
  path: "/hooks/travstats?x=1",
  timestamp: 1763900000,
  requestId: "0b9f6a2e-4c1d-4e7a-9a53-2f1d6c8e7b10",
  body: '{"version":1}',
};

describe("plugin signature", () => {
  it("signs method, path with query, timestamp, request id and body, newline-joined", () => {
    expect(signingString(POST)).toBe(
      'POST\n/hooks/travstats?x=1\n1763900000\n0b9f6a2e-4c1d-4e7a-9a53-2f1d6c8e7b10\n{"version":1}'
    );
    expect(sign(SECRET, POST)).toBe(
      "v1=c1611e231a9667ee0bc0a11707bb4d8c49791ed150df97a7794e552469b68c2a"
    );
    expect(sign(SECRET, { ...POST, method: "get", path: "/", body: "" })).toBe(
      "v1=1627e12ac45195c6cbdc33e10e529d0d4eb962306cb1d9ecb9febf6a3a55ec5f"
    );
  });

  it.each([
    ["the method", { method: "PUT" }],
    ["the path", { path: "/hooks/other" }],
    ["the timestamp", { timestamp: 1763900001 }],
    ["the request id", { requestId: "11111111-1111-4111-8111-111111111111" }],
    ["the body", { body: '{"version":2}' }],
  ])("a change of %s breaks it", (_, change) => {
    expect(verify(SECRET, { ...POST, ...change }, sign(SECRET, POST), POST.timestamp)).toBe(false);
  });

  it("accepts within ±300 s and refuses outside", () => {
    const header = sign(SECRET, POST);
    expect(verify(SECRET, POST, header, POST.timestamp + 300)).toBe(true);
    expect(verify(SECRET, POST, header, POST.timestamp - 301)).toBe(false);
    expect(verify(SECRET, POST, undefined, POST.timestamp)).toBe(false);
  });

  it("makes 32-byte secrets", () => {
    expect(Buffer.from(newSecret(), "base64url")).toHaveLength(32);
    expect(newSecret()).not.toBe(newSecret());
  });
});
