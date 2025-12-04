import { Router, Request, Response, NextFunction } from 'express';
import { prisma } from '../db';
import { authenticate, AuthRequest } from '../middleware/auth';
import { parseBookingEmail } from '../services/bookingParser';
import { findOrCreateAirport } from '../services/airportLookup';
import { v4 as uuidv4 } from 'uuid';
import { uploadEmailFile } from '../middleware/upload';
import MsgReader from '@kenjiuno/msgreader';
import fs from 'fs';
import path from 'path';

const router = Router();

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

    // Parse email (returns array of flights)
    const parsedFlights = await parseBookingEmail(cleanSubject, cleanText, cleanHtml);

    console.log(`[Email Import] Found ${parsedFlights.length} flight(s) in text upload`);

    // Create import record for EACH flight
    const drafts = await Promise.all(
      parsedFlights.map(async (parsed, index) => {
        const flightSubject =
          parsedFlights.length > 1
            ? `${cleanSubject || 'Manual Upload'} - Flight ${index + 1}/${parsedFlights.length}`
            : cleanSubject || 'Manual Upload';

        return await prisma.importedFlight.create({
          data: {
            id: uuidv4(),
            userId,
            status: 'pending_review',
            subject: flightSubject,
            fromAddress: cleanFrom,
            toAddress: cleanTo,
            raw: cleanText.slice(0, 8000),
            parsed: parsed as any,
          },
        });
      })
    );

    res.json({
      count: drafts.length,
      imports: drafts.map((d) => ({
        id: d.id,
        status: d.status,
        parsed: d.parsed,
      })),
    });
  } catch (error) {
    next(error);
  }
});

// Upload email file (.eml, .txt, .msg)
router.post('/upload-file', authenticate, uploadEmailFile.single('file'), async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const file = req.file;

    if (!file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    let subject = '';
    let text = '';
    let html = '';

    const ext = path.extname(file.originalname).toLowerCase();

    try {
      if (ext === '.msg') {
        // Parse .msg file
        console.log('[MSG Parser] Reading .msg file:', file.path);
        const msgFileBuffer = fs.readFileSync(file.path);
        const msgReader = new MsgReader(msgFileBuffer);
        const fileData = msgReader.getFileData();

        subject = fileData.subject || '';
        text = fileData.body || '';
        html = fileData.bodyHTML || '';

        console.log('[MSG Parser] Extracted:', { subject, textLength: text.length, htmlLength: html.length });
      } else if (ext === '.eml' || ext === '.txt') {
        // Parse .eml or .txt file
        const content = fs.readFileSync(file.path, 'utf-8');

        // Extract subject from .eml headers
        const subjectMatch = content.match(/^Subject:\s*(.+)$/im);
        subject = subjectMatch?.[1]?.trim() || '';

        // Find body (after headers, separated by blank line)
        const bodyStart = content.indexOf('\n\n');
        const body = bodyStart !== -1 ? content.substring(bodyStart + 2) : content;

        text = body;
        html = body; // May contain HTML in .eml files
      }

      // Sanitize inputs
      const cleanSubject = sanitizeForPostgres(subject);
      const cleanText = sanitizeForPostgres(text);
      const cleanHtml = sanitizeForPostgres(html);

      // Parse email (returns array of flights)
      const parsedFlights = await parseBookingEmail(cleanSubject, cleanText, cleanHtml);

      console.log(`[Email Import] Found ${parsedFlights.length} flight(s) in email`);

      // Create import record for EACH flight
      const drafts = await Promise.all(
        parsedFlights.map(async (parsed, index) => {
          const flightSubject =
            parsedFlights.length > 1
              ? `${cleanSubject || file.originalname} - Flight ${index + 1}/${parsedFlights.length}`
              : cleanSubject || file.originalname;

          return await prisma.importedFlight.create({
            data: {
              id: uuidv4(),
              userId,
              status: 'pending_review',
              subject: flightSubject,
              fromAddress: '',
              toAddress: '',
              raw: cleanText.slice(0, 8000),
              parsed: parsed as any,
            },
          });
        })
      );

      // Clean up uploaded file
      fs.unlinkSync(file.path);

      res.json({
        count: drafts.length,
        imports: drafts.map((d) => ({
          id: d.id,
          status: d.status,
          parsed: d.parsed,
        })),
      });
    } catch (parseError: any) {
      // Clean up file on error
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
      console.error('[Email File Upload] Parse error:', parseError);
      return res.status(400).json({
        error: 'Failed to parse email file',
        message: parseError.message
      });
    }
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

// Update/edit a pending import
router.put('/:id/edit', authenticate, async (req: AuthRequest, res: Response, next: NextFunction) => {
  try {
    const userId = req.userId!;
    const { id } = req.params;
    const { parsed } = req.body;

    // Find the import
    const draft = await prisma.importedFlight.findFirst({
      where: { id, userId, status: 'pending_review' },
    });

    if (!draft) {
      return res.status(404).json({ error: 'Import not found' });
    }

    // Update the parsed data
    const updated = await prisma.importedFlight.update({
      where: { id },
      data: {
        parsed: parsed as any,
        updatedAt: new Date(),
      },
    });

    res.json({ import: updated });
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

    let depAirport, arrAirport;
    try {
      [depAirport, arrAirport] = await Promise.all([
        findOrCreateAirport(depCode),
        findOrCreateAirport(arrCode),
      ]);
    } catch (airportError: any) {
      console.error('[Import Accept] Airport lookup failed:', airportError);
      return res.status(400).json({
        error: 'Airport lookup failed',
        message: `Could not resolve airport codes: ${depCode}, ${arrCode}. ${airportError.message || ''}`
      });
    }

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
        price: parsed.price
          ? (typeof parsed.price === 'string'
            ? Number(parsed.price.replace(',', '.'))
            : Number(parsed.price))
          : undefined,
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
