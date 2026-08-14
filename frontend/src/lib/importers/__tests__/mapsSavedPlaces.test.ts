import { describe, it, expect } from "vitest";
import {
  extractPlaceId,
  inferLodgingType,
  buildLodgingCandidates,
  buildLodgingMappingFields,
  detectCsvShape,
} from "../lodgingCsv";
import { autoMapHeaders } from "../../../components/import/ColumnMappingWizard";

/** What the wizard does when the user drops the file: heuristic first, then confirm. */
const mapFor = (headers: string[]) =>
  autoMapHeaders(buildLodgingMappingFields((f) => f), headers);

/**
 * A Google Maps saved-places export — the owner's real "Hotels.csv": 237 houses
 * they have stayed in, with no dates at all. The columns are German ("Titel"),
 * the identity sits inside a share link, and nothing in the file says whether a
 * row is a place visited or merely noted down.
 */
const HEADERS = ["Titel", "Notiz", "URL", "Tags", "Kommentar"];
const ROW = {
  Titel: "Engimatt City & Garden Hotel",
  Notiz: "",
  URL: "https://www.google.com/maps/place/Engimatt+City+%26+Garden+Hotel/data=!4m2!3m1!1s0x479009f0421b2f1b:0x13197a53660c2f5e",
  Tags: "",
  Kommentar: "",
};

describe("Google Maps saved-places export", () => {
  it("maps 'Titel' to the name and 'URL' to the place identity", () => {
    const mapping = mapFor(HEADERS);
    expect(mapping.name).toBe("Titel");
    expect(mapping.googlePlaceId).toBe("URL");
  });

  it("is a places-only file: no dates, so no stay is invented", () => {
    const mapping = mapFor(HEADERS);
    expect(detectCsvShape(mapping)).toBe("places");

    const { candidates } = buildLodgingCandidates([ROW], mapping);
    expect(candidates).toHaveLength(1);
    expect(candidates[0].stay).toBeNull();
    expect(candidates[0].lodging?.name).toBe("Engimatt City & Garden Hotel");
  });

  it("pulls the identity out of the share link, so a re-import is a no-op", () => {
    const mapping = mapFor(HEADERS);
    const { candidates } = buildLodgingCandidates([ROW], mapping);
    // Without this the dedupe falls back to the NAME, and "Hotel Post" exists
    // dozens of times over.
    expect(candidates[0].lodging?.externalRef).toBe("google:0x479009f0421b2f1b:0x13197a53660c2f5e");
  });

  it("reads the modern place_id form too, and passes a bare id through", () => {
    expect(extractPlaceId("https://maps.google.com/?place_id=ChIJd8BlQ2Bo5kcRAFTLmuLK8bA")).toBe(
      "ChIJd8BlQ2Bo5kcRAFTLmuLK8bA"
    );
    expect(extractPlaceId("ChIJd8BlQ2Bo5kcRAFTLmuLK8bA")).toBe("ChIJd8BlQ2Bo5kcRAFTLmuLK8bA");
  });

  it("returns nothing for a link that carries no identity, rather than a fabricated key", () => {
    // A made-up key is worse than none: it would dedupe unrelated hotels onto
    // each other.
    expect(extractPlaceId("https://www.google.com/maps/search/hotel")).toBeNull();
    expect(extractPlaceId("   ")).toBeNull();
  });

  it("marks the run as visited or as noted down, and defaults to visited", () => {
    const mapping = mapFor(HEADERS);
    expect(buildLodgingCandidates([ROW], mapping).candidates[0].lodging?.visited).toBe(true);
    expect(
      buildLodgingCandidates([ROW], mapping, { visited: false }).candidates[0].lodging?.visited
    ).toBe(false);
  });
});

describe("what kind of house the name describes", () => {
  it("recognises campsites, hostels, apartments and guesthouses by name", () => {
    // Straight out of the owner's own list, which holds 26 campsites that an
    // import-everything-as-hotel run had all filed as hotels.
    expect(inferLodgingType("Camping Plitvice")).toBe("campsite");
    expect(inferLodgingType("Seecamping Berghof Ossiacher See")).toBe("campsite");
    expect(inferLodgingType("Campingplatz Ammertal")).toBe("campsite");
    expect(inferLodgingType("Gasthof Ochsalm")).toBe("guesthouse");
    expect(inferLodgingType("Landgasthof Adler")).toBe("guesthouse");
    expect(inferLodgingType("City Premiere Hotel Apartments")).toBe("apartment");
    expect(inferLodgingType("Hostel Marina")).toBe("hostel");
  });

  it("lets the more specific word win over a generic one", () => {
    // "Camping Resort Hotel" is a campsite, not a hotel that happens to say camping.
    expect(inferLodgingType("Amadria Park Camping Šibenik")).toBe("campsite");
    expect(inferLodgingType("Aparthotel Adagio")).toBe("apartment");
  });

  it("says nothing rather than guessing, when the name carries no clue", () => {
    // A wrong guess is worse than the visible default: "Tiny House" is a real
    // entry in the list and could be anything.
    expect(inferLodgingType("Tiny House")).toBeNull();
    expect(inferLodgingType("Engimatt City & Garden Hotel")).toBe("hotel");
  });

  it("never overrules a type the file actually states", () => {
    const headers = ["Titel", "Typ"];
    const mapping = autoMapHeaders(buildLodgingMappingFields((f) => f), headers);
    const { candidates } = buildLodgingCandidates(
      [{ Titel: "Camping Plitvice", Typ: "hotel" }],
      mapping
    );
    expect(candidates[0].lodging?.type).toBe("hotel");
  });
});
