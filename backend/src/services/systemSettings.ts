import { prisma } from '../db';

const parseList = (value?: string | string[]) =>
  (Array.isArray(value) ? value.join(',') : value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

export interface EmailImportSettings {
  enabled: boolean;
  importSecret: string;
  allowUserConfiguration: boolean;
  imap: {
    enabled: boolean;
    host: string;
    port: number;
    secure: boolean;
    user: string;
    password: string;
    mailbox: string;
    allowedSenders: string[];
    subjectKeywords: string[];
    defaultUserId: string;
    pollIntervalMinutes: number;
  };
}

export interface SystemSettingsData {
  emailImport: EmailImportSettings;
}

export type EmailImportSettingsUpdate = Partial<Omit<EmailImportSettings, 'imap'>> & {
  imap?: Partial<EmailImportSettings['imap']>;
};

const defaultAllowedSenders = ['@lufthansa.com', '@dlh.de', '@mail.lufthansa.com'];
const defaultSubjectKeywords = ['lufthansa', 'buchungsbestaetigung', 'booking', 'etix', 'eticket'];

const defaultEmailImportSettings: EmailImportSettings = {
  enabled: process.env.IMAP_ENABLED === 'true' || Boolean(process.env.IMPORT_SECRET),
  importSecret: process.env.IMPORT_SECRET || '',
  allowUserConfiguration: true,
  imap: {
    enabled: process.env.IMAP_ENABLED === 'true',
    host: process.env.IMAP_HOST || 'imap.gmail.com',
    port: Number(process.env.IMAP_PORT) || 993,
    secure: process.env.IMAP_SECURE === 'true',
    user: process.env.IMAP_USER || '',
    password: process.env.IMAP_PASSWORD || '',
    mailbox: process.env.IMAP_MAILBOX || 'INBOX',
    allowedSenders: (() => {
      const parsed = parseList(process.env.IMAP_ALLOWED_SENDERS);
      return parsed.length > 0 ? parsed : defaultAllowedSenders;
    })(),
    subjectKeywords: (() => {
      const parsed = parseList(process.env.IMAP_SUBJECT_KEYWORDS);
      return parsed.length > 0 ? parsed : defaultSubjectKeywords;
    })(),
    defaultUserId: process.env.IMAP_DEFAULT_USER_ID || '',
    pollIntervalMinutes: Number(process.env.IMAP_POLL_INTERVAL) || 5,
  },
};

const defaultSystemSettings: SystemSettingsData = {
  emailImport: defaultEmailImportSettings,
};

function mergeEmailImportSettings(partial?: EmailImportSettingsUpdate): EmailImportSettings {
  return {
    ...defaultEmailImportSettings,
    ...partial,
    imap: {
      ...defaultEmailImportSettings.imap,
      ...(partial?.imap || {}),
    },
  };
}

export async function getSystemSettings(): Promise<SystemSettingsData> {
  const record = await prisma.systemSettings.findUnique({ where: { id: 'global' } });
  const data = (record?.data as SystemSettingsData | undefined) || defaultSystemSettings;

  return {
    emailImport: mergeEmailImportSettings(data.emailImport),
  };
}

export async function updateEmailImportSettings(
  updates: EmailImportSettingsUpdate
): Promise<EmailImportSettings> {
  const current = await getSystemSettings();
  const merged = mergeEmailImportSettings({
    ...current.emailImport,
    ...updates,
    imap: {
      ...current.emailImport.imap,
      ...(updates.imap || {}),
    },
  });

  await prisma.systemSettings.upsert({
    where: { id: 'global' },
    update: { data: { emailImport: merged } as any },
    create: { id: 'global', data: { emailImport: merged } as any },
  });

  return merged;
}
