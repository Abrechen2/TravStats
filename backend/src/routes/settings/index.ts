import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import { settingsLimiter } from '../../middleware/rateLimit';
import generalRouter from './general';
import parserRouter from './parser';
import apiKeysRouter from './apiKeys';
import developerRouter from './developer';
import onboardingRouter from './onboarding';
import notificationsRouter from './notifications';
import homeAirportsRouter from './homeAirports';

const router = Router();

// All routes require authentication and are rate-limited
router.use(authenticate);
router.use(settingsLimiter);

// Mount sub-routers
router.use('/', generalRouter);
router.use('/parser', parserRouter);
router.use('/api-keys', apiKeysRouter);
router.use('/developer-mode', developerRouter);
router.use('/onboarding-state', onboardingRouter);
router.use('/notifications', notificationsRouter);
router.use('/home-airports', homeAirportsRouter);

export default router;
