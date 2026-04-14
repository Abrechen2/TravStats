import { Router, Response, NextFunction } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../db';
import { SettingsDataJson, defaultSettings } from './types';
import {
  HomeAirportEntry,
  applyHomeAirportMove,
  normalizeHistory,
  sortHistory,
} from '../../utils/homeAirport';

const router = Router();

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

const moveSchema = z.object({
  iata: z
    .string()
    .min(2)
    .max(4)
    .transform((v) => v.trim().toUpperCase()),
  /** Date of the move. Optional — defaults to today (UTC). */
  fromDate: z.string().regex(ISO_DATE).optional(),
});

const editSchema = z.object({
  iata: z
    .string()
    .min(2)
    .max(4)
    .transform((v) => v.trim().toUpperCase())
    .optional(),
  fromDate: z.string().regex(ISO_DATE).optional(),
  toDate: z.string().regex(ISO_DATE).nullable().optional(),
});

async function loadHistory(userId: string): Promise<HomeAirportEntry[]> {
  const row = await prisma.userSettings.findUnique({
    where: { userId },
    select: { data: true },
  });
  const data =
    row?.data && typeof row.data === 'object' ? (row.data as SettingsDataJson) : {};
  return normalizeHistory(data.homeAirportHistory);
}

async function saveHistory(userId: string, history: HomeAirportEntry[]): Promise<void> {
  const existing = await prisma.userSettings.findUnique({
    where: { userId },
    select: { data: true },
  });
  const currentData: SettingsDataJson =
    existing?.data && typeof existing.data === 'object'
      ? (existing.data as SettingsDataJson)
      : {};
  const updated: SettingsDataJson = { ...currentData, homeAirportHistory: history };
  await prisma.userSettings.upsert({
    where: { userId },
    update: { data: updated as unknown as Prisma.InputJsonValue },
    create: {
      userId,
      data: {
        ...defaultSettings,
        homeAirportHistory: history,
      } as unknown as Prisma.InputJsonValue,
    },
  });
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// GET / — full history, oldest first.
router.get('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const history = await loadHistory(req.userId!);
    res.json({ history });
  } catch (error) {
    next(error);
  }
});

// POST / — user moved. Closes the currently-open entry and opens a new one.
// Body: { iata: string, fromDate?: YYYY-MM-DD (default: today) }
router.post('/', async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { iata, fromDate } = moveSchema.parse(req.body);
    const moveDate = fromDate || today();
    const history = await loadHistory(req.userId!);
    const updated = applyHomeAirportMove(history, iata, moveDate);
    await saveHistory(req.userId!, updated);
    res.json({ history: updated });
  } catch (error) {
    next(error);
  }
});

// PATCH /:index — correction on an existing entry (e.g. fix a wrong start date).
router.patch(
  '/:index',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idx = Number(req.params.index);
      if (!Number.isInteger(idx) || idx < 0) {
        res.status(400).json({ error: 'Invalid index' });
        return;
      }
      const patch = editSchema.parse(req.body);
      const history = await loadHistory(req.userId!);
      if (idx >= history.length) {
        res.status(404).json({ error: 'Entry not found' });
        return;
      }
      const next: HomeAirportEntry = {
        ...history[idx],
        ...(patch.iata !== undefined ? { iata: patch.iata } : {}),
        ...(patch.fromDate !== undefined ? { fromDate: patch.fromDate } : {}),
        ...(patch.toDate !== undefined ? { toDate: patch.toDate } : {}),
      };
      const replaced = history.map((e, i) => (i === idx ? next : e));
      const sorted = sortHistory(replaced);
      await saveHistory(req.userId!, sorted);
      res.json({ history: sorted });
    } catch (error) {
      next(error);
    }
  }
);

// DELETE /:index — remove an entry entirely (e.g. accidentally added).
router.delete(
  '/:index',
  async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
    try {
      const idx = Number(req.params.index);
      if (!Number.isInteger(idx) || idx < 0) {
        res.status(400).json({ error: 'Invalid index' });
        return;
      }
      const history = await loadHistory(req.userId!);
      if (idx >= history.length) {
        res.status(404).json({ error: 'Entry not found' });
        return;
      }
      const updated = history.filter((_, i) => i !== idx);
      await saveHistory(req.userId!, updated);
      res.json({ history: updated });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
