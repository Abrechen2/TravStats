import { parseAirlinesDat, parsePlanesDat, dedupeAirlinesByIata } from "../parseOpenFlights";

describe("parseAirlinesDat", () => {
  it("parses fields and maps \\N to null, Active to boolean", () => {
    const raw = `1,"Private flight","\\N","-","N/A",\\N,\\N,"Y"
5,"Lufthansa","\\N","LH","DLH","LUFTHANSA","Germany","Y"
99,"Defunct Air","\\N","LH","OLD","OLDCALL","Nowhere","N"`;
    const rows = parseAirlinesDat(raw);
    expect(rows).toHaveLength(3);
    const lh = rows.find((r) => r.name === "Lufthansa");
    expect(lh).toEqual({
      iata: "LH", icao: "DLH", name: "Lufthansa",
      callsign: "LUFTHANSA", country: "Germany", active: true,
    });
    // "-" and "N/A" IATA/ICAO placeholders normalize to null
    const priv = rows.find((r) => r.name === "Private flight");
    expect(priv?.iata).toBeNull();
    expect(priv?.icao).toBeNull();
  });
});

describe("dedupeAirlinesByIata", () => {
  it("drops blank-IATA rows and prefers the active carrier on collision", () => {
    const rows = parseAirlinesDat(`5,"Lufthansa","\\N","LH","DLH","C","Germany","Y"
99,"Defunct Air","\\N","LH","OLD","C","Nowhere","N"
7,"No Code Air","\\N",\\N,"NCA","C","X","Y"`);
    const out = dedupeAirlinesByIata(rows);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Lufthansa"); // active wins
    expect(out.some((r) => r.iata === null)).toBe(false); // blank dropped
  });

  it("prefers the active carrier even when the inactive row is seen first", () => {
    const rows = parseAirlinesDat(`99,"Defunct Air","\\N","LH","OLD","C","Nowhere","N"
5,"Lufthansa","\\N","LH","DLH","C","Germany","Y"`);
    const out = dedupeAirlinesByIata(rows);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Lufthansa"); // active wins despite being second
    expect(out[0].active).toBe(true);
  });
});

describe("parsePlanesDat", () => {
  it("parses name + icao, maps \\N to null", () => {
    const rows = parsePlanesDat(`"Airbus A320","320","A320"
"Some Glider","\\N","\\N"`);
    expect(rows).toContainEqual({ name: "Airbus A320", icao: "A320" });
    expect(rows.find((r) => r.name === "Some Glider")?.icao).toBeNull();
  });
});
