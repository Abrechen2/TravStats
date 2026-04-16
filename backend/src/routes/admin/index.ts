import { Router } from 'express';
import { authenticate, requireAdmin } from '../../middleware/auth';
import systemRouter from './system';
import usersRouter from './users';
import invitationsRouter from './invitations';
import parseLogsRouter from './parseLogs';
import apiKeysRouter from './apiKeys';
import loggingRouter from './logging';
import parserSettingsRouter from './parserSettings';
import smtpRouter from './smtp';
import backupSettingsRouter from './backupSettings';
import instanceSettingsRouter from './instanceSettings';

const router = Router();

// Apply auth middleware to ALL admin routes
router.use(authenticate);
router.use(requireAdmin);

// Mount sub-routers
router.use('/', systemRouter);
router.use('/', usersRouter);
router.use('/invitations', invitationsRouter);
router.use('/', parseLogsRouter);
router.use('/', apiKeysRouter);
router.use('/logging', loggingRouter);
router.use('/', parserSettingsRouter);
router.use('/smtp', smtpRouter);
router.use('/', backupSettingsRouter);
router.use('/', instanceSettingsRouter);

export default router;
