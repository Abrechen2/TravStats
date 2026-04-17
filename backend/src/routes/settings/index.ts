import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import generalRouter from './general';
import parserRouter from './parser';
import apiKeysRouter from './apiKeys';
import notificationsRouter from './notifications';
import homeAirportsRouter from './homeAirports';

const router = Router();

// All routes require authentication. Intentionally no rate-limit middleware:
// /settings is a per-user authenticated surface that the UI legitimately
// hammers (multiple sub-section loads on mount, 30-second backup-info poll,
// auto-save effects). Real rate-limiting belongs on auth endpoints (brute
// force), external-API-backed routes (cost) and admin exports (DB-wide
// reads), not on a user reading their own preferences.
router.use(authenticate);

// Mount sub-routers
router.use('/', generalRouter);
router.use('/parser', parserRouter);
router.use('/api-keys', apiKeysRouter);
router.use('/notifications', notificationsRouter);
router.use('/home-airports', homeAirportsRouter);

export default router;
