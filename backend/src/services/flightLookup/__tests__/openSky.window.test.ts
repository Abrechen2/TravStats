import axios from "axios";
import { lookupOpenSkyFlight } from "../openSky";

jest.mock("axios");
const get = axios.get as jest.MockedFunction<typeof axios.get>;

/**
 * OpenSky is asked for a callsign within an instant window. The window is the
 * UTC day of the date asked for — it used to be the SERVER's midnight
 * (`setHours(0, 0, 0, 0)`), so the same lookup searched a different day on a
 * host in Kiritimati than on one in UTC (ADR 0002 D6).
 */
describe("lookupOpenSkyFlight — the search window", () => {
  const originalTz = process.env.TZ;
  afterEach(() => {
    if (originalTz === undefined) delete process.env.TZ;
    else process.env.TZ = originalTz;
  });

  it("searches the UTC day of the date, whatever the host's zone", async () => {
    process.env.TZ = "Pacific/Kiritimati";
    get.mockResolvedValue({ data: [] });
    await lookupOpenSkyFlight("DLH400", "2027-06-01", { Authorization: "Bearer x" });
    const url = String(get.mock.calls[0][0]);
    const begin = Date.UTC(2027, 5, 1) / 1000;
    expect(url).toContain(`begin=${begin}&end=${begin + 86400}`);
  });
});
