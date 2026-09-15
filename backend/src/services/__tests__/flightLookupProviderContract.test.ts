/**
 * The contract between `apiKeyResolver` and the provider calls in
 * `flightLookup`. Three findings from the 2026-09-09 audit lived in that seam,
 * all of them invisible to a type check and to every existing test:
 *
 *  - **AUD-100** the AirLabs fallback dropped `userId`, so a personal key was
 *    never resolved;
 *  - **AUD-101** the resolver returns `username`/`password` while the header
 *    builder read `user`/`pass`, so basic auth never produced a header;
 *  - **AUD-102** one process-wide OAuth token slot handed the first caller's
 *    token to everyone else.
 *
 * Each is asserted at the boundary that actually decides the behaviour — which
 * key was resolved, which header went out, how many tokens were minted —
 * rather than on a lookup result, because a null result has many causes and
 * would not tell these three apart.
 */
import axios from "axios";

jest.mock("axios");
jest.mock("../apiKeyResolver", () => ({
  getApiKey: jest.fn(async () => null),
  getOpenSkyCredentials: jest.fn(async () => null),
}));
jest.mock("../airportLookup", () => ({
  findOrCreateAirport: jest.fn(async () => null),
}));
jest.mock("../aerodataboxLookup", () => ({
  lookupFlightAerodatabox: jest.fn(async () => null),
}));

const resolver = jest.requireMock("../apiKeyResolver") as {
  getApiKey: jest.Mock;
  getOpenSkyCredentials: jest.Mock;
};
const mockedAxios = axios as jest.Mocked<typeof axios>;

import { lookupFlightDetails } from "../flightLookup";

/** Every OpenSky GET the code made, with the headers it carried. */
function openSkyCalls(): { url: string; headers: Record<string, string> }[] {
  return mockedAxios.get.mock.calls
    .map((c) => ({
      url: String(c[0]),
      headers: ((c[1] as { headers?: Record<string, string> })?.headers ?? {}),
    }))
    .filter((c) => c.url.includes("opensky"));
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.resetModules();
  resolver.getApiKey.mockResolvedValue(null);
  resolver.getOpenSkyCredentials.mockResolvedValue(null);
  mockedAxios.get.mockResolvedValue({ data: {} });
  mockedAxios.post.mockResolvedValue({ data: {} });
});

describe("AUD-100 — the AirLabs fallback keeps the user's context", () => {
  it("resolves the airlabs key FOR THE CALLER, not for nobody", async () => {
    await lookupFlightDetails("LH400", "2026-06-01", "user-42");

    const airlabsCalls = resolver.getApiKey.mock.calls.filter((c) => c[0] === "airlabs");
    expect(airlabsCalls.length).toBeGreaterThan(0);
    // The regression: every airlabs resolution must carry the user id. With it
    // dropped, a personal key is invisible and the lookup silently falls back
    // to the global key — or, where only a personal key exists, to none.
    for (const call of airlabsCalls) {
      expect(call[1]).toBe("user-42");
    }
  });
});

describe("AUD-101 — stored basic credentials actually reach OpenSky", () => {
  it("sends a Basic header for a username/password pair", async () => {
    // Exactly the shape `getOpenSkyCredentials` returns.
    resolver.getOpenSkyCredentials.mockResolvedValue({
      username: "sky-user",
      password: "sky-pass",
    });

    await lookupFlightDetails("LH400", "2026-06-01", "user-42");

    const calls = openSkyCalls();
    // Before the fix the header builder read `user`/`pass`, which are never
    // set, returned null, and OpenSky was never contacted at all.
    expect(calls.length).toBeGreaterThan(0);
    const auth = calls[0].headers.Authorization;
    expect(auth).toBe(`Basic ${Buffer.from("sky-user:sky-pass").toString("base64")}`);
  });

  it("does not mint an OAuth token when only basic credentials exist", async () => {
    resolver.getOpenSkyCredentials.mockResolvedValue({
      username: "sky-user",
      password: "sky-pass",
    });

    await lookupFlightDetails("LH400", "2026-06-01", "user-42");

    expect(mockedAxios.post).not.toHaveBeenCalled();
  });
});

describe("AUD-102 — an OAuth token belongs to the credential that minted it", () => {
  // The token cache is module state and deliberately outlives a single lookup,
  // so `jest.resetModules()` does not clear it for an already-imported module.
  // Each test therefore uses client ids of its own; sharing them would let one
  // test's cached token answer the next one's first lookup.
  let seq = 0;
  const ids = () => {
    seq += 1;
    return { a: `client-${seq}-a`, b: `client-${seq}-b` };
  };

  /** Hand out a distinct token per client id so a reused one is visible. */
  function tokenPerClient() {
    mockedAxios.post.mockImplementation(async (_url: string, body: unknown) => {
      const clientId = new URLSearchParams(String(body)).get("client_id");
      return { data: { access_token: `token-for-${clientId}`, expires_in: 1800 } };
    });
  }

  it("mints a separate token for a second, different credential", async () => {
    tokenPerClient();

    const { a, b } = ids();
    resolver.getOpenSkyCredentials.mockResolvedValue({ clientId: a, clientSecret: "secret-a" });
    await lookupFlightDetails("LH400", "2026-06-01", "user-a");

    resolver.getOpenSkyCredentials.mockResolvedValue({ clientId: b, clientSecret: "secret-b" });
    await lookupFlightDetails("LH401", "2026-06-01", "user-b");

    // The regression: a single process-wide slot answered the second user with
    // the first user's token, spending a stranger's quota under their account.
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);

    const bearers = openSkyCalls().map((c) => c.headers.Authorization);
    expect(bearers).toContain(`Bearer token-for-${a}`);
    expect(bearers).toContain(`Bearer token-for-${b}`);
  });

  it("still reuses the token for the SAME credential", async () => {
    tokenPerClient();
    const { a } = ids();
    resolver.getOpenSkyCredentials.mockResolvedValue({ clientId: a, clientSecret: "secret-a" });

    await lookupFlightDetails("LH400", "2026-06-01", "user-a");
    await lookupFlightDetails("LH401", "2026-06-01", "user-a");

    // The cache must still be a cache — one token request, not one per lookup.
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
  });

  it("mints a fresh token when the secret is rotated under the same client id", async () => {
    tokenPerClient();

    const { a } = ids();
    resolver.getOpenSkyCredentials.mockResolvedValue({ clientId: a, clientSecret: "secret-old" });
    await lookupFlightDetails("LH400", "2026-06-01", "user-a");

    resolver.getOpenSkyCredentials.mockResolvedValue({ clientId: a, clientSecret: "secret-new" });
    await lookupFlightDetails("LH401", "2026-06-01", "user-a");

    // Keying on the client id alone would serve a token minted with the old
    // secret until it expired — the "credential change is ignored" half of the
    // finding.
    expect(mockedAxios.post).toHaveBeenCalledTimes(2);
  });
});
