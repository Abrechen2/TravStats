import { execFileSync } from "child_process";
import path from "path";

/**
 * ADR 0002 (time model), D4: which calendar day a ride belongs to is the
 * STATION's local day, never the server's. The rail badges, the passport's
 * rail evidence and the year in review all read days through
 * `shared/railCounting.stationDayKey`; this runs them in a process whose host
 * zone is fourteen hours east of UTC, where any host-local `Date` getter would
 * move both examples onto another day. See `railHostZoneProbe.ts` for why it is
 * a child process.
 */

const PROBE = path.join(__dirname, "railHostZoneProbe.ts");

function probe(zone: string): {
  hostDayOfDeparture: number;
  isNightTrain: boolean;
  eveYear: number;
  eveDays: string[];
} {
  const out = execFileSync(process.execPath, ["--import", "tsx", PROBE, zone], {
    cwd: path.resolve(__dirname, "../../.."),
    encoding: "utf8",
    env: { ...process.env, TZ: zone },
  });
  return JSON.parse(out);
}

describe("rail days under a non-UTC host zone", () => {
  const answers = probe("Pacific/Kiritimati");

  it("really ran under the far-east host zone", () => {
    // 21:00 UTC on 1 March is 11:00 on 2 March in Kiritimati.
    expect(answers.hostDayOfDeparture).toBe(2);
  });

  it("still sees a ride across the stations' midnight as a night train", () => {
    // Host-local it runs 11:00 → 22:00 on 2 March, one day: a host getter would say no.
    expect(answers.isNightTrain).toBe(true);
  });

  it("files a New Year's Eve departure under the station's year and day", () => {
    expect(answers.eveYear).toBe(2025);
    expect(answers.eveDays).toEqual(["2025-12-31"]);
  });
});
