import {
  API_TOKEN_PREFIX,
  generateApiToken,
  isApiTokenScope,
  looksLikeApiToken,
  tokenLookupHash,
  verifyApiToken,
} from "../utils/apiTokens";

/**
 * Pure unit tests for the PAT crypto helpers — no DB required.
 * The integration story (middleware → DB lookup → req.apiToken) is
 * covered by the route tests separately; here we just pin the
 * properties of the token primitives that the rest of the system
 * relies on.
 */

describe("apiTokens util", () => {
  it("generates tokens with the ts_pat_ prefix", async () => {
    const tok = await generateApiToken();
    expect(tok.plaintext.startsWith(API_TOKEN_PREFIX)).toBe(true);
    expect(tok.plaintext.length).toBe(API_TOKEN_PREFIX.length + 64);
    expect(tok.lookupHash).toMatch(/^[0-9a-f]{64}$/);
    expect(tok.hash.startsWith("$2")).toBe(true);
  });

  it("produces unique tokens across calls", async () => {
    const a = await generateApiToken();
    const b = await generateApiToken();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.lookupHash).not.toBe(b.lookupHash);
    expect(a.hash).not.toBe(b.hash);
  });

  it("verifies a token against its bcrypt hash", async () => {
    const tok = await generateApiToken();
    expect(await verifyApiToken(tok.plaintext, tok.hash)).toBe(true);
    expect(await verifyApiToken(tok.plaintext + "x", tok.hash)).toBe(false);
  });

  it("lookupHash is deterministic for a given plaintext", async () => {
    const tok = await generateApiToken();
    expect(tokenLookupHash(tok.plaintext)).toBe(tok.lookupHash);
  });

  it("looksLikeApiToken rejects garbage and accepts well-formed tokens", async () => {
    const tok = await generateApiToken();
    expect(looksLikeApiToken(tok.plaintext)).toBe(true);
    expect(looksLikeApiToken("Bearer foo")).toBe(false);
    expect(looksLikeApiToken("ts_pat_short")).toBe(false);
    expect(looksLikeApiToken("ghp_" + "a".repeat(64))).toBe(false);
    expect(looksLikeApiToken(API_TOKEN_PREFIX + "z".repeat(64))).toBe(false); // non-hex
  });

  it("isApiTokenScope narrows the union", () => {
    expect(isApiTokenScope("read")).toBe(true);
    expect(isApiTokenScope("write")).toBe(true);
    expect(isApiTokenScope("admin")).toBe(true);
    expect(isApiTokenScope("superuser")).toBe(false);
    expect(isApiTokenScope(null)).toBe(false);
  });
});
