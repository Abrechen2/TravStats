#!/usr/bin/env node
/**
 * Initialization script for TravStats
 * Runs essential setup tasks for both development and production
 *
 * This script is idempotent - safe to run multiple times
 */

import { PrismaClient } from '@prisma/client';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import logger from './utils/logger';
import { initializeEncryptionKey } from './utils/encryptionKey';
import { maybeRunPreMigrationBackup, writeLastDeployedVersion } from './utils/upgradeBackup';

const prisma = new PrismaClient();

async function init() {
  console.log('🚀 Initializing TravStats...\n');
  logger.info({ operation: 'init_start', message: 'Initializing TravStats' });

  try {
    // Step 0: Initialize encryption key
    console.log('0️⃣  Initializing encryption key...');
    logger.info({ operation: 'init_encryption_key', message: 'Initializing encryption key' });
    try {
      initializeEncryptionKey();
      console.log('   ✅ Encryption key ready\n');
      logger.info({ operation: 'init_encryption_key_success', message: 'Encryption key initialized successfully' });
    } catch (error) {
      console.error('   ⚠️  Encryption key initialization failed');
      console.error('   API key encryption may not work correctly.\n');
      logger.warn({
        operation: 'init_encryption_key_error',
        message: 'Encryption key initialization failed',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      // Don't exit - encryption will use fallback
    }

    // Step 1: Check database connection
    console.log('1️⃣  Checking database connection...');
    logger.info({ operation: 'init_db_check', message: 'Checking database connection' });
    try {
      await prisma.$connect();
      console.log('   ✅ Database connected\n');
      logger.info({ operation: 'init_db_connected', message: 'Database connected successfully' });
    } catch (error) {
      console.error('   ❌ Cannot connect to database!');
      console.error('   Please check your DATABASE_URL in .env');
      logger.error({
        operation: 'init_db_error',
        message: 'Cannot connect to database',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
          stack: error instanceof Error ? error.stack : undefined,
        },
      });
      process.exit(1);
    }

    // Step 2: Create log directory
    console.log('2️⃣  Creating log directory...');
    logger.info({ operation: 'init_log_dir', message: 'Creating log directory' });
    try {
      const dataDir = path.join(__dirname, '..', 'data');
      const logsDir = path.join(dataDir, 'logs');

      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true, mode: 0o755 });
      }

      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true, mode: 0o755 });
        console.log('   ✅ Log directory created\n');
        logger.info({ operation: 'init_log_dir_created', message: 'Log directory created' });
      } else {
        console.log('   ✅ Log directory exists\n');
        logger.debug({ operation: 'init_log_dir_exists', message: 'Log directory already exists' });
      }
    } catch (error) {
      console.error('   ⚠️  Could not create log directory');
      console.error('   Logging to files may not work correctly.\n');
      logger.warn({
        operation: 'init_log_dir_error',
        message: 'Could not create log directory',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    // Step 2.5: Create backup directory
    console.log('2️⃣.5 Creating backup directory...');
    logger.info({ operation: 'init_backup_dir', message: 'Creating backup directory' });
    try {
      const backupPath = process.env.BACKUP_PATH || '/app/data/backups';
      if (!fs.existsSync(backupPath)) {
        fs.mkdirSync(backupPath, { recursive: true, mode: 0o755 });
        console.log('   ✅ Backup directory created\n');
        logger.info({ operation: 'init_backup_dir_created', message: 'Backup directory created', path: backupPath });
      } else {
        console.log('   ✅ Backup directory exists\n');
        logger.debug({ operation: 'init_backup_dir_exists', message: 'Backup directory already exists', path: backupPath });
      }
    } catch (error) {
      console.error('   ⚠️  Could not create backup directory');
      console.error('   Backups may not work correctly.\n');
      logger.warn({
        operation: 'init_backup_dir_error',
        message: 'Could not create backup directory',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    // Step 2.6: Pre-migration backup. Fires on ANY version change on an
    // install that already carries migrations — see `shouldBackupBeforeMigrating`.
    // These lines used to say "major-version bump", which is what the rule did
    // long ago; the wording outlived it and sent at least one reader (me) to
    // the wrong conclusion about when a snapshot is taken.
    console.log('2️⃣.6 Checking upgrade-backup trigger...');
    const upgradeCtx = await maybeRunPreMigrationBackup();
    if (upgradeCtx.shouldBackup) {
      if (upgradeCtx.backupCreated) {
        console.log(`   ✅ Pre-upgrade backup created: ${upgradeCtx.backupCreated}\n`);
      } else {
        console.log('   ⚠️  Major-version bump detected but backup failed; check warnings above\n');
      }
    } else {
      console.log('   ✅ No major-version bump; skipping upgrade backup\n');
    }

    // Step 3: Run migrations
    console.log('3️⃣  Running database migrations...');
    logger.info({ operation: 'init_migrations', message: 'Running database migrations' });
    try {
      execSync('npx prisma migrate deploy', {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
      });
      console.log('   ✅ Migrations applied\n');
      logger.info({ operation: 'init_migrations_success', message: 'Migrations applied successfully' });
      // Persist the version that successfully migrated this data volume.
      // Used on the next boot to detect future major bumps and trigger
      // another pre-migration backup. Written only after a green migrate.
      try {
        writeLastDeployedVersion(upgradeCtx.currentVersion);
      } catch (writeError) {
        logger.warn({
          operation: 'init_last_version_write_error',
          message: 'Could not persist last-version marker',
          error: {
            message: writeError instanceof Error ? writeError.message : 'Unknown error',
          },
        });
      }
    } catch (error) {
      console.error('   ❌ Migration failed!');
      console.error('   You may need to run: npx prisma migrate dev');
      logger.error({
        operation: 'init_migrations_error',
        message: 'Migration failed',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      process.exit(1);
    }

    // Step 4: Ensure achievements are present (essential)
    console.log('4️⃣  Ensuring achievements...');
    logger.info({ operation: 'init_ensure_achievements', message: 'Ensuring achievements are present' });
    try {
      const { ensureAchievements } = await import('./data/achievements');
      await ensureAchievements();
      console.log('   ✅ Achievements ready\n');
      logger.info({ operation: 'init_ensure_achievements_success', message: 'Achievements ensured successfully' });
    } catch (error) {
      console.error('   ❌ Failed to ensure achievements!');
      console.error('   Achievement system may not work correctly.');
      logger.error({
        operation: 'init_ensure_achievements_error',
        message: 'Failed to ensure achievements',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
      // Don't exit - non-critical
    }

    // Step 5: Airport seeding is now started after first login (not during init)
    // This prevents CORS issues during login and ensures the server is fully ready
    console.log('5️⃣  Airport seeding will start after first login\n');
    logger.debug({ operation: 'init_airport_seeding_info', message: 'Airport seeding will start after first login' });

    // Step 6: Demo user — seeded automatically on first install (empty
    // user table) so a fresh box has something to look at right away.
    // Admins can later delete the demo user via the admin UI; that
    // cascades through Prisma and removes all seed data with it. The
    // CREATE_DEMO_USER=true env var stays as a force-override for dev
    // re-seeding on a non-empty DB.
    const userCount = await prisma.user.count();
    const isFirstInstall = userCount === 0;
    const forceDemo = process.env.CREATE_DEMO_USER === 'true';
    const shouldSeedDemo = isFirstInstall || forceDemo;

    if (shouldSeedDemo) {
      const reason = isFirstInstall ? 'first install' : 'CREATE_DEMO_USER=true';
      console.log(`6️⃣  Seeding demo user (${reason})...`);
      logger.info({
        operation: 'init_demo_user',
        message: 'Seeding demo user',
        context: { isFirstInstall, forceDemo },
      });
      try {
        execSync('npm run seed:demo', {
          stdio: 'inherit',
          cwd: path.join(__dirname, '..')
        });
        console.log('   ✅ Demo user ready (login: demo / demo123)\n');
        logger.info({ operation: 'init_demo_user_success', message: 'Demo user created successfully' });
      } catch (error) {
        console.error('   ⚠️  Demo user creation failed (may already exist)\n');
        logger.warn({
          operation: 'init_demo_user_error',
          message: 'Demo user creation failed',
          error: {
            message: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    } else {
      console.log(`6️⃣  Skipping demo user (DB already has ${userCount} user(s); set CREATE_DEMO_USER=true to force re-seed)\n`);
      logger.debug({
        operation: 'init_demo_user_skip',
        message: 'Demo user creation skipped',
        context: { userCount },
      });
    }

    // Step 7: Initialize category-based log streams
    console.log('7️⃣  Initializing category-based log streams...');
    logger.info({ operation: 'init_log_streams', message: 'Initializing category-based log streams' });
    try {
      const { initializeCategoryStreams } = await import('./utils/logger');
      await initializeCategoryStreams();
      console.log('   ✅ Category log streams initialized\n');
      logger.info({ operation: 'init_log_streams_success', message: 'Category log streams initialized successfully' });
    } catch (error) {
      console.error('   ⚠️  Failed to initialize category log streams');
      console.error('   Category-specific logging may not work correctly.\n');
      logger.warn({
        operation: 'init_log_streams_error',
        message: 'Failed to initialize category log streams',
        error: {
          message: error instanceof Error ? error.message : 'Unknown error',
        },
      });
    }

    console.log('✅ Initialization complete!\n');
    console.log('📝 Next steps:');
    console.log('   - Development: npm run dev');
    console.log('   - Production: npm start\n');
    logger.info({ operation: 'init_complete', message: 'Initialization complete' });

  } catch (error) {
    console.error('❌ Initialization failed:', error);
    logger.error({
      operation: 'init_failed',
      message: 'Initialization failed',
      error: {
        message: error instanceof Error ? error.message : 'Unknown error',
        stack: error instanceof Error ? error.stack : undefined,
      },
    });
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

init();
