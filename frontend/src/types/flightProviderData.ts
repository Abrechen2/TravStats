/**
 * Day-of-travel details a live-data provider (AeroDataBox, AeroAPI) reports
 * and the server stores on the flight. Null = the provider gave none.
 */
export interface FlightProviderData {
  baggageBelt?: string | null;
  checkInDesk?: string | null;
}
