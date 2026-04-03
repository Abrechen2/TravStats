import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import systemRouter from './system';
import usersRouter from './users';
import parseLogsRouter from './parseLogs';
import apiKeysRouter from './apiKeys';
import loggingRouter from './logging';
import parserSettingsRouter from './parserSettings';
import smtpRouter from './smtp';

const router = Router();

// Apply auth middleware to ALL admin routes
router.use(authenticate);
router.use(requireAdmin);

// Mount sub-routers
router.use('/', systemRouter);
router.use('/', usersRouter);
router.use('/', parseLogsRouter);
router.use('/', apiKeysRouter);
router.use('/logging', loggingRouter);
router.use('/', parserSettingsRouter);
router.use('/smtp', smtpRouter);

export default router;
