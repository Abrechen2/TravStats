import { detectAirline } from "../../services/parsers/templates/detector";

describe("detectAirline", () => {
  it("detects Lufthansa by from-address", () => {
    expect(detectAirline("noreply@lufthansa.com", "Buchungsbestätigung", "")).toBe("LH");
  });

  it("detects Ryanair by from-address", () => {
    expect(detectAirline("noreply@ryanair.com", "Your booking", "")).toBe("FR");
  });

  it("detects easyJet by subject pattern", () => {
    expect(detectAirline("noreply@easyjet.com", "Your easyJet booking confirmation", "")).toBe("U2");
  });

  it("returns null for unknown airline", () => {
    expect(detectAirline("noreply@unknown-airline.xx", "Booking", "")).toBeNull();
  });
});
