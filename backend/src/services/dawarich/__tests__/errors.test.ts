import { describe, it, expect } from "@jest/globals";
import { DawarichError, normalizeDawarichBaseUrl } from "../errors";

describe("normalizeDawarichBaseUrl", () => {
  it("strips a trailing slash", () => {
    expect(normalizeDawarichBaseUrl("https://dawarich.lan/")).toBe("https://dawarich.lan");
  });

  it("keeps a sub-path (reverse-proxy install) but strips its trailing slash", () => {
    expect(normalizeDawarichBaseUrl("https://host/dawarich/")).toBe("https://host/dawarich");
  });

  it("accepts a plain private-LAN http address without any egress block", () => {
    // Deliberate non-restriction — see the comment on normalizeDawarichBaseUrl.
    expect(normalizeDawarichBaseUrl("http://192.168.1.50:3000")).toBe(
      "http://192.168.1.50:3000",
    );
  });

  it("rejects a non-http(s) scheme as invalidUrl", () => {
    expect(() => normalizeDawarichBaseUrl("file:///etc/passwd")).toThrow(DawarichError);
    try {
      normalizeDawarichBaseUrl("file:///etc/passwd");
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DawarichError);
      expect((error as DawarichError).kind).toBe("invalidUrl");
    }
  });

  it("rejects a malformed URL as invalidUrl", () => {
    try {
      normalizeDawarichBaseUrl("not a url at all");
      throw new Error("expected to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(DawarichError);
      expect((error as DawarichError).kind).toBe("invalidUrl");
    }
  });
});
