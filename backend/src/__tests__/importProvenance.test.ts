import { flightExternalRef, cruiseExternalRef } from "../services/importProvenance";

describe("flightExternalRef", () => {
  const base = {
    flightNumber: "LH400",
    departureLocal: "2024-05-01T10:35:00",
    depIata: "FRA",
    arrIata: "JFK",
  };

  it("identifies a flight by number, day and route", () => {
    expect(flightExternalRef(base)).toBe("import:LH400:2024-05-01:FRA-JFK");
  });

  it("gives the same key for the same flight in a second export", () => {
    // A later export writes the time with seconds, the airports lower-case.
    expect(
      flightExternalRef({
        flightNumber: "lh400",
        departureLocal: "2024-05-01T10:35",
        depIata: "fra",
        arrIata: "jfk",
      }),
    ).toBe(flightExternalRef(base));
  });

  // The reason this is not `booking:<PNR>`: a return trip shares its PNR, and
  // a unique index on that would refuse the second half of every journey.
  it("gives DIFFERENT keys to the outbound and the return leg", () => {
    const back = flightExternalRef({
      flightNumber: "LH401",
      departureLocal: "2024-05-08T18:00:00",
      depIata: "JFK",
      arrIata: "FRA",
    });
    expect(back).not.toBe(flightExternalRef(base));
  });

  it("separates the same flight number on different days", () => {
    expect(flightExternalRef({ ...base, departureLocal: "2024-05-02T10:35:00" })).not.toBe(
      flightExternalRef(base),
    );
  });

  // A key of nothing but dashes would collide with every other unidentifiable
  // row and swallow them all — better no provenance than a false identity.
  it("refuses to invent a key when the row cannot be identified", () => {
    expect(flightExternalRef({ departureLocal: null, depIata: "FRA", arrIata: "JFK" })).toBeNull();
    expect(
      flightExternalRef({ flightNumber: null, departureLocal: "2024-05-01T10:00", depIata: null }),
    ).toBeNull();
  });

  it("still identifies a flight with no number but a full route", () => {
    expect(
      flightExternalRef({ flightNumber: null, departureLocal: "2024-05-01T10:00", depIata: "FRA", arrIata: "JFK" }),
    ).toBe("import:-:2024-05-01:FRA-JFK");
  });

  it("never lets a value break the key apart", () => {
    const ref = flightExternalRef({ ...base, flightNumber: "LH:400" });
    expect(ref).toBe("import:LH_400:2024-05-01:FRA-JFK");
    expect(ref?.split(":")).toHaveLength(4);
  });
});

describe("cruiseExternalRef", () => {
  // A cruise booking reference identifies one cruise, unlike a flight PNR.
  it("uses the booking reference when there is one", () => {
    expect(cruiseExternalRef({ bookingReference: "1C868387", startDate: "2024-11-15" })).toBe(
      "booking:1C868387",
    );
  });

  it("falls back to ship and sailing day", () => {
    expect(
      cruiseExternalRef({ shipNameOverride: "AIDAluna", startDate: "2024-11-15T00:00:00" }),
    ).toBe("import:AIDALUNA:2024-11-15");
  });

  it("refuses to invent a key without ship or day", () => {
    expect(cruiseExternalRef({ startDate: "2024-11-15" })).toBeNull();
    expect(cruiseExternalRef({ shipNameOverride: "AIDAluna" })).toBeNull();
  });
});
