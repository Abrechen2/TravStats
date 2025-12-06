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

const prisma = new PrismaClient();

async function init() {
  console.log('🚀 Initializing TravStats...\n');

  try {
    // Step 1: Check database connection
    console.log('1️⃣  Checking database connection...');
    try {
      await prisma.$connect();
      console.log('   ✅ Database connected\n');
    } catch (error) {
      console.error('   ❌ Cannot connect to database!');
      console.error('   Please check your DATABASE_URL in .env');
      process.exit(1);
    }

    // Step 2: Create log directory
    console.log('2️⃣  Creating log directory...');
    try {
      const dataDir = path.join(__dirname, '..', 'data');
      const logsDir = path.join(dataDir, 'logs');

      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true, mode: 0o755 });
      }

      if (!fs.existsSync(logsDir)) {
        fs.mkdirSync(logsDir, { recursive: true, mode: 0o755 });
        console.log('   ✅ Log directory created\n');
      } else {
        console.log('   ✅ Log directory exists\n');
      }
    } catch (error) {
      console.error('   ⚠️  Could not create log directory');
      console.error('   Logging to files may not work correctly.\n');
    }

    // Step 3: Run migrations
    console.log('3️⃣  Running database migrations...');
    try {
      execSync('npx prisma migrate deploy', {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
      });
      console.log('   ✅ Migrations applied\n');
    } catch (error) {
      console.error('   ❌ Migration failed!');
      console.error('   You may need to run: npx prisma migrate dev');
      process.exit(1);
    }

    // Step 4: Seed achievements (essential)
    console.log('4️⃣  Seeding achievements...');
    try {
      execSync('npm run seed:achievements', {
        stdio: 'inherit',
        cwd: path.join(__dirname, '..')
      });
      console.log('   ✅ Achievements ready\n');
    } catch (error) {
      console.error('   ❌ Failed to seed achievements!');
      console.error('   Achievement system may not work correctly.');
      // Don't exit - non-critical
    }

    // Step 5: Optional seeds based on environment
    const seedAirports = process.env.SEED_AIRPORTS === 'true';
    const createDemoUser = process.env.CREATE_DEMO_USER === 'true';

    if (seedAirports) {
      console.log('5️⃣  Seeding airports database...');
      try {
        execSync('npm run seed:airports:csv', {
          stdio: 'inherit',
          cwd: path.join(__dirname, '..')
        });
        console.log('   ✅ Airports database ready\n');
      } catch (error) {
        console.error('   ⚠️  Failed to seed airports');
        console.error('   Autocomplete may not work. You can seed later with: npm run seed:airports:csv\n');
      }
    } else {
      console.log('5️⃣  Skipping airport seeding (set SEED_AIRPORTS=true to enable)\n');
    }

    if (createDemoUser) {
      console.log('6️⃣  Creating demo user...');
      try {
        execSync('npm run seed:demo', {
          stdio: 'inherit',
          cwd: path.join(__dirname, '..')
        });
        console.log('   ✅ Demo user ready\n');
      } catch (error) {
        console.error('   ⚠️  Demo user creation failed (may already exist)\n');
      }
    } else {
      console.log('6️⃣  Skipping demo user creation (set CREATE_DEMO_USER=true to enable)\n');
    }

    console.log('✅ Initialization complete!\n');
    console.log('📝 Next steps:');
    console.log('   - Development: npm run dev');
    console.log('   - Production: npm start\n');

  } catch (error) {
    console.error('❌ Initialization failed:', error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

init();
