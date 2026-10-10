import { altitudeMetresFromFeet } from "../airportAltitude";
import { parseAirportLine } from "../../scripts/importAirports";

/** forgejo#256 — the altitude column is metres; feet from any source are converted. */
describe("airport altitude", () => {
  it("converts feet to whole metres and abstains on nothing", () => {
    expect(altitudeMetresFromFeet(13325)).toBe(4061);
    expect(altitudeMetresFromFeet("364")).toBe(111);
    expect(altitudeMetresFromFeet("\\N")).toBeNull();
    expect(altitudeMetresFromFeet("")).toBeNull();
    expect(altitudeMetresFromFeet(null)).toBeNull();
  });

  it("the OpenFlights import stores La Paz at 4061 m, not 13325", () => {
    const line =
      '2762,"El Alto International Airport","La Paz","Bolivia","LPB","SLLP",-16.5133,-68.1923,13325,-4,"U","America/La_Paz","airport","OurAirports"';
    expect(parseAirportLine(line)?.altitude).toBe(4061);
  });
});
