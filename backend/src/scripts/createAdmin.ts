#!/usr/bin/env node
/**
 * Helper script to create admin user if no users exist
 * Uses ADMIN_USERNAME and ADMIN_PASSWORD environment variables
 * Defaults: admin / admin123
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();
const SALT_ROUNDS = 10;

async function createAdmin() {
  try {
    await prisma.$connect();
    
    // Check if users exist
    const userCount = await prisma.user.count();
    
    if (userCount > 0) {
      console.log(`Users already exist (${userCount} users), skipping admin creation`);
      await prisma.$disconnect();
      process.exit(0);
    }
    
    // No users exist - create admin
    const adminUsername = process.env.ADMIN_USERNAME || 'admin';
    const adminPassword = process.env.ADMIN_PASSWORD || 'admin123';
    
    if (adminPassword.length < 8) {
      console.error('ERROR: Admin password must be at least 8 characters');
      console.error('Please set ADMIN_PASSWORD environment variable with a secure password');
      await prisma.$disconnect();
      process.exit(1);
    }
    
    // Hash password
    const passwordHash = await bcrypt.hash(adminPassword, SALT_ROUNDS);
    
    // Create admin user
    const adminUser = await prisma.user.create({
      data: {
        username: adminUsername,
        passwordHash,
        isAdmin: true,
      },
    });
    
    console.log('✅ Admin user created');
    console.log(`   Username: ${adminUsername}`);
    console.log(`   Password: ${adminPassword}`);
    console.log('   ⚠️  Please change the password after first login!');
    
    await prisma.$disconnect();
    process.exit(0);
  } catch (error) {
    console.error('ERROR creating admin user:', error);
    await prisma.$disconnect();
    process.exit(1);
  }
}

createAdmin();








