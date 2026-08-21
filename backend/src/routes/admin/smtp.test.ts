/**
 * Issue #255: SMTP credentials could be saved but never removed. The router
 * had GET/PUT/POST-test and no DELETE, so a password entered once stayed in
 * the database for the life of the instance — `enabled: false` only stops
 * sending, it does not take the secret back out.
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';

jest.mock('../../services/emailService', () => ({
  sendInvitationEmail: jest.fn(),
  testSmtpConnection: jest.fn(),
}));

import { app } from '../../index';
import { prisma } from '../../db';
import { generateToken } from '../../utils/jwt';
import { SMTP_CONFIG_ID } from './smtp';

let adminToken: string;
let plainUserToken: string;

async function createUser(isAdmin: boolean): Promise<string> {
  const user = await prisma.user.create({
    data: {
      username: `${isAdmin ? 'admin' : 'user'}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      passwordHash: 'x',
      isAdmin,
    },
  });
  return generateToken(user.id);
}

async function storeConfig(): Promise<void> {
  await prisma.smtpConfig.create({
    data: {
      id: SMTP_CONFIG_ID,
      host: 'smtp.example.com',
      port: 587,
      secure: false,
      username: 'postmaster@example.com',
      password: 'encrypted-secret',
      fromEmail: 'noreply@example.com',
      fromName: 'TravStats',
      enabled: true,
    },
  });
}

describe('admin/smtp — DELETE / (#255)', () => {
  beforeEach(async () => {
    await prisma.smtpConfig.deleteMany();
    await prisma.user.deleteMany();
    adminToken = await createUser(true);
    plainUserToken = await createUser(false);
  });

  afterEach(async () => {
    await prisma.smtpConfig.deleteMany();
    await prisma.user.deleteMany();
  });

  it('removes the stored configuration, secret included', async () => {
    await storeConfig();

    const res = await request(app)
      .delete('/api/v1/admin/smtp')
      .set('Cookie', [`auth_token=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false, deleted: true });
    expect(await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } })).toBeNull();
  });

  it('reports the instance as unconfigured afterwards', async () => {
    await storeConfig();
    await request(app).delete('/api/v1/admin/smtp').set('Cookie', [`auth_token=${adminToken}`]);

    const res = await request(app)
      .get('/api/v1/admin/smtp')
      .set('Cookie', [`auth_token=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false });
  });

  it('is idempotent — deleting on an unconfigured instance is not an error', async () => {
    const res = await request(app)
      .delete('/api/v1/admin/smtp')
      .set('Cookie', [`auth_token=${adminToken}`]);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ configured: false, deleted: false });
  });

  it('refuses a non-admin', async () => {
    await storeConfig();

    const res = await request(app)
      .delete('/api/v1/admin/smtp')
      .set('Cookie', [`auth_token=${plainUserToken}`]);

    expect(res.status).toBe(403);
    expect(await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } })).not.toBeNull();
  });

  it('refuses an unauthenticated caller', async () => {
    await storeConfig();

    const res = await request(app).delete('/api/v1/admin/smtp');

    expect(res.status).toBe(401);
    expect(await prisma.smtpConfig.findUnique({ where: { id: SMTP_CONFIG_ID } })).not.toBeNull();
  });
});
