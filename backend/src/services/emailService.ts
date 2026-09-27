import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { SmtpConfig } from "../prisma";
import { prisma } from "../db";
import logger from "../utils/logger";
import { SMTP_CONFIG_ID } from "../routes/admin/smtp";
import { decryptApiKey } from "../utils/encryption";
import { getInstanceSettings } from "./instanceSettingsService";
import { tripNameLanguageOf, type TripNameLanguage } from "./trip/tripGrouping";
import { renderReminderShell } from "./email/reminderShell";
import {
  escapeHtml,
  formatDurationMinutes,
  formatHoursUntil,
  formatTimeValue,
  type ReminderLang,
} from "./email/reminderFormat";
import type { LocalDateValue, TimeValue } from "../shared/time/wire";

export interface SmtpConfigInput {
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
}

/** Every reminder builder reads the recipient's language the same way trip names do (`display.language`). */
export interface ReminderUser {
  notificationEmail: string | null;
  settingsData: unknown;
}

function reminderLang(user: ReminderUser): ReminderLang {
  const lang: TripNameLanguage = tripNameLanguageOf(user.settingsData);
  return lang;
}

function createTransporterFromConfig(config: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.username,
      pass: decryptApiKey(config.password) ?? config.password,
    },
  });
}

/** SMTP config, or null (logged) when mail delivery is off — every reminder sender shares this gate. */
async function enabledSmtpConfig(operation: string): Promise<SmtpConfig | null> {
  const config = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
  if (!config || !config.enabled) {
    logger.info({ operation, message: "SMTP not configured or disabled" });
    return null;
  }
  return config;
}

async function frontendBaseUrl(): Promise<string> {
  const { frontendUrl } = await getInstanceSettings();
  return frontendUrl ?? "http://localhost:3000";
}

const CTA_LABEL: Record<ReminderLang, string> = {
  de: "In TravStats öffnen",
  en: "Open in TravStats",
};

interface FlightReminderData {
  id: string;
  tripId: string | null;
  flightNumber: string | null;
  airline: string | null;
  aircraft: string | null;
  seatNumber: string | null;
  depName: string | null;
  depIata: string | null;
  arrName: string | null;
  arrIata: string | null;
  departure: TimeValue | null;
  arrival: TimeValue | null;
  durationMinutes: number | null;
}

function flightReminderBody(
  flight: FlightReminderData,
  hoursUntilDeparture: number,
  lang: ReminderLang
): { heading: string; bodyHtml: string } {
  const flightNumber = flight.flightNumber ? escapeHtml(flight.flightNumber) : null;
  const depAirport = escapeHtml(flight.depIata ?? flight.depName ?? "?");
  const arrAirport = escapeHtml(flight.arrIata ?? flight.arrName ?? "?");
  const departure = formatTimeValue(flight.departure, lang);
  const arrival = formatTimeValue(flight.arrival, lang);
  const duration = formatDurationMinutes(flight.durationMinutes, lang);
  const until = formatHoursUntil(hoursUntilDeparture, lang);

  const heading =
    lang === "de"
      ? `Dein Flug${flightNumber ? ` ${flightNumber}` : ""} geht ${until}`
      : `Your flight${flightNumber ? ` ${flightNumber}` : ""} leaves ${until}`;

  const rows: string[] = [];
  const row = (label: string, value: string | null): void => {
    if (!value) return;
    rows.push(
      `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;">${label}</td>` +
        `<td style="padding:4px 0;">${value}</td></tr>`
    );
  };

  if (lang === "de") {
    row("Von", `${depAirport}${departure ? ` — ${departure}` : ""}`);
    row("Nach", `${arrAirport}${arrival ? ` — ${arrival}` : ""}`);
    row("Airline", flight.airline ? escapeHtml(flight.airline) : null);
    row("Flugzeug", flight.aircraft ? escapeHtml(flight.aircraft) : null);
    row("Sitzplatz", flight.seatNumber ? escapeHtml(flight.seatNumber) : null);
    row("Flugdauer", duration);
  } else {
    row("From", `${depAirport}${departure ? ` — ${departure}` : ""}`);
    row("To", `${arrAirport}${arrival ? ` — ${arrival}` : ""}`);
    row("Airline", flight.airline ? escapeHtml(flight.airline) : null);
    row("Aircraft", flight.aircraft ? escapeHtml(flight.aircraft) : null);
    row("Seat", flight.seatNumber ? escapeHtml(flight.seatNumber) : null);
    row("Duration", duration);
  }

  return {
    heading,
    bodyHtml: `<table role="presentation" style="border-collapse:collapse;">${rows.join("")}</table>`,
  };
}

