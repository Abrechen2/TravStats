import { describe, expect, it } from "vitest";
import { parseCsv } from "../../csvParser";
import {
  buildLodgingCandidates,
  buildLodgingMappingFields,
  detectCsvShape,
  type LodgingCsvMapping,
} from "../lodgingCsv";
import { autoMapHeaders } from "../../../components/import/ColumnMappingWizard";

describe("lodgingCsv heuristic", () => {
  it("auto-maps the owner's places export (German + Google headers)", () => {
    const fields = buildLodgingMappingFields((f) => f);
    const mapping = autoMapHeaders(fields, [
      "Name",
      "Typ",
      "Kette",
      "Sterne",
      "Adresse",
      "Ort",
      "Land",
      "lat",
      "lon",
      "google_place_id",
    ]);
    expect(mapping).toMatchObject({
      name: "Name",
      type: "Typ",
      chainName: "Kette",
      stars: "Sterne",
      address: "Adresse",
      city: "Ort",
      country: "Land",
      lat: "lat",
      lon: "lon",
      googlePlaceId: "google_place_id",
    });
  });

  it("auto-maps Alex's stays sheet", () => {
    const fields = buildLodgingMappingFields((f) => f);
    const mapping = autoMapHeaders(fields, [
      "Hotel",
      "Anreise",
      "Abreise",
      "Bew. Zimmer",
      "Bew. Frühstück",
    ]);
    expect(mapping).toMatchObject({
      name: "Hotel",
      checkIn: "Anreise",
      checkOut: "Abreise",
      ratingRoom: "Bew. Zimmer",
      ratingBreakfast: "Bew. Frühstück",
    });
  });

  it("auto-maps a service-rating column", () => {
    // ratingService exists on the stay, in the editor and in the average, but
    // was missing from the import pipeline entirely — so a sheet scoring
    // service could never bring that column in and the three-way average was
    // permanently two-way for every imported stay.
    const fields = buildLodgingMappingFields((f) => f);
    const mapping = autoMapHeaders(fields, ["Hotel", "Anreise", "Abreise", "Bew. Service"]);
    expect(mapping).toMatchObject({ ratingService: "Bew. Service" });
  });
});

describe("detectCsvShape", () => {
  it("detects places-only", () => {
    const mapping: LodgingCsvMapping = { name: "Name", city: "Ort", lat: "lat", lon: "lon" };
    expect(detectCsvShape(mapping)).toBe("places");
  });

  it("detects stays-only (joined by hotel name)", () => {
    const mapping: LodgingCsvMapping = { name: "Hotel", checkIn: "Anreise", checkOut: "Abreise" };
    expect(detectCsvShape(mapping)).toBe("stays");
  });

  it("detects both", () => {
    const mapping: LodgingCsvMapping = {
      name: "Hotel",
      city: "Ort",
      checkIn: "Anreise",
      checkOut: "Abreise",
    };
    expect(detectCsvShape(mapping)).toBe("both");
  });

  it("falls through to places for a name-only mapping (no lodging-only, no stay-only field)", () => {
    // A bare name-only file is still just a places list — pinning this as a
    // deliberate decision rather than an accident of the `hasLodging`/
    // `hasStay` fallthrough logic.
    const mapping: LodgingCsvMapping = { name: "Name" };
    expect(detectCsvShape(mapping)).toBe("places");
  });
});

