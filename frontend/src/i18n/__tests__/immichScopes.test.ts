import { describe, it, expect } from "vitest";
import de from "../resources/de/immich.json";
import en from "../resources/en/immich.json";

/**
 * The permissions TravStats actually needs, read off Immich's own
 * `@Authenticated({ permission })` decorators against the calls in
 * `backend/src/services/immich/immichClient.ts`:
 *
 *   GET  /users/me             -> user.read      (connection test)
 *   GET  /albums               -> album.read     (album list)
 *   POST /search/metadata      -> asset.read     (album CONTENTS)
 *   GET  /assets/:id/thumbnail -> asset.view     (gallery tiles)
 *   GET  /assets/:id/original  -> asset.download (lightbox + import mode)
 *
 * Alex reported (#154) that `album.read` alone fails, which is exactly what
 * this list explains: album contents come from search/metadata, not from
 * /albums/:id, so they sit behind the ASSET permissions.
 */
const REQUIRED_SCOPES = [
  "album.read",
  "asset.read",
  "asset.view",
  "asset.download",
  "user.read",
] as const;

describe("Immich API key scope hint", () => {
  for (const [lang, bundle] of [
    ["de", de],
    ["en", en],
  ] as const) {
    it(`names every required permission in ${lang}`, () => {
      const hint = (bundle as Record<string, unknown>).apiKeyScopes;
      expect(typeof hint).toBe("string");
      for (const scope of REQUIRED_SCOPES) {
        expect(hint as string).toContain(scope);
      }
    });

    it(`does not promise a permission we never use in ${lang}`, () => {
      const hint = (bundle as Record<string, unknown>).apiKeyScopes as string;
      // asset.upload / album.create would be write access — asking a user for
      // more than we need is exactly the complaint being fixed here.
      expect(hint).not.toContain("asset.upload");
      expect(hint).not.toContain("album.create");
    });
  }
});
