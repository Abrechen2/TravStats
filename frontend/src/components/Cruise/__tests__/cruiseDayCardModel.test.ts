import { describe, it, expect, afterEach } from "vitest";
import { setClockForTests } from "../../../shared/time";
import {
  documentsOfDay,
  entryAtSlot,
  portStay,
  slotOfEntry,
  todayEntryKey,
} from "../cruiseDayCardModel";
import type { EffectiveTimelineEntry } from "../cruisePorts";
import type { CruiseStop, Port } from "../../../types";
import type { TravelDocument } from "../../../lib/api/documents";

/** forgejo#223: the day card's facts — which day is today, how long in port, which papers. */

const stop = (extra: Partial<CruiseStop>): CruiseStop =>
  ({
    id: "s",
    cruiseId: "c",
    portId: 1,
    port: null,
    dayNumber: 1,
    date: null,
    isAtSea: false,
    arrivalTime: null,
    departureTime: null,
    excursionNote: null,
    unresolvedPortName: null,
    ...extra,
  }) as CruiseStop;

const entry = (key: string, date: string, s: CruiseStop, port?: Partial<Port>) =>
  ({
    key,
    stop: s,
    port: port ? (port as Port) : null,
    isAtSea: s.isAtSea,
    unresolvedPortName: null,
    date,
    excursionNote: null,
  }) as EffectiveTimelineEntry;

describe("todayEntryKey", () => {
  afterEach(() => setClockForTests(null));

  it("asks 'today' in the port's zone, not the reader's", () => {
    // 14:00 UTC on 9 Oct is already 01:00 on 10 Oct in Sydney.
    const at = new Date("2026-10-09T14:00:00Z");
    const entries = [
      entry("berlin", "2026-10-09", stop({ stopZone: "Europe/Berlin" })),
      entry("sydney", "2026-10-10", stop({ stopZone: "Australia/Sydney" })),
    ];
    expect(todayEntryKey(entries.slice(1), "UTC", at)).toBe("sydney");
    expect(todayEntryKey(entries.slice(0, 1), "UTC", at)).toBe("berlin");
  });

  it("asks a zoneless sea day in the reader's 'today' zone, and returns null off the cruise", () => {
    const at = new Date("2026-10-09T23:30:00Z");
    const sea = [entry("sea", "2026-10-10", stop({ isAtSea: true, portId: null }))];
    expect(todayEntryKey(sea, "Europe/Berlin", at)).toBe("sea");
    expect(todayEntryKey(sea, "UTC", at)).toBeNull();
  });
});

describe("portStay", () => {
  it("measures between two instants in the port's zone", () => {
    const stay = portStay(
      stop({
        arrivalTime: "2026-10-07T08:00:00.000Z",
        departureTime: "2026-10-07T18:30:00.000Z",
        arrivalUtc: "2026-10-07T06:00:00.000Z",
        departureUtc: "2026-10-07T16:30:00.000Z",
        stopZone: "Europe/Oslo",
      })
    );
    expect(stay).toEqual({ arrive: "08:00", depart: "18:30", minutes: 630 });
  });

  it("shows wall clocks without a zone but does not subtract them", () => {
    const stay = portStay(
      stop({
        portId: null,
        unresolvedPortName: "Colón",
        arrivalTime: "2026-10-07T08:00:00.000Z",
        departureTime: "2026-10-07T18:00:00.000Z",
      })
    );
    expect(stay).toEqual({ arrive: "08:00", depart: "18:00", minutes: null });
  });

  it("leaves a missing time open", () => {
    expect(portStay(stop({ departureTime: "2026-10-07T18:00:00.000Z" }))).toMatchObject({
      arrive: null,
      minutes: null,
    });
  });
});

describe("documentsOfDay", () => {
  it("takes the originals dated that day and nothing else", () => {
    const docs = [
      { id: "a", issuedOn: "2026-10-07" },
      { id: "b", issuedOn: "2026-09-01" },
      { id: "c", issuedOn: null },
    ] as TravelDocument[];
    expect(documentsOfDay(docs, "2026-10-07").map((d) => d.id)).toEqual(["a"]);
    expect(documentsOfDay(docs, null)).toEqual([]);
  });
});

describe("day slots", () => {
  it("tells two calls on one day apart, and finds them again under new ids", () => {
    const before = [
      entry("a", "2026-10-07", stop({ id: "a", dayNumber: 3 })),
      entry("b", "2026-10-07", stop({ id: "b", dayNumber: 3 })),
    ];
    const slot = slotOfEntry(before, "b");
    expect(slot).toEqual({ day: 3, nth: 1 });
    const afterSave = [
      entry("a2", "2026-10-07", stop({ id: "a2", dayNumber: 3 })),
      entry("b2", "2026-10-07", stop({ id: "b2", dayNumber: 3 })),
    ];
    expect(entryAtSlot(afterSave, slot)?.key).toBe("b2");
    expect(slotOfEntry(before, "nope")).toBeNull();
  });
});