describe("buildLodgingCandidates", () => {
  it("builds places-only candidates with a google externalRef and no stay", () => {
    const csv = [
      "Name,Typ,Kette,Sterne,Adresse,Ort,Land,lat,lon,google_place_id",
      "Hotel Adlon,hotel,Kempinski,5,Unter den Linden 77,Berlin,Deutschland,52.5163,13.3807,ChIJd8BlQ2Bo5kcRAFTLmuLK8bA",
    ].join("\n");
    const mapping: LodgingCsvMapping = {
      name: "Name",
      type: "Typ",
      chainName: "Kette",
      stars: "Sterne",
      address: "Adresse",
      city: "Ort",
      country: "Land",
      lat: "lat",
      lon: "lon",
      googlePlaceId: "google_place_id",
    };

    const result = buildLodgingCandidates(parseCsv(csv), mapping);

    expect(result.shape).toBe("places");
    expect(result.rowErrors).toEqual([]);
    expect(result.candidates).toHaveLength(1);
    const c = result.candidates[0];
    expect(c.lodging?.name).toBe("Hotel Adlon");
    expect(c.lodging?.chainName).toBe("Kempinski");
    expect(c.lodging?.stars).toBe(5);
    expect(c.lodging?.lat).toBeCloseTo(52.5163, 4);
    expect(c.lodging?.externalRef).toBe("google:ChIJd8BlQ2Bo5kcRAFTLmuLK8bA");
    expect(c.stay).toBeNull();
  });

  it("builds stays-only candidates joined by hotel name, with no price and no FX", () => {
    const csv = [
      "Hotel,Anreise,Abreise,Bew. Zimmer,Bew. Frühstück",
      "NH Ludwigsburg,30.03.2026,31.03.2026,4,3",
      "Novotel Suites Berlin,2026-04-22,2026-04-24,5,4",
    ].join("\n");
    const mapping: LodgingCsvMapping = {
      name: "Hotel",
      checkIn: "Anreise",
      checkOut: "Abreise",
      ratingRoom: "Bew. Zimmer",
      ratingBreakfast: "Bew. Frühstück",
    };

    const result = buildLodgingCandidates(parseCsv(csv), mapping);

    expect(result.shape).toBe("stays");
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].lodging).toBeNull();
    expect(result.candidates[0].lodgingName).toBe("NH Ludwigsburg");
    // German DD.MM.YYYY and ISO both normalise to YYYY-MM-DD.
    expect(result.candidates[0].stay?.checkIn).toBe("2026-03-30");
    expect(result.candidates[0].stay?.checkOut).toBe("2026-03-31");
    expect(result.candidates[0].stay?.ratingRoom).toBe(4);
    expect(result.candidates[0].stay?.totalPrice).toBeNull();
    expect(result.candidates[1].stay?.checkIn).toBe("2026-04-22");
  });

  it("builds a lodging AND its stay per row in the both shape", () => {
    const csv = [
      "Hotel,Ort,Anreise,Abreise,Preis,Währung",
      'Bastion Hotel,Zoetermeer,04.06.2026,07.06.2026,"451,70",EUR',
    ].join("\n");
    const mapping: LodgingCsvMapping = {
      name: "Hotel",
      city: "Ort",
      checkIn: "Anreise",
      checkOut: "Abreise",
      totalPrice: "Preis",
      currency: "Währung",
    };

    const result = buildLodgingCandidates(parseCsv(csv), mapping);

    expect(result.shape).toBe("both");
    expect(result.candidates[0].lodging?.name).toBe("Bastion Hotel");
    expect(result.candidates[0].stay?.totalPrice).toBeCloseTo(451.7, 2);
    expect(result.candidates[0].stay?.currency).toBe("EUR");
  });

  /**
   * A German Excel column formatted "TT.MM.JJ" exports as "07.03.26". The
   * four-digit-year requirement rejected every such row, so a whole stays
   * sheet died with "not a single row could be read". Two digits are
   * unambiguous ENOUGH here (69 → 2069, 70 → 1970, the POSIX pivot) because
   * the alternative is refusing a file whose meaning a human reads at a
   * glance. The slash format stays refused — DD/MM vs MM/DD is a genuine
   * coin flip, and a wrong-but-plausible date is worse than a rejected row.
   */
  it("accepts a two-digit year in the German dot format", () => {
    const csv = ["Hotel,Anreise,Abreise", "NH Ludwigsburg,07.03.26,09.03.26"].join("\n");
    const mapping: LodgingCsvMapping = { name: "Hotel", checkIn: "Anreise", checkOut: "Abreise" };

    const result = buildLodgingCandidates(parseCsv(csv), mapping);

    expect(result.rowErrors).toEqual([]);
    expect(result.candidates[0].stay?.checkIn).toBe("2026-03-07");
    expect(result.candidates[0].stay?.checkOut).toBe("2026-03-09");
  });

  it("reads a last-century two-digit year above the pivot as 19xx", () => {
    const csv = ["Hotel,Anreise,Abreise", "Old Inn,24.12.98,26.12.98"].join("\n");
    const mapping: LodgingCsvMapping = { name: "Hotel", checkIn: "Anreise", checkOut: "Abreise" };

    const result = buildLodgingCandidates(parseCsv(csv), mapping);

    expect(result.candidates[0].stay?.checkIn).toBe("1998-12-24");
  });

  it("still refuses a slash-separated date, which is genuinely ambiguous", () => {
    const csv = ["Hotel,Anreise,Abreise", "Ambiguous Hotel,03/07/2026,05/07/2026"].join("\n");
    const mapping: LodgingCsvMapping = { name: "Hotel", checkIn: "Anreise", checkOut: "Abreise" };

    const result = buildLodgingCandidates(parseCsv(csv), mapping);

    expect(result.candidates).toHaveLength(0);
    expect(result.rowErrors[0].message).toContain("date");
  });

  it("reads a stays sheet exported by German Excel (semicolons + two-digit years)", () => {
    const csv = [
      "Hotel;Anreise;Abreise;Bew. Zimmer",
      "NH München;07.03.26;09.03.26;4",
      "Novotel Wien;12.04.26;14.04.26;5",
    ].join("\r\n");
    const mapping: LodgingCsvMapping = {
      name: "Hotel",
      checkIn: "Anreise",
      checkOut: "Abreise",
      ratingRoom: "Bew. Zimmer",
    };

    const result = buildLodgingCandidates(parseCsv(csv), mapping);

    expect(result.shape).toBe("stays");
    expect(result.rowErrors).toEqual([]);
    expect(result.candidates).toHaveLength(2);
    expect(result.candidates[0].lodgingName).toBe("NH München");
    expect(result.candidates[0].stay?.checkIn).toBe("2026-03-07");
    expect(result.candidates[1].stay?.ratingRoom).toBe(5);
  });

  it("reports an unparseable date as a row error instead of dropping the row silently", () => {
    const csv = ["Hotel,Anreise,Abreise", "Broken Hotel,not-a-date,31.03.2026"].join("\n");
    const mapping: LodgingCsvMapping = { name: "Hotel", checkIn: "Anreise", checkOut: "Abreise" };

    const result = buildLodgingCandidates(parseCsv(csv), mapping);

    expect(result.candidates).toHaveLength(0);
    expect(result.rowErrors).toHaveLength(1);
    expect(result.rowErrors[0].rowIndex).toBe(0);
    expect(result.rowErrors[0].message).toContain("date");
  });

  it("skips a row with an empty name rather than creating a nameless lodging", () => {
    const csv = ["Name,Ort", ",Berlin", "Real Hotel,Berlin"].join("\n");
    const mapping: LodgingCsvMapping = { name: "Name", city: "Ort" };

    const result = buildLodgingCandidates(parseCsv(csv), mapping);

    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].lodging?.name).toBe("Real Hotel");
    expect(result.rowErrors).toHaveLength(1);
  });

  it("emits globally unique sourceRowIndex values across a file, even with dropped rows", () => {
    // sourceRowIndex is what the preview modal's updateRow (Task 15) keys
    // edits by — if two candidates ever shared an index, one user edit
    // would patch two rows. buildLodgingCandidates derives sourceRowIndex
    // directly from Array.forEach's native index over the full `records`
    // array (never a second counter it could desync from), so this holds
    // even when earlier rows are dropped (empty name / bad dates) and the
    // candidates array is shorter than `records`.
    const csv = [
      "Name,Ort",
      ",Berlin", // dropped: empty name
      "Hotel A,Berlin",
      "Hotel B,Hamburg",
      "Hotel C,Munich",
    ].join("\n");
    const mapping: LodgingCsvMapping = { name: "Name", city: "Ort" };

    const result = buildLodgingCandidates(parseCsv(csv), mapping);

    expect(result.rowErrors).toHaveLength(1); // the dropped row
    expect(result.candidates).toHaveLength(3);
    const indexes = result.candidates.map((c) => c.sourceRowIndex);
    expect(new Set(indexes).size).toBe(indexes.length);
    // Not renumbered post-drop — still the original 1/2/3 positions in the
    // source file, so a sourceRowIndex always points back at the right row.
    expect(indexes).toEqual([1, 2, 3]);
  });
});

