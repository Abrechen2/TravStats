import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import authRoutes from './routes/auth';
import flightRoutes from './routes/flights';
import flightLookupRoutes from './routes/flightLookup';
import statsRoutes from './routes/stats';
import airportRoutes from './routes/airports';
import achievementRoutes from './routes/achievements';
import settingsRoutes from './routes/settings';
import analyticsRoutes from './routes/analytics';
import uploadsRoutes from './routes/uploads';
import emailParseRoutes from './routes/emailParse';
import boardingpassParseRoutes from './routes/boardingpassParse';
import setupRoutes from './routes/setup';
import adminRoutes from './routes/admin';
import { errorHandler } from './middleware/errorHandler';
import { prisma } from './db';
import logger from './utils/logger';
import { DATABASE_URL } from './utils/database';

// Load environment variables
dotenv.config();

// Set DATABASE_URL from individual components if not already set
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = DATABASE_URL;
}

const app = express();
const PORT = process.env.PORT || 8000;

// Trust proxy - we're behind exactly 1 proxy (nginx)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());

// CORS configuration to allow LAN/mobile clients
const corsOrigin = process.env.CORS_ORIGIN || 'http://localhost:3000';
const allowedOrigins = corsOrigin === '*'
  ? []
  : corsOrigin.split(',').map(o => o.trim()).filter(Boolean);
const allowAllOrigins = corsOrigin === '*' || process.env.NODE_ENV !== 'production';

app.use(cors({
  origin: (origin, callback) => {
    if (allowAllOrigins) return callback(null, true);
    if (!origin) return callback(null, true); // mobile apps / same-origin / reverse proxy
    if (allowedOrigins.includes(origin)) return callback(null, true);
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  // Disable in non-production to avoid noisy 429s during local use;
  // otherwise allow a generous burst for dashboards/pagination.
  max: process.env.NODE_ENV === 'production' ? 10000 : Number.MAX_SAFE_INTEGER,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV !== 'production',
});
app.use('/api/', limiter);

// Body parsing with increased limits for email imports
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parsing (for HttpOnly JWT cookies)
app.use(cookieParser());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes
app.use('/api/v1/setup', setupRoutes);
app.use('/api/v1/admin', adminRoutes);
app.use('/api/v1/auth', authRoutes);
app.use('/api/v1/flights', flightRoutes);
app.use('/api/v1/flight-lookup', flightLookupRoutes);
app.use('/api/v1/stats', statsRoutes);
app.use('/api/v1/airports', airportRoutes);
app.use('/api/v1/achievements', achievementRoutes);
app.use('/api/v1/settings', settingsRoutes);
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/uploads', uploadsRoutes);
app.use('/api/v1', emailParseRoutes);
app.use('/api/v1', boardingpassParseRoutes);

// Error handling
app.use(errorHandler);

// Graceful shutdown
process.on('SIGINT', async () => {
  logger.info('Received SIGINT, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('Received SIGTERM, shutting down gracefully...');
  await prisma.$disconnect();
  process.exit(0);
});

// Start server only if not in test mode
if (process.env.NODE_ENV !== 'test') {
  app.listen(PORT, () => {
    logger.info({
      message: 'TravStats backend started',
      port: PORT,
      environment: process.env.NODE_ENV,
      nodeVersion: process.version,
    });
  });
}

export default app;