export async function sendFlightReminder(
  flight: FlightReminderData,
  user: ReminderUser,
  hoursUntilDeparture: number
): Promise<void> {
  if (!user.notificationEmail) {
    logger.warn({
      operation: "email_reminder_skipped",
      message: "No notification email set for user",
      flightId: flight.id,
    });
    return;
  }

  const config = await enabledSmtpConfig("email_reminder_skipped");
  if (!config) return;

  const lang = reminderLang(user);
  const base = await frontendBaseUrl();
  const { heading, bodyHtml } = flightReminderBody(flight, hoursUntilDeparture, lang);
  const html = renderReminderShell({
    lang,
    domain: "flight",
    preheader: heading,
    heading,
    bodyHtml,
    ctaUrl: `${base}/${flight.tripId ? `trips/${flight.tripId}` : `flights/${flight.id}`}`,
    ctaLabel: CTA_LABEL[lang],
    settingsUrl: `${base}/settings/notifications`,
  });
  const flightNumber = flight.flightNumber ?? "N/A";
  const subject =
    lang === "de"
      ? `Flug-Erinnerung: ${flightNumber} in ${hoursUntilDeparture}h`
      : `Flight reminder: ${flightNumber} in ${hoursUntilDeparture}h`;

  const transporter = createTransporterFromConfig(config);
  try {
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: user.notificationEmail,
      subject,
      html,
    });

    logger.info({
      operation: "email_reminder_sent",
      domain: "flight",
      flightId: flight.id,
      hoursUntilDeparture,
    });
    logger.debug({ operation: "email_reminder_sent", to: user.notificationEmail });
  } catch (error) {
    logger.error({
      operation: "email_reminder_send_failed",
      domain: "flight",
      flightId: flight.id,
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
    throw error;
  }
}

interface CruiseReminderData {
  id: string;
  tripId: string | null;
  shipName: string | null;
  cruiseLine: string | null;
  portName: string | null;
  portCity: string | null;
  portCountry: string | null;
  cabinType: string | null;
  cabinNumber: string | null;
  deck: number | null;
  departure: TimeValue;
}

export async function sendCruiseReminder(
  cruise: CruiseReminderData,
  user: ReminderUser,
  hoursUntilDeparture: number
): Promise<void> {
  if (!user.notificationEmail) {
    logger.warn({
      operation: "email_reminder_skipped",
      message: "No notification email set for user",
      cruiseId: cruise.id,
    });
    return;
  }

  const config = await enabledSmtpConfig("email_reminder_skipped");
  if (!config) return;

  const lang = reminderLang(user);
  const base = await frontendBaseUrl();
  const shipName = cruise.shipName
    ? escapeHtml(cruise.shipName)
    : lang === "de"
      ? "Dein Schiff"
      : "Your ship";
  const port = cruise.portName ? escapeHtml(cruise.portName) : null;
  const portPlace = [port, cruise.portCity ? escapeHtml(cruise.portCity) : null]
    .filter(Boolean)
    .join(", ");
  const departure = formatTimeValue(cruise.departure, lang);
  const until = formatHoursUntil(hoursUntilDeparture, lang);
  const heading = lang === "de" ? `${shipName} legt ${until} ab` : `${shipName} departs ${until}`;

  const rows: string[] = [];
  const row = (label: string, value: string | null): void => {
    if (!value) return;
    rows.push(
      `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;">${label}</td>` +
        `<td style="padding:4px 0;">${value}</td></tr>`
    );
  };
  if (lang === "de") {
    row("Hafen", `${portPlace}${departure ? ` — ${departure}` : ""}`);
    row("Reederei", cruise.cruiseLine ? escapeHtml(cruise.cruiseLine) : null);
    row(
      "Kabine",
      cruise.cabinType || cruise.cabinNumber
        ? escapeHtml([cruise.cabinType, cruise.cabinNumber].filter(Boolean).join(" "))
        : null
    );
    row("Deck", cruise.deck !== null ? String(cruise.deck) : null);
  } else {
    row("Port", `${portPlace}${departure ? ` — ${departure}` : ""}`);
    row("Cruise line", cruise.cruiseLine ? escapeHtml(cruise.cruiseLine) : null);
    row(
      "Cabin",
      cruise.cabinType || cruise.cabinNumber
        ? escapeHtml([cruise.cabinType, cruise.cabinNumber].filter(Boolean).join(" "))
        : null
    );
    row("Deck", cruise.deck !== null ? String(cruise.deck) : null);
  }

  const html = renderReminderShell({
    lang,
    domain: "cruise",
    preheader: heading,
    heading,
    bodyHtml: `<table role="presentation" style="border-collapse:collapse;">${rows.join("")}</table>`,
    ctaUrl: `${base}/${cruise.tripId ? `trips/${cruise.tripId}` : `cruises/${cruise.id}`}`,
    ctaLabel: CTA_LABEL[lang],
    settingsUrl: `${base}/settings/notifications`,
  });
  const subject =
    lang === "de"
      ? `Kreuzfahrt-Erinnerung: ${cruise.shipName ?? "Abfahrt"} in ${hoursUntilDeparture}h`
      : `Cruise reminder: ${cruise.shipName ?? "Departure"} in ${hoursUntilDeparture}h`;

  const transporter = createTransporterFromConfig(config);
  try {
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: user.notificationEmail,
      subject,
      html,
    });
    logger.info({
      operation: "email_reminder_sent",
      domain: "cruise",
      cruiseId: cruise.id,
      hoursUntilDeparture,
    });
    logger.debug({ operation: "email_reminder_sent", to: user.notificationEmail });
  } catch (error) {
    logger.error({
      operation: "email_reminder_send_failed",
      domain: "cruise",
      cruiseId: cruise.id,
      error: { message: error instanceof Error ? error.message : "Unknown error" },
    });
    throw error;
  }
}

