import { describe, it, expect } from "@jest/globals";
import { normalizeImmichBaseUrl } from "../services/immich/types";
import { ImmichError } from "../services/immich/types";
import {
  linkAlbumsSchema,
  immichConnectionSchema,
  immichTestSchema,
  assetSizeSchema,
} from "../schemas/immich";

describe("normalizeImmichBaseUrl", () => {
  it("strips trailing slashes and keeps scheme + host + port", () => {
    expect(normalizeImmichBaseUrl("https://immich.home.lan/")).toBe("https://immich.home.lan");
    expect(normalizeImmichBaseUrl("http://192.168.1.5:2283//")).toBe("http://192.168.1.5:2283");
  });

  it("preserves a sub-path prefix (reverse-proxy installs)", () => {
    expect(normalizeImmichBaseUrl("https://home.lan/immich/")).toBe("https://home.lan/immich");
  });

  it("rejects non-http(s) schemes", () => {
    expect(() => normalizeImmichBaseUrl("file:///etc/passwd")).toThrow(ImmichError);
    expect(() => normalizeImmichBaseUrl("ftp://host")).toThrow(ImmichError);
  });

  it("rejects unparseable input", () => {
    expect(() => normalizeImmichBaseUrl("not a url")).toThrow(ImmichError);
    expect(() => normalizeImmichBaseUrl("")).toThrow(ImmichError);
  });

  it("strips embedded credentials, query and hash", () => {
    expect(normalizeImmichBaseUrl("https://u:p@immich.lan/?a=1#x")).toBe("https://immich.lan");
  });
});

describe("immichConnectionSchema", () => {
  it("accepts a partial update", () => {
    expect(immichConnectionSchema.parse({ defaultMode: "import" })).toEqual({
      defaultMode: "import",
    });
  });

  it("rejects an unknown mode", () => {
    expect(() => immichConnectionSchema.parse({ defaultMode: "copy" })).toThrow();
  });

  it("accepts an explicit null apiKey (clearing the key)", () => {
    expect(immichConnectionSchema.parse({ apiKey: null })).toEqual({ apiKey: null });
  });
});

describe("immichTestSchema", () => {
  it("accepts an empty body (test whatever is resolved for me)", () => {
    expect(immichTestSchema.parse({})).toEqual({});
  });

  it("coerces an empty-string baseUrl to undefined so the route falls back", () => {
    // The card always SENDS baseUrl; when the user has no own connection it
    // sends "". That must mean 'use the resolved connection', not a 400.
    expect(immichTestSchema.parse({ baseUrl: "" })).toEqual({});
  });

  it("coerces empty-string baseUrl AND apiKey to undefined", () => {
    expect(immichTestSchema.parse({ baseUrl: "", apiKey: "" })).toEqual({});
  });

  it("keeps an explicitly supplied pair intact", () => {
    expect(immichTestSchema.parse({ baseUrl: "https://immich.lan", apiKey: "k" })).toEqual({
      baseUrl: "https://immich.lan",
      apiKey: "k",
    });
  });

  it("rejects an unknown field (strict)", () => {
    expect(() => immichTestSchema.parse({ sneaky: "x" })).toThrow();
  });
});

describe("linkAlbumsSchema", () => {
  it("accepts a non-empty list of album+mode pairs", () => {
    const parsed = linkAlbumsSchema.parse({
      albums: [
        { immichAlbumId: "a", mode: "link" },
        { immichAlbumId: "b", mode: "import" },
      ],
    });
    expect(parsed.albums).toHaveLength(2);
  });

  it("rejects an empty list", () => {
    expect(() => linkAlbumsSchema.parse({ albums: [] })).toThrow();
  });

  it("rejects more than 50 albums in one request", () => {
    const albums = Array.from({ length: 51 }, (_, i) => ({
      immichAlbumId: `a${i}`,
      mode: "link" as const,
    }));
    expect(() => linkAlbumsSchema.parse({ albums })).toThrow();
  });
});

describe("assetSizeSchema", () => {
  it("defaults to thumbnail", () => {
    expect(assetSizeSchema.parse(undefined)).toBe("thumbnail");
  });

  it("rejects an arbitrary size", () => {
    expect(() => assetSizeSchema.parse("huge")).toThrow();
  });
});
