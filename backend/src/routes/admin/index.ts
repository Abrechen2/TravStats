import { Router } from 'express';
import { authenticate, requireAdmin, requireWriteScope } from '../../middleware/auth';
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
import immichAdminRouter from './immich';
import usageStatsRouter from './usageStats';

const router = Router();

// Apply auth middleware to ALL admin routes.
// requireAdmin already blocks any PAT whose scope !== 'admin', so the
// 'read'-scoped lockout below is currently redundant — but adding it
// explicitly is defence-in-depth: if a future intermediate scope (e.g.
// 'admin-read') is introduced, this still keeps mutations gated. The
// guard is method-aware, so admin GETs still pass for read tokens that
// might be issued at that intermediate level.
router.use(authenticate);
router.use(requireAdmin);
router.use(requireWriteScope);

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
router.use('/immich', immichAdminRouter);
router.use('/', usageStatsRouter);

export default router;
