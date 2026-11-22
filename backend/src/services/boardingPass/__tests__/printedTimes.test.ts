import { legTimesOn, readPrintedTimes } from "../printedTimes";

/** The text layout of a United paper pass, with invented values. */
const UNITED_LIKE = `
UNITED INTL
DOE/JANEMS
Orlando to Chicago-OHare
UA 633  GATE  BOARDING BEGINS  SEAT
MCO-ORD  40   12:01 PM   24F
FRI 08 JAN 2016  Gate May Change  Boarding Ends: 12:31 PM  Window
Flight Departs: 12:46 PM  Economy
Flight Arrives: 2:49 PM
Confirmation: Q7XK2P
`;

describe("readPrintedTimes — the printed time parser", () => {
  it("reads a 12-hour departure and arrival next to their labels", () => {
    const t = readPrintedTimes(UNITED_LIKE);
    expect(t.departure).toBe("12:46");
    expect(t.arrival).toBe("14:49");
    expect(t.date).toEqual({ day: 8, month: 1, year: 2016 });
  });

  it("never takes the boarding time for the departure time", () => {
    const t = readPrintedTimes("FLUG DATUM BOARDING GATE\nLH117 30AUG26\nBoarding 18:30");
    expect(t.boarding).toBe("18:30");
    expect(t.departure).toBeUndefined();
  });

  it("restores a lost PM from the Boarding Ends clock", () => {
    // OCR read "5:50 PM" as "5:50 A 3" — a lone letter is no meridiem.
    const t = readPrintedTimes(
      "Boarding Ends: 5:35 PM Window\nFlight Departs 5:50 A 3\nFlight Arrives 9:50 AN"
    );
    expect(t.departure).toBe("17:50");
    expect(t.arrival).toBe("09:50");
  });

  it("reads German 24-hour labels", () => {
    const t = readPrintedTimes("Abflug 07:15  Ankunft 09:05  12.03.2026");
    expect(t).toMatchObject({ departure: "07:15", arrival: "09:05" });
    expect(t.date).toEqual({ day: 12, month: 3, year: 2026 });
  });

  it("refuses an OCR year that cannot be a flight year", () => {
    expect(readPrintedTimes("JAN 2816").yearsByMonth.size).toBe(0);
    expect(readPrintedTimes("JAN 2016").yearsByMonth.get(1)).toBe(2016);
  });
});

describe("legTimesOn — the arrival date follows the clock", () => {
  it("rolls the arrival to the next day when it is earlier than the departure", () => {
    expect(legTimesOn("2016-01-08", { departure: "17:50", arrival: "09:50" })).toEqual({
      departureTime: "2016-01-08T17:50",
      arrivalTime: "2016-01-09T09:50",
    });
  });

  it("keeps a same-day arrival on the flight date", () => {
    expect(legTimesOn("2016-01-08", { departure: "12:46", arrival: "14:49" }).arrivalTime).toBe(
      "2016-01-08T14:49"
    );
  });
});
