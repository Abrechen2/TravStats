import { Router } from 'express';
import { authenticate, requireWriteScope } from '../../middleware/auth';
import generalRouter from './general';
import parserRouter from './parser';
import apiKeysRouter from './apiKeys';
import notificationsRouter from './notifications';
import homeAirportsRouter from './homeAirports';
import profileRouter from './profile';
import profilePictureRouter from './profilePicture';
import tokensRouter from './tokens';
import immichRouter from './immich';

const router = Router();

// All routes require authentication. Intentionally no rate-limit middleware:
// /settings is a per-user authenticated surface that the UI legitimately
// hammers (multiple sub-section loads on mount, 30-second backup-info poll,
// auto-save effects). Real rate-limiting belongs on auth endpoints (brute
// force), external-API-backed routes (cost) and admin exports (DB-wide
// reads), not on a user reading their own preferences.
router.use(authenticate);
// PAT scope guard. Read-scoped tokens get 403 on PUT/POST/DELETE/PATCH;
// GET passes through. Cookie sessions are unaffected. Note that
// `tokens.ts` additionally hard-403s ALL methods for any PAT-authenticated
// request (PAT-cannot-mint-PAT defence), so this middleware is defence-in-depth
// for every other settings sub-router.
router.use(requireWriteScope);

// Mount sub-routers
router.use('/', generalRouter);
router.use('/parser', parserRouter);
router.use('/api-keys', apiKeysRouter);
router.use('/notifications', notificationsRouter);
router.use('/home-airports', homeAirportsRouter);
router.use('/profile', profileRouter);
router.use('/profile-picture', profilePictureRouter);
router.use('/tokens', tokensRouter);
router.use('/immich', immichRouter);

export default router;
