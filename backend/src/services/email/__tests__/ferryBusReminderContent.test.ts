import { describe, it, expect } from "@jest/globals";
import { renderMailHtml, renderMailText } from "../mailShell";
import {
  busReminderContent,
  ferryReminderContent,
  type BusReminderData,
  type FerryReminderData,
} from "../ferryBusReminderContent";
import { REMINDER_DOMAIN_COLORS } from "../reminderContent";
import { DOMAINS } from "../../../shared/domains";
import { serializeTime } from "../../../shared/time/wire";

const LINKS = { base: "https://travstats.test" };

function render(content: Parameters<typeof renderMailHtml>[0]): { html: string; text: string } {
  return { html: renderMailHtml(content), text: renderMailText(content) };
}

describe("ferryReminderContent", () => {
  const crossing: FerryReminderData = {
    id: "ferry-1",
    tripId: null,
    operator: "Stena Line",
    vesselName: "Stena Germanica",
    fareClass: null,
    cabinType: "Außenkabine",
    seat: null,
    vehicleType: "PKW",
    vehicleRegistration: "KI-AB 123",
    bookingReference: "STN123",
    ticketReference: "STN123",
    depStationName: "Kiel",
    arrStationName: "Göteborg",
    // 16:45 UTC is 18:45 in Kiel (CEST); 07:15 UTC is 09:15 in Göteborg (CEST).
    departure: serializeTime(new Date("2026-09-27T16:45:00.000Z"), "Europe/Berlin"),
    arrival: serializeTime(new Date("2026-09-28T07:15:00.000Z"), "Europe/Stockholm"),
  };

  it("names the destination port and shows both ports on their own clock", () => {
    const content = ferryReminderContent(crossing, 24, "de", LINKS);
    const { html, text } = render(content);
    expect(content.subject).toBe("Fähr-Erinnerung: Deine Überfahrt nach Göteborg in 24h");
    expect(content.accent).toBe(DOMAINS.ferry.color);
    for (const part of [html, text]) {
      expect(part).toContain("Deine Überfahrt nach Göteborg startet in 24 Stunden");
      expect(part).toContain("18:45 Uhr");
      expect(part).toContain("09:15 Uhr");
      expect(part).toContain("Stena Germanica");
      expect(part).toContain("Stena Line");
      expect(part).toContain("Außenkabine");
      expect(part).toContain("PKW · KI-AB 123");
      expect(part).toContain("Alle Zeiten sind Ortszeiten.");
      expect(part).toContain(`${LINKS.base}/ferry/ferry-1`);
    }
    // One code printed once: the ticket number equals the booking reference.
    expect(text.match(/STN123/g)).toHaveLength(1);
  });

  it("says it in English, and leaves out what the crossing does not carry", () => {
    const content = ferryReminderContent(
      {
        ...crossing,
        tripId: "trip-9",
        operator: null,
        vesselName: null,
        cabinType: null,
        vehicleType: null,
        vehicleRegistration: null,
        bookingReference: null,
        ticketReference: "T-77",
        arrival: null,
      },
      2,
      "en",
      LINKS
    );
    const { text } = render(content);
    expect(content.subject).toBe("Ferry reminder: your crossing to Göteborg in 2h");
    expect(text).toContain("Your crossing to Göteborg leaves in 2 hours");
    expect(text).toContain("Ticket: T-77");
    expect(text).toContain(`${LINKS.base}/trips/trip-9`);
    expect(text).not.toMatch(/Vessel|Operator|Cabin|Vehicle|Booking reference|null/);
  });
});

describe("busReminderContent", () => {
  const ride: BusReminderData = {
    id: "bus-1",
    tripId: null,
    operator: "FlixBus",
    lineName: "N17",
    fareClass: "Standard",
    seat: "12A",
    bookingReference: "FLX123",
    depStationName: "München ZOB",
    arrStationName: "Praha ÚAN Florenc",
    // 06:00 UTC is 08:00 in both terminals' zone (CEST).
    departure: serializeTime(new Date("2026-09-27T06:00:00.000Z"), "Europe/Berlin"),
    arrival: serializeTime(new Date("2026-09-27T11:30:00.000Z"), "Europe/Prague"),
  };

  it("names the destination terminal, its line, seat and both local times", () => {
    const content = busReminderContent(ride, 2, "de", LINKS);
    const { html, text } = render(content);
    expect(content.subject).toBe("Bus-Erinnerung: Deine Fahrt nach Praha ÚAN Florenc in 2h");
    expect(content.accent).toBe(DOMAINS.bus.color);
    for (const part of [html, text]) {
      expect(part).toContain("Deine Fahrt nach Praha ÚAN Florenc startet in 2 Stunden");
      expect(part).toContain("08:00 Uhr");
      expect(part).toContain("13:30 Uhr");
      expect(part).toContain("N17");
      expect(part).toContain("FlixBus");
      expect(part).toContain("FLX123");
      expect(part).toContain(`${LINKS.base}/bus/bus-1`);
    }
    expect(text).toContain("Tarif: Standard\nPlatz: 12A");
  });

  it("says it in English, and leaves out what the ride does not carry", () => {
    const content = busReminderContent(
      {
        ...ride,
        operator: null,
        lineName: null,
        fareClass: null,
        seat: null,
        bookingReference: null,
        arrival: null,
      },
      24,
      "en",
      LINKS
    );
    const { text } = render(content);
    expect(content.subject).toBe("Bus reminder: your journey to Praha ÚAN Florenc in 24h");
    expect(text).toContain("Your journey to Praha ÚAN Florenc leaves in 24 hours");
    expect(text).not.toMatch(/Line|Operator|Fare|Seat|Booking reference|null/);
  });
});

describe("ferry and bus colours", () => {
  it("are the domain registry's", () => {
    expect(REMINDER_DOMAIN_COLORS.ferry).toBe(DOMAINS.ferry.color);
    expect(REMINDER_DOMAIN_COLORS.bus).toBe(DOMAINS.bus.color);
  });
});