interface RailReminderData {
  id: string;
  tripId: string | null;
  operator: string | null;
  trainCategory: string | null;
  trainNumber: string | null;
  coach: string | null;
  seat: string | null;
  depStationName: string;
  arrStationName: string;
  departure: TimeValue;
  arrival: TimeValue | null;
}

export async function sendRailReminder(
  journey: RailReminderData,
  user: ReminderUser,
  hoursUntilDeparture: number
): Promise<void> {
  if (!user.notificationEmail) {
    logger.warn({
      operation: "email_reminder_skipped",
      message: "No notification email set for user",
      railJourneyId: journey.id,
    });
    return;
  }

  const config = await enabledSmtpConfig("email_reminder_skipped");
  if (!config) return;

  const lang = reminderLang(user);
  const base = await frontendBaseUrl();
  const trainName = [journey.trainCategory, journey.trainNumber].filter(Boolean).join(" ");
  const departure = formatTimeValue(journey.departure, lang);
  const arrival = formatTimeValue(journey.arrival, lang);
  const until = formatHoursUntil(hoursUntilDeparture, lang);
  const heading =
    lang === "de"
      ? `Deine Zugfahrt${trainName ? ` ${escapeHtml(trainName)}` : ""} startet ${until}`
      : `Your train${trainName ? ` ${escapeHtml(trainName)}` : ""} leaves ${until}`;

  const rows: string[] = [];
  const row = (label: string, value: string | null): void => {
    if (!value) return;
    rows.push(
      `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;">${label}</td>` +
        `<td style="padding:4px 0;">${value}</td></tr>`
    );
  };
  const seatText = [
    journey.coach ? `${lang === "de" ? "Wagen" : "Coach"} ${journey.coach}` : null,
    journey.seat,
  ]
    .filter(Boolean)
    .join(", ");
  if (lang === "de") {
    row("Von", `${escapeHtml(journey.depStationName)}${departure ? ` — ${departure}` : ""}`);
    row("Nach", `${escapeHtml(journey.arrStationName)}${arrival ? ` — ${arrival}` : ""}`);
    row("Betreiber", journey.operator ? escapeHtml(journey.operator) : null);
    row("Platz", seatText ? escapeHtml(seatText) : null);
  } else {
    row("From", `${escapeHtml(journey.depStationName)}${departure ? ` — ${departure}` : ""}`);
    row("To", `${escapeHtml(journey.arrStationName)}${arrival ? ` — ${arrival}` : ""}`);
    row("Operator", journey.operator ? escapeHtml(journey.operator) : null);
    row("Seat", seatText ? escapeHtml(seatText) : null);
  }

  const html = renderReminderShell({
    lang,
    domain: "rail",
    preheader: heading,
    heading,
    bodyHtml: `<table role="presentation" style="border-collapse:collapse;">${rows.join("")}</table>`,
    ctaUrl: `${base}/${journey.tripId ? `trips/${journey.tripId}` : `rail/${journey.id}`}`,
    ctaLabel: CTA_LABEL[lang],
    settingsUrl: `${base}/settings/notifications`,
  });
  const subject =
    lang === "de"
      ? `Zug-Erinnerung: ${trainName || journey.depStationName} in ${hoursUntilDeparture}h`
      : `Rail reminder: ${trainName || journey.depStationName} in ${hoursUntilDeparture}h`;

  const transporter = createTransporterFromConfig(config);
  try {
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: user.notificationEmail,
      subject,
      html,
    });
    logger.info({
      operation: "email_reminder_sent",
      domain: "rail",
      railJourneyId: journey.id,
      hoursUntilDeparture,
    });
    logger.debug({ operation: "email_reminder_sent", to: user.notificationEmail });
  } catch (error) {
    logger.error({
      operation: "email_reminder_send_failed",
      domain: "rail",
      railJourneyId: journey.id,
      error: { message: error instanceof Error ? error.message : "Unknown error" },
    });
    throw error;
  }
}

