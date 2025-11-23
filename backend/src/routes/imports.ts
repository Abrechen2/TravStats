import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { parseBookingEmail } from '../services/bookingParser';
import { findOrCreateAirport } from '../services/airportLookup';
import { v4 as uuidv4 } from 'uuid';

const router = Router();

// Helper to verify inbound secret for email/webhook ingestion
function verifyImportSecret(req: Request) {
  const secret = process.env.IMPORT_SECRET;
  if (!secret) return false;
  const header = req.headers['x-import-secret'] || req.query.secret;
  return header === secret;
}

// Ingest email/webhook payload: expects userId or token + subject/text/html
router.post('/email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!verifyImportSecret(req)) {
      return res.status(401).json({ error: 'Unauthorized import' });
    }

    const { userId, subject, text, html, from, to } = req.body;
    if (!userId) {
      return res.status(400).json({ error: 'userId required' });
    }

    const parsed = parseBookingEmail(subject, text, html);

    const draft = await prisma.importedFlight.create({
      data: {
        id: uuidv4(),
        userId,
        status: 'pending_review',
        subject,
        fromAddress: from,
        toAddress: to,
        raw: typeof text === 'string' ? text.slice(0, 8000) : '',
        parsed: parsed as any,
      },
    });

    res.json({ id: draft.id, status: draft.status });
  } catch (error) {
    next(error);
  }
});

// Get pending imports for current user
router.get('/pending', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const drafts = await prisma.importedFlight.findMany({
      where: { userId, status: { in: ['pending_review'] } },
      orderBy: { createdAt: 'desc' },
    });
    res.json({ imports: drafts });
  } catch (error) {
    next(error);
  }
});

// Accept an import: create flight and mark accepted
router.post('/:id/accept', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const draft = await prisma.importedFlight.findFirst({
      where: { id, userId, status: 'pending_review' },
    });
    if (!draft) {
      return res.status(404).json({ error: 'Import not found' });
    }

    const parsed: any = draft.parsed || {};
    const depCode = parsed.departureCode;
    const arrCode = parsed.arrivalCode;

    if (!depCode || !arrCode) {
      return res.status(400).json({ error: 'Missing departure/arrival codes' });
    }

    const [depAirport, arrAirport] = await Promise.all([
      findOrCreateAirport(depCode),
      findOrCreateAirport(arrCode),
    ]);

    if (!depAirport || !arrAirport) {
      return res.status(400).json({ error: 'Could not resolve airports' });
    }

    const flight = await prisma.flight.create({
      data: {
        userId,
        airline: parsed.airline,
        flightNumber: parsed.flightNumber,
        depIata: depAirport.iata,
        depIcao: depAirport.icao,
        depName: depAirport.name,
        depLat: depAirport.lat,
        depLon: depAirport.lon,
        arrIata: arrAirport.iata,
        arrIcao: arrAirport.icao,
        arrName: arrAirport.name,
        arrLat: arrAirport.lat,
        arrLon: arrAirport.lon,
        departureTime: parsed.departureTime ? new Date(parsed.departureTime) : new Date(),
        arrivalTime: parsed.arrivalTime ? new Date(parsed.arrivalTime) : new Date(),
        status: 'scheduled',
        seatNumber: parsed.seat,
        terminal: parsed.terminal,
        gate: parsed.gate,
        price: parsed.price ? Number(parsed.price.replace(',', '.')) : undefined,
        currency: parsed.currency,
        category: 'business',
      },
    });

    await prisma.importedFlight.update({
      where: { id },
      data: { status: 'accepted' },
    });

    res.json({ flight });
  } catch (error) {
    next(error);
  }
});

// Reject an import
router.post('/:id/reject', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const draft = await prisma.importedFlight.findFirst({
      where: { id, userId, status: 'pending_review' },
    });
    if (!draft) {
      return res.status(404).json({ error: 'Import not found' });
    }

    await prisma.importedFlight.update({
      where: { id },
      data: { status: 'rejected' },
    });

    res.json({ status: 'rejected' });
  } catch (error) {
    next(error);
  }
});

export default router;
