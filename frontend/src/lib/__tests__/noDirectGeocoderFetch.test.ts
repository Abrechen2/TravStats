import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * CSP regression guard (Task 6): the app's `connect-src 'self'` CSP forbids
 * the browser from fetching Photon/Nominatim directly — all geocoder traffic
 * must go through the backend's same-origin proxy (`lib/api/geo.ts`,
 * `GET /api/v1/geo/search`). `lib/nominatim.ts` used to violate this
 * (removed in Task 6, see `EventLocationPicker`); this scan keeps it from
 * silently coming back in a new file.
 *
 * Exemptions are allowed for files that reference geocoder hosts as UI
 * placeholder text only — verified to have NO fetch/axios calls to those hosts,
 * with the actual network transport going through lib/api modules instead.
 */

const SRC_ROOT = path.resolve(__dirname, "..", "..");
const FORBIDDEN_HOST = "nominatim.openstreetmap.org";

/**
 * Relative file paths (from SRC_ROOT) that are allowed to reference the
 * forbidden geocoder hosts. Each entry must include a comment explaining
 * why the exemption is safe (i.e., why the file is not a transport violation).
 */
const EXEMPTED_FILES = new Set([
  // GeocoderSettingsCard.tsx: references default URLs only as input placeholder
  // text for an admin settings form. All actual network calls (GET/PUT
  // instance settings, test via searchPlaces) go through lib/api/geo.ts
  // and adminApi, not direct browser fetches.
  "components/Settings/GeocoderSettingsCard.tsx",
]);

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "__tests__" || entry.name === "node_modules") continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...collectSourceFiles(fullPath));
    } else if (/\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

describe("no frontend source file fetches a geocoder directly", () => {
  it(`contains no reference to ${FORBIDDEN_HOST}`, () => {
    const offenders: string[] = [];
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const relPath = path.relative(SRC_ROOT, file).replace(/\\/g, "/");
      if (!EXEMPTED_FILES.has(relPath)) {
        const content = fs.readFileSync(file, "utf-8");
        if (content.includes(FORBIDDEN_HOST)) {
          offenders.push(relPath);
        }
      }
    }
    expect(offenders, `found ${FORBIDDEN_HOST} referenced in: ${offenders.join(", ")}`).toEqual([]);
  });
});
