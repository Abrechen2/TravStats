import { describe, it, expect } from "@jest/globals";
import {
  rentalReminderContent,
  roadtripStationReminderContent,
  placeVisitReminderContent,
} from "../entryReminderContent";
import { serializeTime, serializeDay } from "../../../shared/time/wire";

const links = { base: "https://trav.example" };

describe("entry reminder mails (forgejo#405)", () => {
  const base = {
    id: "r1",
    tripId: null,
    provider: "Sixt",
    confirmationNumber: "ABC",
    vehicleClass: null,
    vehicleExample: null,
    licensePlate: null,
    pickupStationName: "Lisbon",
    pickupAddress: null,
    returnStationName: "Porto",
    returnAddress: null,
    pickup: serializeTime(new Date("2026-06-10T09:00:00Z"), "Europe/Lisbon", "minute"),
    return: serializeTime(new Date("2026-06-17T09:00:00Z"), "Europe/Lisbon", "minute"),
  };

  it("names the pick-up station for a pick-up and the return station for a return", () => {
    const pickup = rentalReminderContent({ ...base, part: "pickup" }, 24, "en", links);
    const back = rentalReminderContent({ ...base, part: "return" }, 24, "de", links);
    expect(pickup.subject).toContain("pick-up at Lisbon");
    expect(back.subject).toContain("Rückgabe bei Porto");
    expect(pickup.blocks.some((b) => b.kind === "button" && b.url.endsWith("/rentals/r1"))).toBe(
      true
    );
  });

  it("links a roadtrip station to its roadtrip and prints no local-time note (a day, not a clock)", () => {
    const mail = roadtripStationReminderContent(
      {
        id: "s1",
        tripId: null,
        roadtripId: "rt1",
        roadtripName: "Norway",
        stationName: "Odda",
        stayName: null,
        arrivalDay: serializeDay("2026-06-10", "Europe/Oslo"),
        nights: null,
      },
      2,
      "en",
      links
    );
    expect(mail.blocks.some((b) => b.kind === "button" && b.url.endsWith("/roadtrips/rt1"))).toBe(
      true
    );
    expect(JSON.stringify(mail.blocks)).not.toContain("local");
  });

  it("links a place visit to the place", () => {
    const mail = placeVisitReminderContent(
      {
        id: "v1",
        tripId: null,
        placeId: "p1",
        placeName: "Colosseum",
        address: null,
        city: "Rome",
        country: "Italy",
        notes: null,
        visitAt: serializeTime(new Date("2026-06-10T09:00:00Z"), "Europe/Rome", "minute"),
      },
      24,
      "de",
      links
    );
    expect(mail.subject).toContain("Colosseum");
    expect(mail.blocks.some((b) => b.kind === "button" && b.url.endsWith("/places/p1"))).toBe(true);
  });
});
