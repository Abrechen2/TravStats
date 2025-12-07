#!/usr/bin/env node
/**
 * Helper script to check airport count in database
 * Outputs the count to stdout, exits with code 0 if airports exist, 1 if empty
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function checkAirports() {
  try {
    await prisma.$connect();
    const count = await prisma.airport.count();
    await prisma.$disconnect();
    
    console.log(count);
    // Exit with code 0 if airports exist, 1 if empty
    process.exit(count > 0 ? 0 : 1);
  } catch (error) {
    console.error('Error checking airports:', error);
    console.log(0);
    // On error, assume empty (will try to seed)
    process.exit(1);
  }
}

checkAirports();

