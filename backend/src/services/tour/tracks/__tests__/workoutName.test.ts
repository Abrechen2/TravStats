import { relocalizedTrackName, relocalizedWorkoutName } from "../workoutName";

/**
 * Prod, 2026-10-09: "Wanderung am 28.05.2026, 14:10" was recorded at
 * 05:10:58 UTC in Madagascar (08:10 there, UTC+3) and named on a phone in
 * Seoul (UTC+9).
 */
const STARTED = new Date("2026-05-28T05:10:58.997Z");
const MADAGASCAR = "Indian/Antananarivo";

describe("relocalizedWorkoutName", () => {
  it("re-reads the generated clock in the zone of the place", () => {
    expect(relocalizedWorkoutName("Wanderung am 28.05.2026, 14:10", STARTED, MADAGASCAR)).toBe(
      "Wanderung am 28.05.2026, 08:10"
    );
  });

  it("moves the date too when the phone's day was not the place's", () => {
    // 22:30 UTC on the 27th: the 28th in Seoul, still the 27th in Lisbon.
    const late = new Date("2026-05-27T22:30:00Z");
    expect(relocalizedWorkoutName("Hike on 05/28/2026, 07:30", late, "Europe/Lisbon")).toBe(
      "Hike on 05/27/2026, 23:30"
    );
    expect(relocalizedWorkoutName("Hike on 28/05/2026, 07:30", late, "Europe/Lisbon")).toBe(
      "Hike on 27/05/2026, 23:30"
    );
    expect(relocalizedWorkoutName("Hike on 2026-05-28, 07:30", late, "Europe/Lisbon")).toBe(
      "Hike on 2026-05-27, 23:30"
    );
  });

  it("leaves a name that already shows the place's time", () => {
    expect(
      relocalizedWorkoutName("Wanderung am 28.05.2026, 08:10", STARTED, MADAGASCAR)
    ).toBeNull();
  });

  it("leaves a name the user wrote", () => {
    expect(relocalizedWorkoutName("Preikestolen", STARTED, MADAGASCAR)).toBeNull();
    // A date and time that are not this track's start on any offset.
    expect(relocalizedWorkoutName("Treffen am 01.03.2026, 14:10", STARTED, MADAGASCAR)).toBeNull();
    expect(
      relocalizedWorkoutName("Wanderung am 28.05.2026, 14:17", STARTED, MADAGASCAR)
    ).toBeNull();
  });

  it("takes the zone from the track's first point, full geo-tz dataset", () => {
    // Antananarivo, [lon, lat] as the stored geometry holds it.
    const geometry = [
      [47.5079, -18.8792],
      [47.51, -18.88],
    ];
    expect(
      relocalizedTrackName(
        "Spaziergang am 23.05.2026, 16:52",
        new Date("2026-05-23T07:52:16.999Z"),
        geometry
      )
    ).toBe("Spaziergang am 23.05.2026, 10:52");
    expect(relocalizedTrackName(null, STARTED, geometry)).toBeNull();
    expect(relocalizedTrackName("Wanderung am 28.05.2026, 14:10", STARTED, [])).toBeNull();
  });
});
