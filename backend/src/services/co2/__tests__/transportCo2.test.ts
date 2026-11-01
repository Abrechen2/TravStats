import {
  busCo2,
  carFuelOf,
  carSizeOf,
  cruiseCo2,
  ferryCo2,
  railCo2,
  rentalCo2,
} from "../transportCo2";

// Frankfurt (50.11, 8.68) to Berlin (52.52, 13.40): about 423 km on the chord.
const FRA_BER = { depLat: 50.11, depLon: 8.68, arrLat: 52.52, arrLon: 13.4 };

describe("CO2 for every mode of travel (forgejo#395)", () => {
  describe("factor application", () => {
    it("applies DESNZ national rail (0.03546 kg per passenger-km) to a train ride", () => {
      const est = railCo2({ ...FRA_BER, distanceKm: 500, transitMode: "rail" });
      expect(est).toMatchObject({ kg: 17.7, factor: "rail.rail", factorKgPerKm: 0.03546 });
    });

    it("uses the tram and the metro factor for those rides instead of the train's", () => {
      expect(railCo2({ ...FRA_BER, distanceKm: 10, transitMode: "tram" })?.kg).toBe(0.3);
      expect(railCo2({ ...FRA_BER, distanceKm: 10, transitMode: "metro" })?.factor).toBe(
        "rail.metro"
      );
    });

    it("reads an intercity bus as a coach and a shuttle as the average local bus", () => {
      const coach = busCo2({ ...FRA_BER, distanceKm: 100, rideKind: "intercity" });
      const shuttle = busCo2({ ...FRA_BER, distanceKm: 100, rideKind: "shuttle" });
      expect(coach).toMatchObject({ kg: 2.8, factor: "bus.coach" });
      expect(shuttle).toMatchObject({ kg: 10.4, factor: "bus.local" });
    });

    it("charges a ferry crossing with a recorded vehicle the car-passenger factor", () => {
      const car = ferryCo2({ distanceKm: 100, vehicleType: "Car", vehicleRegistration: null });
      const unknown = ferryCo2({ distanceKm: 100, vehicleType: null, vehicleRegistration: " " });
      expect(car).toMatchObject({ kg: 12.9, factor: "ferry.car" });
      expect(unknown).toMatchObject({ kg: 11.3, factor: "ferry.average" });
    });

    it("sums a cruise's legs and marks the proxy figure a lower bound", () => {
      const est = cruiseCo2([300, 700]);
      expect(est).toMatchObject({ kg: 112.7, distanceKm: 1000, lowerBound: true });
    });

    it("picks the rental car's factor from its ACRISS size and fuel, per vehicle-km", () => {
      expect(carSizeOf("CDMR")).toBe("medium");
      expect(carSizeOf("XXXX")).toBe("average");
      expect(carFuelOf("EDMD")).toBe("diesel");
      const est = rentalCo2({
        acrissCode: "CDMD",
        distanceKm: null,
        distanceSource: null,
        odometerOutKm: 1000,
        odometerInKm: 1200,
      });
      expect(est).toMatchObject({ kg: 34.3, factor: "car.medium.diesel", perVehicle: true });
    });
  });

  describe("abstention", () => {
    it("returns null, not 0, for a ride without a known distance", () => {
      expect(railCo2({ ...FRA_BER, distanceKm: null, transitMode: "rail" })).toBeNull();
      expect(busCo2({ ...FRA_BER, distanceKm: 0, rideKind: null })).toBeNull();
      expect(
        ferryCo2({ distanceKm: null, vehicleType: null, vehicleRegistration: null })
      ).toBeNull();
    });

    it("returns null for a cruise without legs and a rental without driven km", () => {
      expect(cruiseCo2([])).toBeNull();
      expect(
        rentalCo2({
          acrissCode: null,
          distanceKm: null,
          distanceSource: null,
          odometerOutKm: 5,
          odometerInKm: null,
        })
      ).toBeNull();
    });

    it("abstains for an electric rental car instead of showing the tailpipe zero", () => {
      const est = rentalCo2({
        acrissCode: "CDAE",
        distanceKm: 300,
        distanceSource: "invoice",
        odometerOutKm: null,
        odometerInKm: null,
      });
      expect(est).toBeNull();
    });
  });

  describe("instead of flying", () => {
    it("estimates the saving of a train ride against an economy flight on the same chord", () => {
      const est = railCo2({ ...FRA_BER, distanceKm: 500, transitMode: "rail" });
      // 423 km on the chord is short-haul: 0.255 kg/km, economy.
      expect(est?.flightKg).toBe(108);
      expect(est?.savedKg).toBe(90.3);
    });

    it("offers it for a coach but not for a shuttle, a tram or a ride under 100 km", () => {
      expect(busCo2({ ...FRA_BER, distanceKm: 500, rideKind: "intercity" })?.savedKg).toBe(
        108 - 13.9
      );
      expect(busCo2({ ...FRA_BER, distanceKm: 500, rideKind: "shuttle" })?.savedKg).toBeNull();
      expect(railCo2({ ...FRA_BER, distanceKm: 500, transitMode: "tram" })?.savedKg).toBeNull();
      const hop = { depLat: 50.0, depLon: 8.0, arrLat: 50.2, arrLon: 8.1 };
      expect(railCo2({ ...hop, distanceKm: 30, transitMode: "rail" })?.savedKg).toBeNull();
    });
  });
});