interface LodgingReminderData {
  id: string;
  tripId: string | null;
  lodgingName: string;
  city: string | null;
  country: string | null;
  roomNumber: string | null;
  roomCategory: string | null;
  checkInAt: TimeValue | null;
  checkInDay: LocalDateValue;
}

export async function sendLodgingCheckInReminder(
  stay: LodgingReminderData,
  user: ReminderUser
): Promise<void> {
  if (!user.notificationEmail) {
    logger.warn({
      operation: "email_reminder_skipped",
      message: "No notification email set for user",
      lodgingStayId: stay.id,
    });
    return;
  }

  const config = await enabledSmtpConfig("email_reminder_skipped");
  if (!config) return;

  const lang = reminderLang(user);
  const base = await frontendBaseUrl();
  const name = escapeHtml(stay.lodgingName);
  const place = [stay.city, stay.country]
    .filter((v): v is string => Boolean(v))
    .map(escapeHtml)
    .join(", ");
  const time = stay.checkInAt ? formatTimeValue(stay.checkInAt, lang) : null;
  const heading = lang === "de" ? `Heute Check-in bei ${name}` : `Check-in today at ${name}`;

  const rows: string[] = [];
  const row = (label: string, value: string | null): void => {
    if (!value) return;
    rows.push(
      `<tr><td style="padding:4px 12px 4px 0;color:#6b7280;white-space:nowrap;">${label}</td>` +
        `<td style="padding:4px 0;">${value}</td></tr>`
    );
  };
  if (lang === "de") {
    row("Unterkunft", `${name}${place ? ` — ${place}` : ""}`);
    row("Check-in", time ?? stay.checkInDay.date);
    row("Zimmer", stay.roomNumber ? escapeHtml(stay.roomNumber) : null);
    row("Kategorie", stay.roomCategory ? escapeHtml(stay.roomCategory) : null);
  } else {
    row("Property", `${name}${place ? ` — ${place}` : ""}`);
    row("Check-in", time ?? stay.checkInDay.date);
    row("Room", stay.roomNumber ? escapeHtml(stay.roomNumber) : null);
    row("Category", stay.roomCategory ? escapeHtml(stay.roomCategory) : null);
  }

  const html = renderReminderShell({
    lang,
    domain: "lodging",
    preheader: heading,
    heading,
    bodyHtml: `<table role="presentation" style="border-collapse:collapse;">${rows.join("")}</table>`,
    ctaUrl: `${base}/${stay.tripId ? `trips/${stay.tripId}` : `lodging/${stay.id}`}`,
    ctaLabel: CTA_LABEL[lang],
    settingsUrl: `${base}/settings/notifications`,
  });
  const subject =
    lang === "de" ? `Check-in heute: ${stay.lodgingName}` : `Check-in today: ${stay.lodgingName}`;

  const transporter = createTransporterFromConfig(config);
  try {
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: user.notificationEmail,
      subject,
      html,
    });
    logger.info({ operation: "email_reminder_sent", domain: "lodging", lodgingStayId: stay.id });
    logger.debug({ operation: "email_reminder_sent", to: user.notificationEmail });
  } catch (error) {
    logger.error({
      operation: "email_reminder_send_failed",
      domain: "lodging",
      lodgingStayId: stay.id,
      error: { message: error instanceof Error ? error.message : "Unknown error" },
    });
    throw error;
  }
}

