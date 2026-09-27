import { describe, it, expect, afterEach } from "@jest/globals";

import { prisma } from "../../../db";
import { foldStationName } from "../../../services/rail/railStations";
import { loadStations, nearbyStationId } from "../context";
import { STATIONS } from "../data/stations";

/**
 * Regression for the realistic demo's rail-station linking, measured on a
 * fresh install (2026-09-27): 44 seeded journeys, almost all with a null
 * `dep_station_id`/`arr_station_id`, and one — Berlin Hbf — silently linked
 * to "Offenbach (Main) Ost", a station 350 km away. Root cause was two bugs
 * stacked: `data/stations.ts` held EVA/Bahnhofsnummer values in the `uic`
 * field instead of the catalogue's actual UIC code (mostly matches nothing,
 * but Berlin's EVA number happens to equal Offenbach's real UIC — see the
 * comment on `STATIONS`), and `loadStations()`'s `parentSourceId: null`
 * filter excluded every real named station, which the catalogue models as a
 * CHILD of its city node.
 */
describe("realistic demo seed: rail station linking", () => {
  describe("nearbyStationId (the cross-city guard)", () => {
    it("keeps a catalogue row that sits at the expected position", () => {
      // Real coordinates of Köln Hbf, id 7561 in the vendored catalogue.
      const id = nearbyStationId(
        { id: 7561, lat: 50.943029, lon: 6.958729 },
        { lat: STATIONS.koeln.lat, lon: STATIONS.koeln.lon }
      );
      expect(id).toBe(7561);
    });

    it("refuses the exact collision that once mislinked Berlin Hbf to Offenbach (Main) Ost", () => {
      // Offenbach (Main) Ost's real position — 350 km from Berlin Hbf. Its
      // real UIC (8011160) is the value the demo data used to (wrongly)
      // store as Berlin's own uic, which is why this is the literal
      // near-miss pair from the bug report, not a synthetic one.
      const offenbachOst = { id: 13030, lat: 50.102762, lon: 8.784375 };
      const id = nearbyStationId(offenbachOst, {
        lat: STATIONS.berlin.lat,
        lon: STATIONS.berlin.lon,
      });
      expect(id).toBeNull();
    });

    it("abstains — never guesses — when there is no candidate at all", () => {
      expect(
        nearbyStationId(undefined, { lat: STATIONS.koeln.lat, lon: STATIONS.koeln.lon })
      ).toBeNull();
    });
  });

  describe("loadStations() against the database", () => {
    const insertedIds: number[] = [];

    afterEach(async () => {
      if (insertedIds.length > 0) {
        await prisma.railStation.deleteMany({ where: { id: { in: insertedIds } } });
        insertedIds.length = 0;
      }
    });

    it("links Köln Hbf even though the catalogue models it as a child of its city node", async () => {
      // Mirrors the real catalogue shape: Köln Hbf (id 7561) has
      // parentSourceId "7558" (the city "Köln"), never null. A
      // `parentSourceId: null` filter — the pre-fix behaviour — would find
      // nothing here, same as it found nothing on the real install.
      const koeln = await prisma.railStation.create({
        data: {
          sourceId: `test-koeln-${Date.now()}`,
          name: STATIONS.koeln.name,
          searchName: foldStationName(STATIONS.koeln.name),
          uic: STATIONS.koeln.uic,
          shortCode: "KK",
          lat: STATIONS.koeln.lat,
          lon: STATIONS.koeln.lon,
          country: "DE",
          parentSourceId: "7558",
        },
      });
      insertedIds.push(koeln.id);

      const byUic = await loadStations();

      expect(STATIONS.koeln.uic).not.toBeNull();
      expect(byUic.get(STATIONS.koeln.uic as string)).toBe(koeln.id);

      const linked = await prisma.railStation.findUnique({
        where: { id: byUic.get(STATIONS.koeln.uic as string) },
        select: { shortCode: true, name: true },
      });
      expect(linked?.shortCode).toBe("KK");
      expect(linked?.name).toBe("Köln Hbf");
    });

    it("does not link a same-uic row that sits far from the demo's own coordinates", async () => {
      // A poisoned catalogue: something else claims Berlin Hbf's uic but
      // sits in a different city entirely. loadStations() must come back
      // without that uic mapped rather than silently accepting it.
      const decoy = await prisma.railStation.create({
        data: {
          sourceId: `test-decoy-${Date.now()}`,
          name: "Offenbach (Main) Ost",
          searchName: foldStationName("Offenbach (Main) Ost"),
          uic: STATIONS.berlin.uic,
          lat: 50.102762,
          lon: 8.784375,
          country: "DE",
          parentSourceId: null,
        },
      });
      insertedIds.push(decoy.id);

      const byUic = await loadStations();

      expect(STATIONS.berlin.uic).not.toBeNull();
      expect(byUic.has(STATIONS.berlin.uic as string)).toBe(false);
    });
  });
});
