import nodemailer from 'nodemailer';
import type { Transporter } from 'nodemailer';
import type { SmtpConfig } from '@prisma/client';
import { prisma } from '../db';
import logger from '../utils/logger';
import { SMTP_CONFIG_ID } from '../routes/admin/smtp';

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

interface FlightReminderData {
  id: string;
  flightNumber: string | null;
  depName: string | null;
  depIata: string | null;
  arrName: string | null;
  arrIata: string | null;
  departureTime: Date;
}

interface UserReminderData {
  notificationEmail: string | null;
}

function createTransporterFromConfig(config: SmtpConfig): Transporter {
  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.username,
      pass: config.password,
    },
  });
}

function buildReminderHtml(
  flight: FlightReminderData,
  hoursUntilDeparture: number,
): string {
  const flightNumber = flight.flightNumber ?? 'N/A';
  const depAirport = flight.depIata ?? flight.depName ?? 'Unknown';
  const arrAirport = flight.arrIata ?? flight.arrName ?? 'Unknown';
  const departureTime = flight.departureTime.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  return `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #2563eb;">Flight Reminder &mdash; ${hoursUntilDeparture}h before departure</h2>
  <p>Your flight <strong>${flightNumber}</strong> from <strong>${depAirport}</strong> to <strong>${arrAirport}</strong> departs in <strong>${hoursUntilDeparture} hours</strong>.</p>
  <p><strong>Departure:</strong> ${departureTime}</p>
  <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
  <p style="color: #6b7280; font-size: 14px;">&mdash; TravStats</p>
</body>
</html>
  `.trim();
}

export async function sendFlightReminder(
  flight: FlightReminderData,
  user: UserReminderData,
  hoursUntilDeparture: number,
): Promise<void> {
  if (!user.notificationEmail) {
    logger.warn({
      operation: 'email_reminder_skipped',
      message: 'No notification email set for user',
      flightId: flight.id,
    });
    return;
  }

  const config = await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } });
  if (!config || !config.enabled) {
    logger.info({
      operation: 'email_reminder_skipped',
      message: 'SMTP not configured or disabled',
    });
    return;
  }

  const transporter = createTransporterFromConfig(config);
  const html = buildReminderHtml(flight, hoursUntilDeparture);
  const flightNumber = flight.flightNumber ?? 'N/A';
  const subject = `Flight Reminder: ${flightNumber} in ${hoursUntilDeparture}h`;

  try {
    await transporter.sendMail({
      from: `"${config.fromName}" <${config.fromEmail}>`,
      to: user.notificationEmail,
      subject,
      html,
    });

    logger.info({
      operation: 'email_reminder_sent',
      flightId: flight.id,
      hoursUntilDeparture,
      to: user.notificationEmail,
    });
  } catch (error) {
    logger.error({
      operation: 'email_reminder_send_failed',
      flightId: flight.id,
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
      },
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