export async function testSmtpConnection(config: SmtpConfigInput): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.username,
      pass: config.password,
    },
  });

  await transporter.verify();
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  username: string
): Promise<void> {
  const config = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
  if (!config || !config.enabled) {
    logger.info({
      operation: "password_reset_email_skipped",
      message: "SMTP not configured or disabled",
    });
    return;
  }

  const transporter = createTransporterFromConfig(config);
  const subject = "TravStats — Passwort zurücksetzen";
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #2563eb;">Passwort zurücksetzen</h2>
  <p>Hallo ${username},</p>
  <p>du hast eine Passwortzurücksetzung angefordert.</p>
  <p>
    <a href="${resetUrl}" style="display: inline-block; background: #2563eb; color: #fff;
       padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold;">
      Passwort zurücksetzen
    </a>
  </p>
  <p style="color: #6b7280; font-size: 14px;">Link (gültig 30 Minuten): ${resetUrl}</p>
  <p style="color: #6b7280; font-size: 14px;">Falls du das nicht angefordert hast, kannst du diese E-Mail ignorieren.</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
  <p style="color: #6b7280; font-size: 14px;">&mdash; TravStats</p>
</body>
</html>`.trim();

  try {
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to,
      subject,
      html,
    });
    logger.info({ operation: "password_reset_email_sent" });
    logger.debug({ operation: "password_reset_email_sent", to });
  } catch (error) {
    logger.error({
      operation: "password_reset_email_failed",
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
    throw error;
  }
}

export async function sendAdminPasswordResetEmail(
  to: string,
  username: string,
  temporaryPassword: string
): Promise<void> {
  const config = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
  if (!config || !config.enabled) {
    throw new Error("SMTP is not configured on this instance");
  }

  const transporter = createTransporterFromConfig(config);
  const subject = "TravStats — Passwort zurückgesetzt";
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #2563eb;">Passwort zurückgesetzt</h2>
  <p>Hallo ${username},</p>
  <p>ein Administrator hat dein Passwort zurückgesetzt. Dein vorläufiges Passwort lautet:</p>
  <p style="font-family: monospace; font-size: 18px; background: #f3f4f6; padding: 12px 16px;
     border-radius: 6px; display: inline-block; letter-spacing: 1px;">${temporaryPassword}</p>
  <p>Bitte melde dich damit an — du wirst sofort aufgefordert, ein neues Passwort zu wählen.</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
  <p style="color: #6b7280; font-size: 14px;">&mdash; TravStats</p>
</body>
</html>`.trim();

  try {
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to,
      subject,
      html,
    });
    logger.info({ operation: "admin_password_reset_email_sent" });
    logger.debug({ operation: "admin_password_reset_email_sent", to });
  } catch (error) {
    logger.error({
      operation: "admin_password_reset_email_failed",
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
    throw error;
  }
}

export async function sendInvitationEmail(
  to: string,
  inviteUrl: string,
  inviterUsername: string,
  expiresAt: Date
): Promise<void> {
  const config = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
  if (!config || !config.enabled) {
    throw new Error("SMTP is not configured on this instance");
  }

  const transporter = createTransporterFromConfig(config);
  const subject = "TravStats — Einladung";
  // The invitee has no profile zone yet, and the expiry is checked against
  // the instant — so the day is named in UTC, and says so.
  const expiresText = `${expiresAt.toLocaleDateString("de-DE", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  })} (UTC)`;
  const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #2563eb;">Du wurdest zu TravStats eingeladen</h2>
  <p>Hallo,</p>
  <p><strong>${inviterUsername}</strong> hat dich zu TravStats eingeladen — einer privaten App zur Verwaltung deiner Flugreisen.</p>
  <p>
    <a href="${inviteUrl}" style="display: inline-block; background: #2563eb; color: #fff;
       padding: 10px 20px; border-radius: 6px; text-decoration: none; font-weight: bold;">
      Konto erstellen
    </a>
  </p>
  <p style="color: #6b7280; font-size: 14px;">Link (gültig bis ${expiresText}): ${inviteUrl}</p>
  <p style="color: #6b7280; font-size: 14px;">Falls du diese Einladung nicht erwartet hast, kannst du diese E-Mail ignorieren.</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
  <p style="color: #6b7280; font-size: 14px;">&mdash; TravStats</p>
</body>
</html>`.trim();

  try {
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to,
      subject,
      html,
    });
    logger.info({ operation: "invitation_email_sent" });
    logger.debug({ operation: "invitation_email_sent", to });
  } catch (error) {
    logger.error({
      operation: "invitation_email_failed",
      error: {
        message: error instanceof Error ? error.message : "Unknown error",
      },
    });
    throw error;
  }
}