describe("buildLodgingCandidates: garbage coordinates never fabricate 0,0", () => {
  const mapping: LodgingCsvMapping = { name: "Name", lat: "lat", lon: "lon" };

  function coordsFor(rawLat: string, rawLon: string) {
    const csv = ["Name,lat,lon", `Test Hotel,${rawLat},${rawLon}`].join("\n");
    return buildLodgingCandidates(parseCsv(csv), mapping);
  }

  it("does not turn unreadable text into a null-island coordinate", () => {
    for (const [rawLat, rawLon] of [
      ["unbekannt", "N/A"],
      ["?", "TBD"],
    ]) {
      const result = coordsFor(rawLat, rawLon);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].lodging?.lat).toBeNull();
      expect(result.candidates[0].lodging?.lon).toBeNull();
      expect(result.rowErrors.length).toBeGreaterThanOrEqual(1);
    }
  });

  it("does not fail the whole file for a garbage coordinate — the row is still built", () => {
    const result = coordsFor("unbekannt", "13.3807");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].lodging?.lat).toBeNull();
    expect(result.candidates[0].lodging?.lon).toBeCloseTo(13.3807, 4);
    expect(result.rowErrors).toEqual([
      {
        rowIndex: 0,
        code: "unreadable_number",
        message: expect.stringContaining("latitude"),
        sample: "unbekannt",
      },
    ]);
  });

  it("still preserves a genuine 0 longitude (e.g. a real Accra hotel on the meridian)", () => {
    const result = coordsFor("5.55", "0");
    expect(result.candidates[0].lodging?.lat).toBeCloseTo(5.55, 2);
    expect(result.candidates[0].lodging?.lon).toBe(0);
    expect(result.rowErrors).toEqual([]);
  });
});

