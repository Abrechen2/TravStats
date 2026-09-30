import { airlineAllianceOf } from "../achievementData";
import { ALLIANCE_IDS, ALLIANCE_MEMBERS } from "../../data/airlineAlliances";

/**
 * forgejo#133: the achievement and the loyalty pickers read ONE membership
 * list. These pin the movements the old achievement-only table had missed —
 * each one credited a flight to the wrong alliance, or to none.
 */
describe("airlineAllianceOf reads the shared membership list", () => {
  it.each([
    ["SK", "skyteam"], // SAS: Star -> SkyTeam, 01.09.2024
    ["AZ", "star"], // ITA Airways: SkyTeam -> Star, 01.04.2026
    ["WY", "oneworld"], // Oman Air, 30.06.2025
    ["FJ", "oneworld"], // Fiji Airways, full member 01.04.2025
    ["HA", "oneworld"], // Hawaiian, 23.04.2026
    ["LO", "star"], // LOT, a long-standing member the old table lacked
    ["AM", "skyteam"],
    ["AS", "oneworld"],
  ])("%s flies with %s", (code, alliance) => {
    expect(airlineAllianceOf(code)).toBe(alliance);
  });

  it("still resolves the display names the logbook stores", () => {
    expect(airlineAllianceOf("Lufthansa")).toBe("star");
    expect(airlineAllianceOf("ITA")).toBe("star");
    expect(airlineAllianceOf("British Airways")).toBe("oneworld");
    expect(airlineAllianceOf("Scandinavian Airlines")).toBe("skyteam");
  });

  it("abstains for a carrier in no alliance and for a suspended member", () => {
    expect(airlineAllianceOf("FR")).toBeNull();
    expect(airlineAllianceOf("SU")).toBeNull(); // Aeroflot, suspended since 2022
    expect(airlineAllianceOf("PR")).toBeNull(); // Philippine Airlines, invited only
    expect(airlineAllianceOf(null)).toBeNull();
  });

  it("lists every designator exactly once, in one alliance", () => {
    const all = ALLIANCE_IDS.flatMap((id) => ALLIANCE_MEMBERS[id]);
    expect(new Set(all).size).toBe(all.length);
    for (const code of all) expect(code).toMatch(/^[A-Z0-9]{2}$/);
  });
});
