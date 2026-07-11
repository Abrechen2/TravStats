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
});
