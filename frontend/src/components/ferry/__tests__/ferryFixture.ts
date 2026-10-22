import { rideFixture as busFixture } from "../../bus/__tests__/busFixture";
import type { FerryJourney } from "../../../types/ferry";

/** A ferry crossing built on the bus fixture, whose terminal columns it shares. */
export const ferryFixture = (over: Partial<FerryJourney> = {}): FerryJourney => ({
  ...busFixture(),
  operator: "Adria Ferries",
  vesselName: "AF Mia",
  vesselMmsi: null,
  roadtripLegId: null,
  vehicleType: null,
  vehicleRegistration: null,
  vehicleLengthM: null,
  vehicleHeightM: null,
  vehicleWidthM: null,
  passengerCount: null,
  cabinType: null,
  ticketReference: null,
  distanceSource: "great_circle",
  geometrySource: "straight",
  ...over,
});
