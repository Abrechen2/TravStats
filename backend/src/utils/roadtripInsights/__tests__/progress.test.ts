import { roadtripProgress } from "../progress";
import type { InsightStation } from "../types";

/**
 * forgejo#179: on day 1 of 3, with the only leg a day ahead, the roadtrip page
 * said "Gefahren 254 km". `progress` splits the road km by the statistics'
 * timeline rule and names what each km was measured on.
 */
const d = (iso: string) => new Date(`${iso}T00:00:00Z`);

function station(id: string, over: Partial<InsightStation> = {}): InsightStation {
  return {
    id,
    title: id,
    lat: 52.5,
    lon: 13.4,
    startDate: null,
    endDate: null,
    stopZone: "Europe/Berlin",
    overnight: true,
    viaPoint: false,
    lodgingStayId: null,
    lodgingStay: null,
    ...over,
  };
}

const leg = (from: string, to: string, km: number, source = "straight", mode = "road") => ({
  fromStopId: from,
  toStopId: to,
  distanceKm: km,
  mode,
  source,
});

describe("roadtripProgress", () => {
  const stations = [
    station("berlin", { startDate: d("2026-10-03"), endDate: d("2026-10-04") }),
    station("hamburg", { startDate: d("2026-10-04"), endDate: d("2026-10-05") }),
  ];
  const legs = [leg("berlin", "hamburg", 254)];

  it("counts a leg a day ahead as planned, not driven (the issue's case)", () => {
    const p = roadtripProgress(stations, legs, new Date("2026-10-03T10:00:00Z"));
    expect(p.phase).toBe("current");
    expect(p.roadKm).toEqual({ recorded: 0, current: 0, planned: 254, unplaced: 0 });
    expect(p.roadKmBySource).toEqual({ straight: 254 });
    expect(p.recordedRoadKmBySource).toEqual({});
  });

  it("counts the leg as today's stage on its arrival day, and as driven after", () => {
    expect(roadtripProgress(stations, legs, new Date("2026-10-04T10:00:00Z")).roadKm).toEqual({
      recorded: 0,
      current: 254,
      planned: 0,
      unplaced: 0,
    });
    const after = roadtripProgress(stations, legs, new Date("2026-10-06T10:00:00Z"));
    expect(after.phase).toBe("past");
    expect(after.roadKm.recorded).toBe(254);
    expect(after.recordedRoadKmBySource).toEqual({ straight: 254 });
  });

  it("splits driven from planned and keeps ferries out of road km", () => {
    const three = [
      station("a", { startDate: d("2026-10-01") }),
      station("via", { viaPoint: true, overnight: false }),
      station("b", { startDate: d("2026-10-02") }),
      station("c", { startDate: d("2026-10-05") }),
    ];
    const p = roadtripProgress(
      three,
      [
        leg("a", "via", 40, "routed"),
        leg("via", "b", 60, "track"),
        leg("b", "c", 80, "routed", "ferry"),
      ],
      new Date("2026-10-03T10:00:00Z")
    );
    expect(p.roadKm).toEqual({ recorded: 100, current: 0, planned: 0, unplaced: 0 });
    expect(p.recordedRoadKmBySource).toEqual({ routed: 40, track: 60 });
  });

  it("dates a leg into an undated station by the station before it", () => {
    const p = roadtripProgress(
      [
        station("a", { startDate: d("2026-10-01") }),
        station("b"),
        station("c", { startDate: d("2026-10-09") }),
      ],
      [leg("a", "b", 10), leg("b", "c", 20)],
      new Date("2026-10-03T10:00:00Z")
    );
    expect(p.roadKm.recorded).toBe(10); // b undated: a's last day stands in, and it is past
    expect(p.roadKm.planned).toBe(20);
  });

  it("leaves a stretch between two undated stations unplaced while under way, never driven", () => {
    const p = roadtripProgress(
      [
        station("a", { startDate: d("2026-10-01") }),
        station("b"),
        station("c"),
        station("d", { startDate: d("2026-10-09") }),
      ],
      [leg("a", "b", 10), leg("b", "c", 30), leg("c", "d", 20)],
      new Date("2026-10-03T10:00:00Z")
    );
    expect(p.phase).toBe("current");
    expect(p.roadKm).toEqual({ recorded: 10, current: 0, planned: 20, unplaced: 30 });
  });
});
