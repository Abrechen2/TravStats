import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { parseBookingEmail } from '../services/bookingParser';
import { findOrCreateAirport } from '../services/airportLookup';
import { v4 as uuidv4 } from 'uuid';
import { getSystemSettings } from '../services/systemSettings';

const router = Router();

// Helper to verify inbound secret for email/webhook ingestion
async function verifyImportSecret(req: Request) {
  const { emailImport } = await getSystemSettings();
  if (!emailImport.enabled || !emailImport.importSecret) {
    return false;
  }

  const header = req.headers['x-import-secret'] || req.query.secret;
  return header === emailImport.importSecret;
}

// Ingest email/webhook payload: expects userId or token + subject/text/html
router.post('/email', async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!(await verifyImportSecret(req))) {
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

// Helper function to sanitize text for PostgreSQL
function sanitizeForPostgres(str: string | undefined): string {
  if (!str) return '';
  // Remove null bytes and other problematic characters
  return str.replace(/\0/g, '').replace(/\uFFFD/g, '');
}

// Upload email manually (authenticated user)
router.post('/upload', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { subject, text, html, from, to } = req.body;

    if (!text && !html) {
      return res.status(400).json({ error: 'Either text or html content required' });
    }

    // Sanitize inputs to remove null bytes
    const cleanSubject = sanitizeForPostgres(subject);
    const cleanText = sanitizeForPostgres(text);
    const cleanHtml = sanitizeForPostgres(html);
    const cleanFrom = sanitizeForPostgres(from);
    const cleanTo = sanitizeForPostgres(to);

    const parsed = parseBookingEmail(cleanSubject, cleanText, cleanHtml);

    const draft = await prisma.importedFlight.create({
      data: {
        id: uuidv4(),
        userId,
        status: 'pending_review',
        subject: cleanSubject || 'Manual Upload',
        fromAddress: cleanFrom,
        toAddress: cleanTo,
        raw: cleanText.slice(0, 8000),
        parsed: parsed as any,
      },
    });

    res.json({ id: draft.id, status: draft.status, parsed });
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

    // Check for duplicate flights (same flight number, date, and route)
    const departureDate = parsed.departureTime ? new Date(parsed.departureTime) : new Date();
    const startOfDay = new Date(departureDate);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(departureDate);
    endOfDay.setHours(23, 59, 59, 999);

    const existingFlight = await prisma.flight.findFirst({
      where: {
        userId,
        flightNumber: parsed.flightNumber,
        departureTime: {
          gte: startOfDay,
          lt: endOfDay,
        },
        depIata: depAirport.iata,
        arrIata: arrAirport.iata,
      },
    });

    if (existingFlight) {
      return res.status(409).json({
        error: 'Flight already exists',
        message: `Flight ${parsed.flightNumber} on ${departureDate.toLocaleDateString()} from ${depAirport.iata} to ${arrAirport.iata} is already in your flight list.`,
        existingFlightId: existingFlight.id,
      });
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
