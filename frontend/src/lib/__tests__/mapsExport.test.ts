import { describe, it, expect } from "vitest";
import { cidFromMapsUrl, mapsExternalRef, readMapsExport } from "../mapsExport";

describe("cidFromMapsUrl", () => {
  // A real row from the owner's export. The second hex half is the CID —
  // Google's id for exactly this place — and matching it against a Places
  // answer is identity rather than resemblance.
  it("reads the CID out of a saved-places URL", () => {
    expect(
      cidFromMapsUrl(
        "https://www.google.com/maps/place/Engimatt+City+%26+Garden+Hotel/data=!4m2!3m1!1s0x479009f0421b2f1b:0x13197a53660c2f5e"
      )
    ).toBe("1376265659751346014");
  });

  it("takes the SECOND half — the first is a geographic cell, not the place", () => {
    const cid = cidFromMapsUrl("https://maps.google.com/x/data=!4m2!3m1!1s0x479009f0421b2f1b:0x1");
    expect(cid).toBe("1");
  });

  it("returns null for a URL without a feature id", () => {
    expect(cidFromMapsUrl("https://www.google.com/maps/search/hotel+berlin")).toBeNull();
    expect(cidFromMapsUrl("")).toBeNull();
  });
});

describe("readMapsExport", () => {
  const row = (over: Record<string, string> = {}): Record<string, string> => ({
    Titel: "Engimatt City & Garden Hotel",
    Notiz: "",
    URL: "https://www.google.com/maps/place/Engimatt/data=!4m2!3m1!1s0x479009f0421b2f1b:0x13197a53660c2f5e",
    Tags: "",
    Kommentar: "",
    ...over,
  });

  it("reads name, CID and note", () => {
    const result = readMapsExport([row({ Notiz: "schön ruhig" })]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({
      name: "Engimatt City & Garden Hotel",
      cid: "1376265659751346014",
      note: "schön ruhig",
    });
    expect(result.withoutCid).toBe(0);
  });

  // Takeout localises its headers, so an English export must read the same.
  it("accepts English headers too", () => {
    const result = readMapsExport([
      {
        Title: "Hotel Adlon",
        URL: "https://www.google.com/maps/place/x/data=!4m2!3m1!1s0x1:0x2a",
        Note: "",
      },
    ]);
    expect(result.rows[0]).toMatchObject({ name: "Hotel Adlon", cid: "42" });
  });

  // A row without a name is not a place; the export contains a few (stray
  // links, an empty first line).
  it("drops rows without a name", () => {
    expect(readMapsExport([row({ Titel: "" }), row()]).rows).toHaveLength(1);
  });

  // Kept, but counted: the user should be told how many rows arrived without
  // an identity rather than have them silently treated like the rest.
  it("keeps a row whose URL has no id, and counts it", () => {
    const result = readMapsExport([row({ URL: "https://www.google.com/maps/search/hotel" })]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].cid).toBeNull();
    expect(result.withoutCid).toBe(1);
  });

  it("builds the provenance key the app stores", () => {
    expect(mapsExternalRef("1376265659751346014")).toBe("gmaps:1376265659751346014");
  });
});
