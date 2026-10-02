import { flightChangedMessage, reminderMessage, type FlightForMessage } from "../messages";

/**
 * Push texts (TravStats#156): written on the server in the phone's language,
 * DE first and EN mirrored, and end-to-end encrypted afterwards.
 */
const flight: FlightForMessage = {
  id: "f1",
  flightNumber: "LH712",
  depIata: "FRA",
  arrIata: "HND",
  depTimezone: "Europe/Berlin",
  arrTimezone: "Asia/Tokyo",
  depTimeSemantics: "UTC",
  arrTimeSemantics: "UTC",
};
const change = (field: string, oldValue: unknown, newValue: unknown) => ({
  field,
  oldValue: oldValue as string,
  newValue: newValue as string,
  type: (oldValue == null ? "added" : "changed") as "added" | "changed",
});

describe("flightChangedMessage", () => {
  it("says a new gate in German and English", () => {
    expect(
      flightChangedMessage(flight, [change("gate", "A26", "B12")], { pending: false }, "de")
    ).toEqual({
      title: "LH712: neues Gate",
      body: "B12 statt A26",
    });
    expect(
      flightChangedMessage(flight, [change("gate", "A26", "B12")], { pending: false }, "en")
    ).toEqual({
      title: "LH712: new gate",
      body: "B12 instead of A26",
    });
  });

  it("names a first gate without an old one", () => {
    expect(
      flightChangedMessage(flight, [change("gate", null, "B12")], { pending: false }, "de")?.body
    ).toBe("Gate B12");
  });

  it("shows a new departure time in the departure airport's zone", () => {
    const msg = flightChangedMessage(
      flight,
      [change("departureTime", "2026-10-14T11:25:00.000Z", "2026-10-14T12:10:00.000Z")],
      { pending: false },
      "de"
    );
    expect(msg).toEqual({
      title: "LH712: neue Abflugzeit",
      body: "14:10 statt 13:25 (Ortszeit FRA)",
    });
  });

  it("says UTC when the flight has no zone, instead of guessing one", () => {
    const msg = flightChangedMessage(
      { ...flight, depTimezone: null },
      [change("departureTime", "2026-10-14T11:25:00.000Z", "2026-10-14T12:10:00.000Z")],
      { pending: false },
      "en"
    );
    expect(msg?.body).toBe("12:10 instead of 11:25 (UTC)");
  });

  it("reads the stored legacy wall clock as such, and the provider's value as a real instant", () => {
    // The old value comes from the row (fake UTC: 13:25 is the wall clock at
    // FRA); the new one comes from the provider, which always reports real
    // UTC — 12:10Z is 14:10 in Frankfurt, whatever the row's semantics.
    const msg = flightChangedMessage(
      { ...flight, depTimeSemantics: "LEGACY_FAKE_UTC" },
      [change("departureTime", "2026-10-14T13:25:00.000Z", "2026-10-14T12:10:00.000Z")],
      { pending: false },
      "de"
    );
    expect(msg?.body).toBe("14:10 statt 13:25 (Ortszeit FRA)");
  });

  it("names each zone when the old and the new time are read differently", () => {
    const msg = flightChangedMessage(
      { ...flight, depTimeSemantics: "LEGACY_FAKE_UTC", depTimezone: null },
      [change("departureTime", "2026-10-14T13:25:00.000Z", "2026-10-14T12:10:00.000Z")],
      { pending: false },
      "en"
    );
    expect(msg?.body).toBe("12:10 (UTC) instead of 13:25 (local time)");
  });

  it("never shows the stored time of a date-only flight, which has none", () => {
    const msg = flightChangedMessage(
      { ...flight, depTimeSemantics: "DATE_ONLY" },
      [change("departureTime", "2026-10-14T00:00:00.000Z", "2026-10-14T12:10:00.000Z")],
      { pending: false },
      "de"
    );
    expect(msg?.body).toBe("14:10 (Ortszeit FRA)");
  });

  it("says a cancellation plainly", () => {
    expect(
      flightChangedMessage(
        flight,
        [change("status", "scheduled", "cancelled")],
        { pending: false, cancelled: true },
        "de"
      )
    ).toEqual({
      title: "LH712: annulliert",
      body: "Laut Airline-Daten fällt der Flug aus.",
    });
  });

  it("says a diversion with the new destination", () => {
    expect(
      flightChangedMessage(
        flight,
        [change("arrIata", "HND", "NRT")],
        { pending: false, diverted: true },
        "en"
      )
    ).toEqual({
      title: "LH712: diverted",
      body: "New destination: NRT",
    });
  });

  it("joins several changes and asks for confirmation when pending", () => {
    const msg = flightChangedMessage(
      flight,
      [change("gate", "A26", "B12"), change("terminal", "1", "2")],
      { pending: true },
      "de"
    );
    expect(msg).toEqual({
      title: "LH712: Änderungen",
      body: "B12 statt A26 · Terminal 2 statt 1 — in TravStats bestätigen",
    });
  });

  it("stays silent for fields nobody waits for at the gate", () => {
    expect(
      flightChangedMessage(flight, [change("aircraft", "A320", "A321")], { pending: false }, "de")
    ).toBeNull();
  });

  it("falls back to the route when the flight has no number", () => {
    expect(
      flightChangedMessage(
        { ...flight, flightNumber: null },
        [change("gate", "A", "B")],
        { pending: false },
        "de"
      )?.title
    ).toBe("FRA → HND: neues Gate");
  });
});

describe("reminderMessage", () => {
  it("names the departure in local time", () => {
    const departure = new Date("2026-10-14T11:25:00.000Z");
    expect(reminderMessage({ ...flight, departureTime: departure }, 24, "de")).toEqual({
      title: "LH712: Abflug in 24 Stunden",
      body: "FRA → HND · 13:25 Ortszeit",
    });
    expect(reminderMessage({ ...flight, departureTime: departure }, 2, "en")).toEqual({
      title: "LH712: departs in 2 hours",
      body: "FRA → HND · 13:25 local time",
    });
  });

  it("leaves the time out for a date-only flight", () => {
    const departure = new Date("2026-10-14T00:00:00.000Z");
    expect(
      reminderMessage(
        { ...flight, depTimeSemantics: "DATE_ONLY", departureTime: departure },
        24,
        "de"
      )
    ).toEqual({ title: "LH712: Abflug in 24 Stunden", body: "FRA → HND" });
  });
});
