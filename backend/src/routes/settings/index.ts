import { Router } from 'express';
import { authenticate } from '../../middleware/auth';
import generalRouter from './general';
import parserRouter from './parser';
import apiKeysRouter from './apiKeys';
import trainingRouter from './training';
import developerRouter from './developer';
import onboardingRouter from './onboarding';

const router = Router();

// All routes require authentication
router.use(authenticate);

// Mount sub-routers
router.use('/', generalRouter);
router.use('/parser', parserRouter);
router.use('/api-keys', apiKeysRouter);
router.use('/training', trainingRouter);
router.use('/developer-mode', developerRouter);
router.use('/onboarding-state', onboardingRouter);

export default router;
