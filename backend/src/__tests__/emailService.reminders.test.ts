import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import type { TimeValue } from "../shared/time/wire";

// ─── Mocks ──────────────────────────────────────────────────────────────────

const mockSendMail = jest.fn();
const mockCreateTransport = jest.fn(() => ({ sendMail: mockSendMail }));
jest.mock("nodemailer", () => ({
  __esModule: true,
  default: { createTransport: mockCreateTransport },
}));

const mockSmtpConfigFindUnique = jest.fn();
jest.mock("../db", () => ({
  prisma: { smtpConfig: { findUnique: mockSmtpConfigFindUnique } },
}));

jest.mock("../routes/admin/smtp", () => ({ SMTP_CONFIG_ID: 1 }));

jest.mock("../utils/encryption", () => ({
  decryptApiKey: (v: string) => v,
  encryptApiKey: (v: string) => v,
}));

const mockGetInstanceSettings = jest.fn();
jest.mock("../services/instanceSettingsService", () => ({
  getInstanceSettings: mockGetInstanceSettings,
}));

jest.mock("../utils/logger", () => ({
  __esModule: true,
  default: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

// ─── Fixtures ───────────────────────────────────────────────────────────────

const SMTP_CONFIG = {
  id: 1,
  host: "smtp.example.com",
  port: 587,
  secure: false,
  username: "u",
  password: "p",
  fromEmail: "no-reply@example.com",
  fromName: "TravStats",
  enabled: true,
};

function tv(local: string, zone: string | null, utc: string): TimeValue {
  return {
    utc,
    zone,
    offset: "+00:00",
    local,
    precision: "minute",
    zoneSource: zone ? "stored" : null,
  };
}

// Departs New York (EDT, UTC-4) at 09:15 local == 13:15 UTC. The OLD
// `buildReminderHtml` rendered `departureTime.toISOString()` directly, i.e.
// the raw UTC reading "13:15" labelled "UTC" — never the airport's own clock.
const NON_UTC_DEPARTURE = tv("2026-09-27T09:15:00", "America/New_York", "2026-09-27T13:15:00.000Z");
const NON_UTC_ARRIVAL = tv("2026-09-27T21:40:00", "Europe/Berlin", "2026-09-27T19:40:00.000Z");

beforeEach(() => {
  jest.clearAllMocks();
  mockSmtpConfigFindUnique.mockResolvedValue(SMTP_CONFIG);
  mockGetInstanceSettings.mockResolvedValue({ frontendUrl: "https://travstats.test" });
  mockSendMail.mockResolvedValue(undefined);
});

describe("sendFlightReminder", () => {
  const baseFlight = {
    id: "flight-1",
    tripId: null,
    flightNumber: "LH100",
    airline: "Lufthansa",
    aircraft: "A320",
    seatNumber: "14C",
    depName: "New York JFK",
    depIata: "JFK",
    arrName: "Frankfurt",
    arrIata: "FRA",
    departure: NON_UTC_DEPARTURE,
    arrival: NON_UTC_ARRIVAL,
    durationMinutes: 495,
  };

  it("shows both ends' LOCAL time, not the raw UTC instant (positive control: fails on the pre-redesign build)", async () => {
    const { sendFlightReminder } = await import("../services/emailService");
    await sendFlightReminder(
      baseFlight,
      { notificationEmail: "user@example.com", settingsData: { display: { language: "de" } } },
      24
    );

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const html = mockSendMail.mock.calls[0][0].html as string;
    expect(html).toContain("09:15"); // JFK local departure
    expect(html).toContain("21:40"); // FRA local arrival
    expect(html).not.toContain("13:15"); // raw UTC departure — the old bug
    expect(html).not.toContain("19:40"); // raw UTC arrival
  });

  it("renders DE copy for a DE-language user", async () => {
    const { sendFlightReminder } = await import("../services/emailService");
    await sendFlightReminder(
      baseFlight,
      { notificationEmail: "user@example.com", settingsData: { display: { language: "de" } } },
      24
    );
    const [{ subject, html }] = mockSendMail.mock.calls[0];
    expect(subject).toContain("Flug-Erinnerung");
    expect(html).toContain("Flugzeug");
    expect(html).toContain("Sitzplatz");
    expect(html).toContain("Uhr");
  });

  it("renders EN copy for an EN-language user — same data, different language", async () => {
    const { sendFlightReminder } = await import("../services/emailService");
    await sendFlightReminder(
      baseFlight,
      { notificationEmail: "user@example.com", settingsData: { display: { language: "en" } } },
      24
    );
    const [{ subject, html }] = mockSendMail.mock.calls[0];
    expect(subject).toContain("Flight reminder");
    expect(html).toContain("Aircraft");
    expect(html).toContain("Seat");
    expect(html).not.toContain("Uhr");
  });

  it("defaults to DE when the user has no language preference stored", async () => {
    const { sendFlightReminder } = await import("../services/emailService");
    await sendFlightReminder(
      baseFlight,
      { notificationEmail: "user@example.com", settingsData: null },
      24
    );
    const [{ subject }] = mockSendMail.mock.calls[0];
    expect(subject).toContain("Flug-Erinnerung");
  });

  it("includes airline, aircraft, seat and duration", async () => {
    const { sendFlightReminder } = await import("../services/emailService");
    await sendFlightReminder(
      baseFlight,
      { notificationEmail: "user@example.com", settingsData: { display: { language: "de" } } },
      24
    );
    const html = mockSendMail.mock.calls[0][0].html as string;
    expect(html).toContain("Lufthansa");
    expect(html).toContain("A320");
    expect(html).toContain("14C");
    expect(html).toContain("8 Std. 15 Min."); // 495 minutes
  });

  it("links to the trip when the flight belongs to one, else to the flight itself", async () => {
    const { sendFlightReminder } = await import("../services/emailService");
    await sendFlightReminder(
      { ...baseFlight, tripId: "trip-42" },
      { notificationEmail: "user@example.com", settingsData: null },
      24
    );
    let html = mockSendMail.mock.calls[0][0].html as string;
    expect(html).toContain("https://travstats.test/trips/trip-42");

    jest.clearAllMocks();
    mockSmtpConfigFindUnique.mockResolvedValue(SMTP_CONFIG);
    mockGetInstanceSettings.mockResolvedValue({ frontendUrl: "https://travstats.test" });
    mockSendMail.mockResolvedValue(undefined);
    await sendFlightReminder(
      baseFlight,
      { notificationEmail: "user@example.com", settingsData: null },
      24
    );
    html = mockSendMail.mock.calls[0][0].html as string;
    expect(html).toContain("https://travstats.test/flights/flight-1");
  });

  it("never sends when the user has no notification email", async () => {
    const { sendFlightReminder } = await import("../services/emailService");
    await sendFlightReminder(baseFlight, { notificationEmail: null, settingsData: null }, 24);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("never sends when SMTP is disabled", async () => {
    mockSmtpConfigFindUnique.mockResolvedValue({ ...SMTP_CONFIG, enabled: false });
    const { sendFlightReminder } = await import("../services/emailService");
    await sendFlightReminder(
      baseFlight,
      { notificationEmail: "user@example.com", settingsData: null },
      24
    );
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("escapes a booking-sourced flight number instead of injecting it as HTML", async () => {
    const { sendFlightReminder } = await import("../services/emailService");
    await sendFlightReminder(
      { ...baseFlight, flightNumber: `<img src=x onerror=alert(1)>` },
      { notificationEmail: "user@example.com", settingsData: null },
      24
    );
    const html = mockSendMail.mock.calls[0][0].html as string;
    expect(html).not.toContain("<img src=x onerror=alert(1)>");
    expect(html).toContain("&lt;img");
  });

  // Until forgejo#189 the mail was HTML only: a text-only client, and every
  // spam filter that scores a missing text part, got nothing to read.
  it("sends a plain-text alternative carrying the same facts as the HTML part", async () => {
    const { sendFlightReminder } = await import("../services/emailService");
    await sendFlightReminder(
      { ...baseFlight, terminal: "1", gate: "B44", bookingReference: "X7YZ9Q" },
      { notificationEmail: "user@example.com", settingsData: { display: { language: "de" } } },
      24
    );
    const { text, html } = mockSendMail.mock.calls[0][0] as { text: string; html: string };
    expect(text).not.toMatch(/<[a-z]/i);
    for (const part of [text, html]) {
      for (const fact of ["LH100", "Lufthansa", "09:15", "21:40", "14C", "B44", "X7YZ9Q"]) {
        expect(part).toContain(fact);
      }
    }
    expect(text).toContain("https://travstats.test/flights/flight-1");
    expect(text).toContain("https://travstats.test/settings?section=notifications");
  });

  it("does not double the slash when the instance URL ends in one", async () => {
    mockGetInstanceSettings.mockResolvedValue({ frontendUrl: "https://travstats.test/" });
    const { sendFlightReminder } = await import("../services/emailService");
    await sendFlightReminder(
      baseFlight,
      { notificationEmail: "user@example.com", settingsData: null },
      24
    );
    const { text } = mockSendMail.mock.calls[0][0] as { text: string };
    expect(text).toContain("https://travstats.test/flights/flight-1");
    expect(text).not.toContain("test//");
  });
});

describe("sendCruiseReminder", () => {
  it("shows the port's local time and the ship's cabin", async () => {
    const { sendCruiseReminder } = await import("../services/emailService");
    await sendCruiseReminder(
      {
        id: "cruise-1",
        tripId: null,
        shipName: "MS Example",
        cruiseLine: "Example Line",
        portName: "Port Miami",
        portCity: "Miami",
        portCountry: "US",
        cabinType: "Balcony",
        cabinNumber: "8102",
        deck: 8,
        departure: tv("2026-09-27T16:00:00", "America/New_York", "2026-09-27T20:00:00.000Z"),
      },
      { notificationEmail: "user@example.com", settingsData: { display: { language: "de" } } },
      24
    );

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const html = mockSendMail.mock.calls[0][0].html as string;
    expect(html).toContain("16:00");
    expect(html).not.toContain("20:00");
    expect(html).toContain("MS Example");
    expect(html).toContain("Balcony 8102");
  });
});

describe("sendRailReminder", () => {
  it("shows both stations' local times and the operator", async () => {
    const { sendRailReminder } = await import("../services/emailService");
    await sendRailReminder(
      [
        {
          id: "journey-1",
          tripId: null,
          operator: "DB",
          trainCategory: "ICE",
          trainNumber: "123",
          coach: "12",
          seat: "34",
          depStationName: "Berlin Hbf",
          arrStationName: "Munich Hbf",
          departure: tv("2026-09-27T08:00:00", "Europe/Berlin", "2026-09-27T06:00:00.000Z"),
          arrival: tv("2026-09-27T12:30:00", "Europe/Berlin", "2026-09-27T10:30:00.000Z"),
        },
      ],
      { notificationEmail: "user@example.com", settingsData: { display: { language: "en" } } },
      2
    );

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const { html, text } = mockSendMail.mock.calls[0][0] as { html: string; text: string };
    expect(html).toContain("Berlin Hbf");
    expect(html).toContain("Munich Hbf");
    expect(html).toContain("DB");
    expect(text).toContain("Coach: 12");
    expect(text).toContain("Seat: 34");
  });

  // forgejo#210: a ride with a change goes out as ONE mail, both trains in it.
  it("sends a ride with a change as one mail naming its destination", async () => {
    const { sendRailReminder } = await import("../services/emailService");
    const base = {
      tripId: null,
      operator: "DB",
      coach: null,
      seat: null,
    };
    await sendRailReminder(
      [
        {
          ...base,
          id: "leg-1",
          trainCategory: "ICE",
          trainNumber: "911",
          depStationName: "Augsburg Hbf",
          arrStationName: "München Hbf",
          departure: tv("2026-10-11T09:12:00", "Europe/Berlin", "2026-10-11T07:12:00.000Z"),
          arrival: tv("2026-10-11T09:52:00", "Europe/Berlin", "2026-10-11T07:52:00.000Z"),
        },
        {
          ...base,
          id: "leg-2",
          trainCategory: "EC",
          trainNumber: "115",
          depStationName: "München Hbf",
          arrStationName: "Salzburg Hbf",
          departure: tv("2026-10-11T10:17:00", "Europe/Berlin", "2026-10-11T08:17:00.000Z"),
          arrival: tv("2026-10-11T11:57:00", "Europe/Vienna", "2026-10-11T09:57:00.000Z"),
        },
      ],
      { notificationEmail: "user@example.com", settingsData: { display: { language: "de" } } },
      24
    );

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const mail = mockSendMail.mock.calls[0][0] as { subject: string; html: string; text: string };
    expect(mail.subject).toBe("Zug-Erinnerung: Deine Fahrt nach Salzburg Hbf in 24h");
    for (const part of [mail.html, mail.text]) {
      expect(part).toContain("ICE 911");
      expect(part).toContain("EC 115");
    }
  });
});

describe("sendLodgingCheckInReminder", () => {
  it("shows the property, room and check-in day", async () => {
    const { sendLodgingCheckInReminder } = await import("../services/emailService");
    await sendLodgingCheckInReminder(
      {
        id: "stay-1",
        lodgingId: "lodging-7",
        tripId: null,
        lodgingName: "Hotel Example",
        city: "Tokyo",
        country: "Japan",
        roomNumber: "204",
        roomCategory: "Double",
        checkInAt: null,
        checkInDay: { date: "2026-09-27", zone: "Asia/Tokyo", precision: "day" },
      },
      { notificationEmail: "user@example.com", settingsData: { display: { language: "de" } } }
    );

    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const html = mockSendMail.mock.calls[0][0].html as string;
    expect(html).toContain("Hotel Example");
    expect(html).toContain("Tokyo");
    expect(html).toContain("204");
    // The day as a traveller reads it, not the raw `YYYY-MM-DD` it is stored as.
    expect(html).toContain("So., 27.09.2026");
    expect(html).not.toContain("2026-09-27");
  });
});
