import { Router } from 'express';
import { authenticate, requireWriteScope } from '../../middleware/auth';
import { rejectDemoWrites } from '../../middleware/demoGuard';
import generalRouter from './general';
import parserRouter from './parser';
import apiKeysRouter from './apiKeys';
import notificationsRouter from './notifications';
import homeAirportsRouter from './homeAirports';
import profileRouter from './profile';
import profilePictureRouter from './profilePicture';
import tokensRouter from './tokens';
import immichRouter from './immich';
import dawarichRouter from './dawarich';

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

// Shared demo account: no keys, tokens, outbound URLs, pictures, notification
// addresses or profile fields (spec §3).
//
// `/notifications` is on the list because it is a password-reset vector, not
// merely a preference: a visitor who writes the shared account's
// `notificationEmail` can then ask `/auth/forgot-password` for a link to their
// own inbox and take the account over, locking every other visitor out
// (finding C3). `/profile` carries the birthdate, which — like the name in
// the settings profile block — is shown to everybody and survived every
// reseed (I1).
router.use(
  ['/api-keys', '/tokens', '/immich', '/dawarich', '/profile-picture', '/notifications', '/profile'],
  rejectDemoWrites,
);

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
router.use('/dawarich', dawarichRouter);

export default router;
