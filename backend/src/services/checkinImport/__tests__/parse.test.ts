import { parseTraewellingCsv, parseTraewellingJson } from "../travelling";
import { parseTravelynxJson } from "../travelynx";

/** Synthetic fixtures — no real person, no real journey. */
const TRAEWELLING_JSON = JSON.stringify({
  data: [
    {
      id: 1,
      body: "Vollgepackt",
      train: {
        category: "nationalExpress",
        lineName: "ICE 901",
        journeyNumber: 901,
        origin: {
          name: "Alpha Hbf",
          evaIdentifier: 8999001,
          departurePlanned: "2026-03-01T08:00:00+01:00",
        },
        destination: {
          name: "Beta Hbf",
          evaIdentifier: 8999002,
          arrivalPlanned: "2026-03-01T10:30:00+01:00",
        },
      },
    },
    {
      id: 2,
      train: {
        category: "subway",
        lineName: "U 7",
        origin: { name: "Alpha Hbf", departurePlanned: "2026-03-02T09:00:00Z" },
        destination: { name: "Gamma Platz", arrivalPlanned: "2026-03-02T09:20:00Z" },
      },
    },
    { id: 3, body: "no train here" },
    {
      id: 4,
      train: {
        category: "ferry",
        origin: { name: "A", departurePlanned: "bad" },
        destination: { name: "B" },
      },
    },
  ],
});

describe("Träwelling JSON", () => {
  const out = parseTraewellingJson(TRAEWELLING_JSON);

  it("reads rides with the station's own clock and a mode", () => {
    expect(out.rides).toHaveLength(2);
    const [ice, u] = out.rides;
    expect(ice).toMatchObject({ mode: "rail", trainNumber: "901", notes: "Vollgepackt" });
    expect(ice.dep).toMatchObject({
      name: "Alpha Hbf",
      code: "8999001",
      time: { wall: "2026-03-01T08:00" },
    });
    expect(u.mode).toBe("metro");
    expect("instant" in (u.dep.time ?? {})).toBe(true);
  });

  it("shows every record it cannot read with a reason instead of dropping it", () => {
    expect(out.rejects).toEqual([
      { row: 3, label: "#3", reason: "not_a_journey" },
      expect.objectContaining({ row: 4, reason: "invalid_date" }),
    ]);
  });

  it("answers invalid_file for text that is not JSON", () => {
    expect(parseTraewellingJson("<html>").rejects[0].reason).toBe("invalid_file");
  });
});

describe("Träwelling CSV", () => {
  const csv = [
    "status_id,journey_type,line,journey_number,origin,origin_id,departure,destination,arrival,body",
    '1,regional,RE 5,5,Alpha Hbf,8999001,2026-03-01 08:00:00,Beta Hbf,2026-03-01 09:00:00,"mit, Komma"',
    "2,tram,Tram 1,,Alpha Hbf,,2026-03-01 18:00:00,,,",
  ].join("\n");
  const out = parseTraewellingCsv(csv);

  it("reads quoted cells and numbers CSV rows by file line", () => {
    expect(out.rides).toHaveLength(1);
    expect(out.rides[0]).toMatchObject({ row: 2, mode: "rail", notes: "mit, Komma" });
  });

  it("rejects a row without an arrival station with its line number", () => {
    expect(out.rejects).toEqual([
      expect.objectContaining({ row: 3, reason: "missing_arrival_station" }),
    ]);
  });
});

describe("travelynx JSON", () => {
  it("reads the history shape (epoch seconds) and the flat account export", () => {
    const out = parseTravelynxJson(
      JSON.stringify([
        {
          fromStation: { name: "Alpha Hbf", uic: 8999001, scheduledTime: 1772352000 },
          toStation: { name: "Beta Hbf", uic: 8999002, scheduledTime: 1772360000 },
          train: { type: "RE", line: "RE 5", no: "5" },
        },
        {
          train_type: "STR",
          train_no: "3",
          checkin_station_name: "Alpha Hbf",
          arr_name: "Gamma Platz",
          sched_departure: 1772352000,
          sched_arrival: 1772353000,
        },
        { fromStation: { name: "Alpha Hbf", scheduledTime: 1772352000 } },
      ])
    );
    expect(out.rides.map((r) => r.mode)).toEqual(["rail", "tram"]);
    expect(out.rides[0].dep.time).toEqual({ instant: new Date(1772352000 * 1000) });
    expect(out.rejects).toEqual([
      expect.objectContaining({ row: 3, reason: "missing_arrival_station" }),
    ]);
  });
});
