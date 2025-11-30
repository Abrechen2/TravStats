import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, AuthRequest } from '../middleware/auth';
import { prisma } from '../db';

const router = Router();

// All routes require authentication
router.use(authenticate);

const settingsSchema = z.object({
  profile: z.object({
    username: z.string().optional(),
    email: z.string().email().optional(),
    profilePicture: z.string().url().optional().nullable(),
  }).partial().optional(),
  display: z.object({
    theme: z.enum(['light', 'dark']).optional(),
    language: z.enum(['de', 'en']).optional(),
    timezone: z.string().optional(),
    dateFormat: z.enum(['DD.MM.YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']).optional(),
    timeFormat: z.enum(['24h', '12h']).optional(),
  }).partial().optional(),
  units: z.object({
    distanceUnit: z.enum(['kilometers', 'miles', 'nautical_miles']).optional(),
    currency: z.enum(['EUR', 'USD', 'GBP', 'CHF']).optional(),
    temperature: z.enum(['celsius', 'fahrenheit']).optional(),
  }).partial().optional(),
  defaults: z.object({
    flightStatus: z.enum(['scheduled', 'flown']).optional(),
    seatClass: z.enum(['economy', 'premium_economy', 'business', 'first']).optional(),
    favoriteAirline: z.string().optional(),
    flightCategory: z.enum(['business', 'private', 'vacation']).optional(),
  }).partial().optional(),
  map: z.object({
    mapStyle: z.enum(['osm', 'satellite']).optional(),
    zoomLevel: z.number().min(1).max(18).optional(),
    markerStyle: z.enum(['pin', 'circle', 'custom']).optional(),
    routeColor: z.string().optional(),
  }).partial().optional(),
  notifications: z.object({
    emailNotifications: z.boolean().optional(),
    flightReminder: z.enum(['off', '24h', '48h']).optional(),
    checkInReminder: z.boolean().optional(),
    featureUpdates: z.boolean().optional(),
  }).partial().optional(),
  privacy: z.object({
    twoFactorAuth: z.boolean().optional(),
    loginAlerts: z.boolean().optional(),
    dataExportRequested: z.boolean().optional(),
    accountDeletionRequested: z.boolean().optional(),
    analyticsOptIn: z.boolean().optional(),
  }).partial().optional(),
  backup: z.object({
    autoBackup: z.boolean().optional(),
    backupInterval: z.enum(['daily', 'weekly', 'monthly']).optional(),
    exportFormat: z.enum(['json', 'csv', 'pdf']).optional(),
    cloudSync: z.boolean().optional(),
  }).partial().optional(),
}).partial();

const defaultSettings = {
  profile: { username: 'Traveler', email: 'traveler@example.com', profilePicture: null },
  display: { theme: 'light', language: 'de', timezone: 'Europe/Berlin', dateFormat: 'DD.MM.YYYY', timeFormat: '24h' },
  units: { distanceUnit: 'kilometers', currency: 'EUR', temperature: 'celsius' },
  defaults: { flightStatus: 'scheduled', seatClass: 'economy', favoriteAirline: 'Lufthansa', flightCategory: 'business' },
  map: { mapStyle: 'osm', zoomLevel: 3, markerStyle: 'pin', routeColor: '#2563eb' },
  notifications: { emailNotifications: true, flightReminder: '24h', checkInReminder: true, featureUpdates: true },
  privacy: { twoFactorAuth: false, loginAlerts: true, dataExportRequested: false, accountDeletionRequested: false, analyticsOptIn: false },
  backup: { autoBackup: false, backupInterval: 'weekly', exportFormat: 'json', cloudSync: false },
};

router.get('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const existing = await prisma.userSettings.findUnique({
      where: { userId },
    });

    if (!existing) {
      const created = await prisma.userSettings.create({
        data: { userId, data: defaultSettings },
      });
      return res.json(created.data);
    }

    res.json(existing.data);
  } catch (error) {
    next(error);
  }
});

router.put('/', async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const payload = settingsSchema.parse(req.body);

    const existing = await prisma.userSettings.findUnique({
      where: { userId },
    });

    const merged = {
      ...defaultSettings,
      ...(typeof existing?.data === 'object' && existing.data !== null ? existing.data : {}),
      ...payload,
    };

    const saved = await prisma.userSettings.upsert({
      where: { userId },
      update: { data: merged as any },
      create: { userId, data: merged as any },
    });

    res.json(saved.data);
  } catch (error) {
    next(error);
  }
});

export default router;
