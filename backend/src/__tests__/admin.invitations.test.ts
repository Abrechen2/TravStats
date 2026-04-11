import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import request from 'supertest';

// Mock the email service BEFORE importing the app
const mockSendInvitationEmail = jest.fn<() => Promise<void>>();
jest.mock('../services/emailService', () => ({
  sendInvitationEmail: mockSendInvitationEmail,
  testSmtpConnection: jest.fn(),
}));

import { app } from '../index';
import { prisma } from '../db';
import { generateToken } from '../utils/jwt';

let adminUserId: string;
let adminToken: string;

async function createAdminUser(): Promise<{ id: string; token: string }> {
  const user = await prisma.user.create({
    data: {
      username: `admin-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      passwordHash: 'x',
      isAdmin: true,
    },
  });
  return { id: user.id, token: generateToken(user.id) };
}

describe('admin/invitations — POST /', () => {
  beforeEach(async () => {
    mockSendInvitationEmail.mockReset();
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
    process.env.MAX_USERS = '10';
    const admin = await createAdminUser();
    adminUserId = admin.id;
    adminToken = admin.token;
  });

  afterEach(async () => {
    await prisma.invitation.deleteMany();
    await prisma.user.deleteMany();
  });

  it('creates a link-only invitation with expiresInDays', async () => {
    const res = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send({ expiresInDays: 7 });

    expect(res.status).toBe(200);
    expect(res.body.invitation.email).toBeNull();
    expect(res.body.invitation.token).toHaveLength(64);
    expect(res.body.inviteUrl).toContain(`?token=${res.body.invitation.token}`);

    const stored = await prisma.invitation.findUnique({
      where: { id: res.body.invitation.id },
    });
    expect(stored?.createdBy).toBe(adminUserId);
    expect(stored?.email).toBeNull();
  });

  it('rejects expiresInDays outside {1,7,30}', async () => {
    const res = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send({ expiresInDays: 14 });

    expect(res.status).toBe(400);
  });

  it('returns 409 when user + active invite count >= MAX_USERS', async () => {
    process.env.MAX_USERS = '2';
    await prisma.invitation.create({
      data: {
        token: 'placeholder-token-1',
        createdBy: adminUserId,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      },
    });

    const res = await request(app)
      .post('/api/v1/admin/invitations')
      .set('Cookie', [`auth_token=${adminToken}`])
      .send({ expiresInDays: 7 });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/user limit reached/i);
  });
});
