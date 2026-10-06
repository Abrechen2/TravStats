import nodemailer from "nodemailer";
import type { Transporter } from "nodemailer";
import type { SmtpConfig } from "../prisma";
import { prisma } from "../db";
import logger from "../utils/logger";
import { SMTP_CONFIG_ID } from "../routes/admin/smtp";
import { decryptApiKey } from "../utils/encryption";
import { getInstanceSettings } from "./instanceSettingsService";
import { tripNameLanguageOf } from "./trip/tripGrouping";
import { renderMailHtml, renderMailText, type MailContent } from "./email/mailShell";
import type { ReminderLang } from "./email/reminderFormat";
import {
  cruiseReminderContent,
  flightReminderContent,
  lodgingReminderContent,
  railRideReminderContent,
  type CruiseReminderData,
  type FlightReminderData,
  type LodgingReminderData,
  type RailReminderData,
  type ReminderDomain,
  type ReminderLinks,
} from "./email/reminderContent";
import {
  adminPasswordResetContent,
  invitationContent,
  passwordResetContent,
} from "./email/accountContent";

/**
 * Delivery only. WHAT a mail says lives in `email/reminderContent.ts` and
 * `email/accountContent.ts`, HOW it looks in `email/mailShell.ts`; this file
 * decides whether a mail goes out (SMTP on, an address to send to) and hands
 * the transport both parts — HTML and its plain-text alternative.
 */

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
  return tripNameLanguageOf(user.settingsData);
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

async function smtpConfig(): Promise<SmtpConfig | null> {
  const config = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
  return config && config.enabled ? config : null;
}

/** Hands one mail to the transport as multipart/alternative: the HTML part and its text twin. */
async function deliver(config: SmtpConfig, to: string, content: MailContent): Promise<void> {
  await createTransporterFromConfig(config).sendMail({
    from: `"${config.fromName}" <${config.fromEmail}>`,
    to,
    subject: content.subject,
    text: renderMailText(content),
    html: renderMailHtml(content),
  });
}

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : "Unknown error";

/**
 * The shared path of all four reminders: no address or no SMTP means no mail
 * (logged, not thrown); a transport failure is logged and rethrown so the
 * scheduler leaves the reminder unsent and retries on its next run.
 */
async function sendReminder(
  domain: ReminderDomain,
  user: ReminderUser,
  logContext: Record<string, unknown>,
  build: (lang: ReminderLang, links: ReminderLinks) => MailContent
): Promise<void> {
  if (!user.notificationEmail) {
    logger.warn({
      operation: "email_reminder_skipped",
      message: "No notification email set for user",
      ...logContext,
    });
    return;
  }

  const config = await smtpConfig();
  if (!config) {
    logger.info({
      operation: "email_reminder_skipped",
      message: "SMTP not configured or disabled",
    });
    return;
  }

  const { frontendUrl } = await getInstanceSettings();
  const links: ReminderLinks = {
    base: (frontendUrl ?? "http://localhost:3000").replace(/\/+$/, ""),
  };

  try {
    await deliver(config, user.notificationEmail, build(reminderLang(user), links));
    logger.info({ operation: "email_reminder_sent", domain, ...logContext });
    logger.debug({ operation: "email_reminder_sent", to: user.notificationEmail });
  } catch (error) {
    logger.error({
      operation: "email_reminder_send_failed",
      domain,
      ...logContext,
      error: { message: errorMessage(error) },
    });
    throw error;
  }
}

export async function sendFlightReminder(
  flight: FlightReminderData,
  user: ReminderUser,
  hoursUntilDeparture: number
): Promise<void> {
  await sendReminder("flight", user, { flightId: flight.id, hoursUntilDeparture }, (lang, links) =>
    flightReminderContent(flight, hoursUntilDeparture, lang, links)
  );
}

export async function sendCruiseReminder(
  cruise: CruiseReminderData,
  user: ReminderUser,
  hoursUntilDeparture: number
): Promise<void> {
  await sendReminder("cruise", user, { cruiseId: cruise.id, hoursUntilDeparture }, (lang, links) =>
    cruiseReminderContent(cruise, hoursUntilDeparture, lang, links)
  );
}

/**
 * One mail per RIDE, not per train (forgejo#210): `legs` are the trains
 * `groupRailLegs` reads as one journey, in travel order; a ride of one train
 * is a list of one. Logged under the first leg's id, which names the ride.
 */
export async function sendRailReminder(
  legs: readonly RailReminderData[],
  user: ReminderUser,
  hoursUntilDeparture: number
): Promise<void> {
  await sendReminder(
    "rail",
    user,
    { railJourneyId: legs[0]?.id, legCount: legs.length, hoursUntilDeparture },
    (lang, links) => railRideReminderContent(legs, hoursUntilDeparture, lang, links)
  );
}

export async function sendLodgingCheckInReminder(
  stay: LodgingReminderData,
  user: ReminderUser
): Promise<void> {
  await sendReminder("lodging", user, { lodgingStayId: stay.id }, (lang, links) =>
    lodgingReminderContent(stay, lang, links)
  );
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

/** An account mail: sent, logged under `<operation>_sent`, or logged under `<operation>_failed` and rethrown. */
async function sendAccountMail(
  config: SmtpConfig,
  to: string,
  operation: string,
  content: MailContent
): Promise<void> {
  try {
    await deliver(config, to, content);
    logger.info({ operation: `${operation}_sent` });
    logger.debug({ operation: `${operation}_sent`, to });
  } catch (error) {
    logger.error({ operation: `${operation}_failed`, error: { message: errorMessage(error) } });
    throw error;
  }
}

export async function sendPasswordResetEmail(
  to: string,
  resetUrl: string,
  username: string
): Promise<void> {
  const config = await smtpConfig();
  if (!config) {
    logger.info({
      operation: "password_reset_email_skipped",
      message: "SMTP not configured or disabled",
    });
    return;
  }
  await sendAccountMail(
    config,
    to,
    "password_reset_email",
    passwordResetContent(username, resetUrl)
  );
}

export async function sendAdminPasswordResetEmail(
  to: string,
  username: string,
  temporaryPassword: string
): Promise<void> {
  const config = await smtpConfig();
  if (!config) {
    throw new Error("SMTP is not configured on this instance");
  }
  await sendAccountMail(
    config,
    to,
    "admin_password_reset_email",
    adminPasswordResetContent(username, temporaryPassword)
  );
}

export async function sendInvitationEmail(
  to: string,
  inviteUrl: string,
  inviterUsername: string,
  expiresAt: Date
): Promise<void> {
  const config = await smtpConfig();
  if (!config) {
    throw new Error("SMTP is not configured on this instance");
  }
  await sendAccountMail(
    config,
    to,
    "invitation_email",
    invitationContent(inviterUsername, inviteUrl, expiresAt)
  );
}