describe("buildLodgingCandidates: totalPrice garbage vs. genuine 0 vs. locale formats", () => {
  const mapping: LodgingCsvMapping = {
    name: "Hotel",
    checkIn: "Anreise",
    checkOut: "Abreise",
    totalPrice: "Preis",
  };

  function priceFor(rawPrice: string) {
    const csv = [
      "Hotel,Anreise,Abreise,Preis",
      `Test Hotel,01.01.2026,02.01.2026,"${rawPrice}"`,
    ].join("\n");
    return buildLodgingCandidates(parseCsv(csv), mapping);
  }

  it.each(["unbekannt", "N/A", "?", "TBD"])(
    "does NOT fabricate a free stay (0) for garbage text %s",
    (raw) => {
      const result = priceFor(raw);
      expect(result.candidates).toHaveLength(1);
      expect(result.candidates[0].stay?.totalPrice).toBeNull();
      expect(result.rowErrors).toEqual([
        {
          rowIndex: 0,
          code: "unreadable_number",
          message: expect.stringContaining("price"),
          sample: raw,
        },
      ]);
    }
  );

  it("preserves a genuine 0 price (a real free stay) without a row error", () => {
    const result = priceFor("0");
    expect(result.candidates[0].stay?.totalPrice).toBe(0);
    expect(result.rowErrors).toEqual([]);
  });

  it("parses German thousands+decimal (1.234,56)", () => {
    const result = priceFor("1.234,56");
    expect(result.candidates[0].stay?.totalPrice).toBeCloseTo(1234.56, 2);
    expect(result.rowErrors).toEqual([]);
  });

  it("parses US thousands+decimal (12,345.67)", () => {
    const result = priceFor("12,345.67");
    expect(result.candidates[0].stay?.totalPrice).toBeCloseTo(12345.67, 2);
    expect(result.rowErrors).toEqual([]);
  });

  it("parses a US-formatted currency amount ($1,234.50)", () => {
    const result = priceFor("$1,234.50");
    expect(result.candidates[0].stay?.totalPrice).toBeCloseTo(1234.5, 2);
    expect(result.rowErrors).toEqual([]);
  });

  it("resolves a lone thousands separator consistently for both comma and dot", () => {
    // Neither "1,234" nor "1.234" is fabricated as ~1000x too small anymore —
    // both resolve to the same thousands-grouped value.
    expect(priceFor("1,234").candidates[0].stay?.totalPrice).toBeCloseTo(1234, 2);
    expect(priceFor("1.234").candidates[0].stay?.totalPrice).toBeCloseTo(1234, 2);
  });
});

describe("buildLodgingCandidates: isRealCalendarDay rejects impossible calendar days", () => {
  const mapping: LodgingCsvMapping = { name: "Hotel", checkIn: "Anreise", checkOut: "Abreise" };

  function checkInFor(rawCheckIn: string) {
    const csv = ["Hotel,Anreise,Abreise", `Test Hotel,${rawCheckIn},01.03.2026`].join("\n");
    return buildLodgingCandidates(parseCsv(csv), mapping);
  }

  it("rejects a German-format day that does not exist (31 February)", () => {
    const result = checkInFor("31.02.2026");
    expect(result.candidates).toHaveLength(0);
    expect(result.rowErrors).toHaveLength(1);
    expect(result.rowErrors[0].message).toContain("date");
  });

  it("rejects an ISO day that does not exist in a non-leap year (2026-02-29)", () => {
    const result = checkInFor("2026-02-29");
    expect(result.candidates).toHaveLength(0);
    expect(result.rowErrors).toHaveLength(1);
  });

  it("accepts a real leap day (2024-02-29)", () => {
    const result = checkInFor("2024-02-29");
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].stay?.checkIn).toBe("2024-02-29");
    expect(result.rowErrors).toEqual([]);
  });
});
